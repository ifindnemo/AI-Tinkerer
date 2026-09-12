import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow


TOOLS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = Path(__file__).resolve().parents[2]
TOKEN_FILE = BACKEND_DIR / "token.json"
SCOPES = ["https://www.googleapis.com/auth/calendar.events"]

load_dotenv(BACKEND_DIR / ".env")


def _credentials_file() -> Path:
    configured_file = os.getenv("GOOGLE_CALENDAR_CREDENTIALS_FILE")
    if configured_file:
        credentials_file = Path(configured_file)
        if not credentials_file.is_absolute():
            credentials_file = BACKEND_DIR / credentials_file
        if credentials_file.is_file():
            return credentials_file
        raise RuntimeError(
            f"Google OAuth credentials file not found: {credentials_file}"
        )

    credential_files = sorted(TOOLS_DIR.glob("client_secret_*.json"))
    if len(credential_files) == 1:
        return credential_files[0]
    if not credential_files:
        raise RuntimeError(
            "Google OAuth credentials file not found. Download a Desktop app "
            "client JSON or configure GOOGLE_CALENDAR_CREDENTIALS_FILE."
        )
    raise RuntimeError(
        "Multiple Google OAuth credential files found; configure "
        "GOOGLE_CALENDAR_CREDENTIALS_FILE."
    )


def _get_credentials() -> Credentials:
    credentials = None
    if TOKEN_FILE.is_file():
        credentials = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if credentials and credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
    elif not credentials or not credentials.valid:
        flow = InstalledAppFlow.from_client_secrets_file(
            _credentials_file(), SCOPES
        )
        credentials = flow.run_local_server(
            port=0,
            access_type="offline",
            prompt="consent",
        )

    TOKEN_FILE.write_text(credentials.to_json(), encoding="utf-8")
    return credentials


def _event_url(event_id: str | None = None) -> str:
    calendar_id = os.getenv("GOOGLE_CALENDAR_ID", "primary")
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(calendar_id, safe='')}/events"
    )
    if event_id is not None:
        if not event_id.strip():
            raise ValueError("event_id must not be empty")
        url = f"{url}/{quote(event_id, safe='')}"
    return url


def _authorization_headers() -> dict[str, str]:
    credentials = _get_credentials()
    if not credentials.token:
        raise RuntimeError("Google OAuth did not return an access token")
    return {"Authorization": f"Bearer {credentials.token}"}


def _raise_for_status(response: httpx.Response, fallback_message: str) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        try:
            message = response.json()["error"]["message"]
        except (KeyError, TypeError, ValueError):
            message = fallback_message
        raise RuntimeError(message) from error


def _parse_event_time(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(
            "Event time must use ISO 8601 format, for example "
            "2026-09-15T09:00:00+07:00."
        ) from error


def _event_payload(
    summary: str,
    start_time: str,
    end_time: str,
    time_zone: str,
    description: str | None,
    location: str | None,
) -> dict[str, Any]:
    start = _parse_event_time(start_time)
    end = _parse_event_time(end_time)
    if (start.tzinfo is None) != (end.tzinfo is None):
        raise ValueError("start_time and end_time must use the same timezone format")
    if end <= start:
        raise ValueError("end_time must be later than start_time")

    event: dict[str, Any] = {
        "summary": summary,
        "start": {"dateTime": start_time, "timeZone": time_zone},
        "end": {"dateTime": end_time, "timeZone": time_zone},
        "colorId": os.getenv("GOOGLE_CALENDAR_EVENT_COLOR_ID", "6"),
        "transparency": "opaque",
    }
    if description is not None:
        event["description"] = description
    if location is not None:
        event["location"] = location
    return event


def _event_result(
    event: dict[str, Any], requested: dict[str, Any] | None = None
) -> dict[str, Any]:
    requested = requested or {}
    return {
        "event_id": event["id"],
        "status": event.get("status"),
        "html_link": event.get("htmlLink"),
        "summary": event.get("summary"),
        "start": event.get("start"),
        "end": event.get("end"),
        "color_id": event.get("colorId", requested.get("colorId")),
        "transparency": event.get(
            "transparency", requested.get("transparency")
        ),
    }


def create_google_calendar_event(
    summary: str,
    start_time: str,
    end_time: str,
    time_zone: str,
    description: str | None,
    location: str | None,
) -> dict[str, Any]:
    """Create a Google Calendar event after the caller confirms the action."""
    event = _event_payload(
        summary, start_time, end_time, time_zone, description, location
    )
    response = httpx.post(
        _event_url(),
        headers=_authorization_headers(),
        params={"sendUpdates": "all"},
        json=event,
        timeout=20,
    )
    _raise_for_status(response, "Google Calendar rejected the new event")
    return _event_result(response.json(), event)


def update_google_calendar_event(
    event_id: str,
    summary: str,
    start_time: str,
    end_time: str,
    time_zone: str,
    description: str | None,
    location: str | None,
) -> dict[str, Any]:
    """Update a Google Calendar event after the caller confirms the action."""
    event = _event_payload(
        summary, start_time, end_time, time_zone, description, location
    )
    response = httpx.patch(
        _event_url(event_id),
        headers=_authorization_headers(),
        params={"sendUpdates": "all"},
        json=event,
        timeout=20,
    )
    _raise_for_status(response, "Google Calendar rejected the event update")
    return _event_result(response.json(), event)


def delete_google_calendar_event(event_id: str) -> dict[str, Any]:
    """Delete a Google Calendar event after the caller confirms the action."""
    response = httpx.delete(
        _event_url(event_id),
        headers=_authorization_headers(),
        params={"sendUpdates": "all"},
        timeout=20,
    )
    _raise_for_status(response, "Google Calendar rejected the event deletion")
    return {"event_id": event_id, "status": "deleted"}


if __name__ == "__main__":
    day = "2026-09-19"
    start = datetime.strptime(day, "%Y-%m-%d").replace(
        hour=9,
        minute=0,
        tzinfo=ZoneInfo("Asia/Ho_Chi_Minh"),
    )
    end = start + timedelta(hours=1)
    try:
        event = create_google_calendar_event(
            summary="Lịch bảo trì xe",
            start_time=start.isoformat(timespec="seconds"),
            end_time=end.isoformat(timespec="seconds"),
            time_zone="Asia/Ho_Chi_Minh",
            description="Sự kiện kiểm thử tích hợp Vehicle Guardian.",
            location="Garage thử nghiệm",
        )
        print("Event created:", event)
    except Exception as error:
        print("Error:", error)
