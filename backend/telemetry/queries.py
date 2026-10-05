"""Read models for the dashboard: profile, trip, recent samples, DTC status, analyses."""

import json
from typing import Any

from dtc.kb import explain
from telemetry.db import TelemetryStore
from telemetry.signals import split_supported
from telemetry.vin import make_from_vin, model_year_from_vin

RECENT_SAMPLES = 60


def _rows(telemetry: TelemetryStore, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    telemetry.initialize()
    with telemetry.base.connect() as connection:
        return [dict(row) for row in connection.execute(sql, params)]


def vehicle_profile(telemetry: TelemetryStore, vehicle_id: str) -> dict[str, Any]:
    rows = _rows(telemetry, "SELECT * FROM vehicles WHERE id = ?", (vehicle_id,))
    devices = _rows(
        telemetry,
        "SELECT id, label, last_seen_at FROM devices WHERE vehicle_id = ? ORDER BY last_seen_at DESC",
        (vehicle_id,),
    )
    row = rows[0] if rows else None
    pids = json.loads(row["supported_pids_json"]) if row else []
    supported, missing = split_supported(pids)
    vin = row["vin"] if row else None
    return {
        "vehicle_id": vehicle_id,
        "known": row is not None,
        "vin": vin,
        "make": make_from_vin(vin),
        "model_year_guess": model_year_from_vin(vin),
        "display_name": row["display_name"] if row else None,
        "protocol": row["protocol"] if row else None,
        "supported_pids": pids,
        "supported_signals": supported if row else [],
        "missing_signals": missing if row else [],
        "devices": devices,
        "updated_at": row["updated_at"] if row else None,
    }


def latest_trip(telemetry: TelemetryStore, vehicle_id: str) -> dict[str, Any] | None:
    rows = _rows(
        telemetry,
        "SELECT * FROM trips WHERE vehicle_id = ? ORDER BY ended_at DESC LIMIT 1",
        (vehicle_id,),
    )
    return _trip(rows[0]) if rows else None


def get_trip(telemetry: TelemetryStore, trip_id: str) -> dict[str, Any] | None:
    rows = _rows(telemetry, "SELECT * FROM trips WHERE id = ?", (trip_id,))
    return _trip(rows[0]) if rows else None


def _trip(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "vehicle_id": row["vehicle_id"],
        "source": row["source"],
        "simulated": bool(row["simulated"]),
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "status": row["status"],
        "sample_count": row["sample_count"],
        "distance_km": round(row["distance_km"], 2),
        "max_coolant": row["max_coolant"],
        "event_count": row["event_count"],
        "mil": bool(row["mil"]),
    }


def _sample(row: dict[str, Any]) -> dict[str, Any]:
    sample: dict[str, Any] = {"capturedAt": row["captured_at"], "signals": json.loads(row["signals_json"])}
    if row["lat"] is not None and row["lon"] is not None:
        sample["location"] = {"lat": row["lat"], "lon": row["lon"], "fixed": bool(row["location_fixed"])}
    return sample


def recent_samples(
    telemetry: TelemetryStore,
    trip_id: str,
    until: str | None = None,
    limit: int = RECENT_SAMPLES,
) -> list[dict[str, Any]]:
    """The last `limit` samples of a trip (up to `until`), oldest first."""
    rows = _rows(
        telemetry,
        "SELECT * FROM samples WHERE trip_id = ? AND (? IS NULL OR captured_at <= ?) "
        "ORDER BY captured_at DESC LIMIT ?",
        (trip_id, until, until, limit),
    )
    return [_sample(row) for row in reversed(rows)]


def samples_between(telemetry: TelemetryStore, trip_id: str, start: str, end: str) -> list[dict[str, Any]]:
    rows = _rows(
        telemetry,
        "SELECT * FROM samples WHERE trip_id = ? AND captured_at >= ? AND captured_at <= ? "
        "ORDER BY captured_at",
        (trip_id, start, end),
    )
    return [_sample(row) for row in rows]


def dtc_status(telemetry: TelemetryStore, vehicle_id: str, trip_id: str | None = None) -> dict[str, Any]:
    """Codes from the latest DTC read of the trip, each with its explanation."""
    trip = get_trip(telemetry, trip_id) if trip_id else latest_trip(telemetry, vehicle_id)
    empty = {"trip_id": trip["id"] if trip else None, "read_at": None, "mil": False, "codes": [], "earlier": []}
    if trip is None:
        return empty
    read_at = _rows(telemetry, "SELECT last_dtc_read_at FROM trips WHERE id = ?", (trip["id"],))[0][
        "last_dtc_read_at"
    ]
    if read_at is None:
        return empty
    events = _rows(
        telemetry,
        "SELECT * FROM dtc_events WHERE vehicle_id = ? AND trip_id = ? ORDER BY first_seen_at",
        (vehicle_id, trip["id"]),
    )

    def item(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "code": row["code"],
            "kind": row["kind"],
            "first_seen_at": row["first_seen_at"],
            "last_seen_at": row["last_seen_at"],
            "freeze_frame": json.loads(row["freeze_frame_json"]) if row["freeze_frame_json"] else None,
            "info": explain(row["code"]),
        }

    current = [item(row) for row in events if row["last_seen_at"] == read_at]
    earlier = [item(row) for row in events if row["last_seen_at"] != read_at]
    return {"trip_id": trip["id"], "read_at": read_at, "mil": trip["mil"], "codes": current, "earlier": earlier}


def latest_analyses(telemetry: TelemetryStore, vehicle_id: str, limit: int = 5) -> list[dict[str, Any]]:
    rows = _rows(
        telemetry,
        "SELECT payload_json FROM analyses WHERE vehicle_id = ? ORDER BY at DESC, created_at DESC LIMIT ?",
        (vehicle_id, limit),
    )
    return [json.loads(row["payload_json"]) for row in rows]


def latest_analysis_meta(telemetry: TelemetryStore, vehicle_id: str) -> dict[str, Any] | None:
    rows = _rows(
        telemetry,
        "SELECT trip_id, at, findings_json FROM analyses WHERE vehicle_id = ? "
        "ORDER BY at DESC, created_at DESC LIMIT 1",
        (vehicle_id,),
    )
    if not rows:
        return None
    return {
        "trip_id": rows[0]["trip_id"],
        "at": rows[0]["at"],
        "rules": [finding["rule"] for finding in json.loads(rows[0]["findings_json"])],
    }


def snapshot(telemetry: TelemetryStore, vehicle_id: str) -> dict[str, Any]:
    """Everything the dashboard needs on (re)connect; it replaces the client state."""
    trip = latest_trip(telemetry, vehicle_id)
    analyses = latest_analyses(telemetry, vehicle_id)
    return {
        "vehicle_id": vehicle_id,
        "profile": vehicle_profile(telemetry, vehicle_id),
        "trip": trip,
        "samples": recent_samples(telemetry, trip["id"]) if trip else [],
        "dtc": dtc_status(telemetry, vehicle_id, trip["id"] if trip else None),
        "analysis": analyses[0] if analyses else None,
        "analyses": analyses,
    }
