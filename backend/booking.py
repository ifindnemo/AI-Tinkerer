"""Garage appointment proposed by the agent and confirmed by the driver.

The agent only proposes (tool `propose_booking`): the slot is a day offset and an hour in the
garage's time zone, so the model never writes a date. Nothing is saved until the driver confirms
(`VehicleAgent.confirm_action`). By default a confirmed appointment is kept in the database and
offered as an .ics file; `BOOKING_BACKEND=google` creates a Google Calendar event instead.
"""

import os
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_DAYS_AHEAD = 14
FIRST_HOUR, LAST_HOUR = 8, 17  # opening hours the agent may propose, inclusive
APPOINTMENT_HOURS = 1


def timezone_name() -> str:
    return os.getenv("GOOGLE_CALENDAR_TIME_ZONE", "Asia/Ho_Chi_Minh")


def _zone() -> tzinfo:
    try:
        return ZoneInfo(timezone_name())
    except ZoneInfoNotFoundError:
        return timezone(timedelta(hours=7))


def backend_name() -> str:
    return "google" if os.getenv("BOOKING_BACKEND", "local").strip().lower() == "google" else "local"


def known_garage(name: str, trace: list[dict[str, Any]]) -> dict[str, Any] | None:
    """A garage the agent really found in this run: only those can be proposed."""
    wanted = " ".join(name.split()).casefold()
    for item in trace:
        if item.get("tool") != "search_nearby_garages":
            continue
        for option in (item.get("result") or {}).get("options") or []:
            if " ".join(str(option.get("name", "")).split()).casefold() == wanted:
                return option
    return None


def build_proposal(
    garage_name: str,
    days_from_now: int,
    hour: int,
    trace: list[dict[str, Any]],
    now: datetime | None = None,
) -> dict[str, Any]:
    """The proposal as stored in the pending action. Raises ValueError with a reason the agent can read."""
    garage = known_garage(garage_name, trace)
    if garage is None:
        raise ValueError("garage_name must be copied exactly from the search_nearby_garages result of this run")
    if not 1 <= days_from_now <= MAX_DAYS_AHEAD:
        raise ValueError(f"days_from_now must be between 1 and {MAX_DAYS_AHEAD}")
    if not FIRST_HOUR <= hour <= LAST_HOUR:
        raise ValueError(f"hour must be between {FIRST_HOUR} and {LAST_HOUR} (garage opening hours)")
    zone = _zone()
    today = (now or datetime.now(timezone.utc)).astimezone(zone)
    start = (today + timedelta(days=days_from_now)).replace(hour=hour, minute=0, second=0, microsecond=0)
    return {
        "garage_id": str(garage["name"]),
        "slot": start.isoformat(),
        "address": garage.get("address"),
        "distance_km": garage.get("distance_km"),
    }


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _utc_stamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def ics_for(appointment: dict[str, Any]) -> str:
    """A one-event iCalendar file (RFC 5545) for a saved appointment."""
    start = datetime.fromisoformat(str(appointment["slot"]).replace("Z", "+00:00"))
    end = start + timedelta(hours=APPOINTMENT_HOURS)
    created = datetime.fromisoformat(str(appointment["created_at"]).replace("Z", "+00:00"))
    vehicle = appointment["vehicle_id"]
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Car Neuron//Appointment//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{appointment['id']}@car-neuron",
        f"DTSTAMP:{_utc_stamp(created)}",
        f"DTSTART:{_utc_stamp(start)}",
        f"DTEND:{_utc_stamp(end)}",
        f"SUMMARY:{_escape(f'Bảo dưỡng xe {vehicle} · Car service {vehicle}')}",
        f"LOCATION:{_escape(str(appointment['garage_id']))}",
        f"DESCRIPTION:{_escape(f'Car Neuron incident {appointment['incident_id']}. Prototype appointment: the garage has not been contacted.')}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(lines) + "\r\n"
