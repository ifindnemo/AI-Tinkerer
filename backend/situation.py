"""Latest vehicle assessment for the spoken conversation.

The open incident stays as the alert record. Talk reads this snapshot so a car that
has returned to normal is not described by an older warning. Browser numbers are not
accepted as the source of truth. Entries expire; nothing here is a second database.
"""

import time
from typing import Any

_TTL_SECONDS = 15 * 60
# 15-second telemetry batches plus normal analysis latency; retention is not freshness.
_FRESH_SECONDS = 60
_MUST_STOP = {"rest_then_decide", "stop_and_get_help", "stop_rest_and_get_help"}
_latest: dict[str, dict[str, Any]] = {}
_epoch = 0


class Superseded(RuntimeError):
    """An analysis that was running when the demo was reset: its result belongs to the scenario that was left."""


def epoch() -> int:
    return _epoch


def start_new_epoch() -> int:
    global _epoch
    _epoch += 1
    return _epoch


def remember_vehicle_situation(
    vehicle_id: str,
    assessment: dict[str, Any],
    trace: list[dict[str, Any]] | None,
    plan: dict[str, Any] | None,
    *,
    now: float | None = None,
) -> dict[str, Any]:
    """Keep the newest assessment. Garage rows are name and distance only."""
    severity = str((assessment or {}).get("severity") or "normal")
    code = str((plan or {}).get("code") or "")
    snapshot = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mono": now if now is not None else time.monotonic(),
        "severity": severity,
        "diagnosis": str((assessment or {}).get("diagnosis") or "")[:500],
        "recommendations": [str(item) for item in ((assessment or {}).get("recommendations") or [])[:3]],
        "plan": code or None,
        "must_stop": severity == "critical" or code in _MUST_STOP,
        "garages": _garages(trace or []),
    }
    _latest[str(vehicle_id)] = snapshot
    return snapshot


def current_situation(vehicle_id: str, *, now: float | None = None) -> dict[str, Any] | None:
    item = _latest.get(str(vehicle_id))
    if item is None:
        return None
    clock = now if now is not None else time.monotonic()
    if clock - float(item["mono"]) > _TTL_SECONDS:
        return None
    return {**{key: value for key, value in item.items() if key != "mono"},
            "age_seconds": max(0, clock - float(item["mono"])),
            "fresh": clock - float(item["mono"]) <= _FRESH_SECONDS}


def clear_situations() -> None:
    _latest.clear()


def _garages(trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for item in trace:
        if not isinstance(item, dict) or item.get("tool") != "search_nearby_garages":
            continue
        result = item.get("result")
        rows: list[Any] = []
        if isinstance(result, dict):
            raw = result.get("options") or result.get("garages") or []
            if isinstance(raw, list):
                rows = raw
        elif isinstance(result, list):
            rows = result
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or row.get("label") or "").strip()
            distance = row.get("distance_km")
            if not name or isinstance(distance, bool) or not isinstance(distance, (int, float)):
                continue
            found.append({"name": name[:80], "distance_km": round(float(distance), 2)})
    found.sort(key=lambda row: row["distance_km"])
    return found[:5]
