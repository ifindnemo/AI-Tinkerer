"""The newest driver-attention summary per vehicle, so the vehicle agent sees car and driver together.

The garage camera posts only when it raises an alert (drowsy or distracted), with
`context.vehicleId`; the driver service stores a short summary here (structured values only,
never images). Both blackbox paths read it when they next build the agent input: the browser
blackbox batch (/api/telemetry/batch) and the OBD device worker. Nothing is re-analysed because
of it; the driver alert itself is spoken by the driver service.

In memory only: restarting the backend forgets it, and a summary older than STALE_SECONDS is
reported as "stale" instead of being trusted.
"""

import re
import time
from collections.abc import Callable
from datetime import datetime, timezone
from threading import Lock
from typing import Any

# The camera posts only when an alert rises, so the last alert stays valid as long as the rules
# hold a microsleep alert (driver/rules.py MICROSLEEP_HOLD); a confirmation updates it sooner.
STALE_SECONDS = 60.0
MOVING_KMH = 5.0
_NEGATED = re.compile(r"\b(không|đừng|chưa|thay vì|tránh)\b", re.IGNORECASE)
_GARAGE_TRIP = re.compile(r"(đưa xe|lái xe|chạy|đi|đến|tới)[^.;]{0,20}garage|garage[^.;]{0,30}(khi thuận tiện|sớm)", re.IGNORECASE)

STOP_FOR_DRIVER = "Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa."


class DriverRegistry:
    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._lock = Lock()
        self._latest: dict[str, tuple[float, dict[str, Any]]] = {}

    def update(self, vehicle_id: str, summary: dict[str, Any]) -> bool:
        """Stores the summary; returns True when the driver's state changed."""
        key = (summary.get("attention"), summary.get("severity"), summary.get("responded"), summary.get("must_stop"))
        with self._lock:
            previous = self._latest.get(vehicle_id)
            stale = previous is None or self._clock() - previous[0] > STALE_SECONDS
            changed = stale or key != (previous[1].get("attention"), previous[1].get("severity"), previous[1].get("responded"), previous[1].get("must_stop"))
            self._latest[vehicle_id] = (self._clock(), dict(summary))
        return changed

    def get(self, vehicle_id: str) -> dict[str, Any]:
        with self._lock:
            entry = self._latest.get(vehicle_id)
        if entry is None:
            return {"status": "off", "note": "Camera tài xế chưa bật cho xe này."}
        age = self._clock() - entry[0]
        if age > STALE_SECONDS:
            return {"status": "stale", "age_seconds": round(age), "last": entry[1],
                    "note": "Camera tài xế đã ngừng gửi dữ liệu; không dùng trạng thái cũ để kết luận."}
        return {"status": "live", "age_seconds": round(age, 1), **entry[1]}

    def clear(self) -> None:
        with self._lock:
            self._latest.clear()


driver_registry = DriverRegistry()


def attach_driver(context: dict[str, Any], registry: DriverRegistry | None = None) -> dict[str, Any]:
    """Adds `driver_attention` to a vehicle agent context (in place) and returns it."""
    context["driver_attention"] = (registry or driver_registry).get(str(context.get("vehicle_id", "")))
    return context


def summary_from(*, source: str, attention: str, state: str, severity: str, closed_ms: int, confidence: float,
                 responded: bool, unanswered: bool, action: str | None, must_stop: bool, observed_at: datetime) -> dict[str, Any]:
    return {
        "source": source,
        "attention": attention,
        "state": state,
        "severity": severity,
        "closed_ms_max_60s": closed_ms,
        "confidence": round(confidence, 2),
        "responded": responded,
        "unanswered": unanswered,
        "guardian_action": action,
        "must_stop": must_stop,
        "observed_at": observed_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "privacy": "Chỉ số do camera tính trong trình duyệt; không có hình ảnh.",
    }


def vehicle_moving(context: dict[str, Any]) -> bool:
    records = context.get("records") or []
    speed = next((r.get("speed") for r in reversed(records) if r.get("speed") is not None), None)
    return speed is not None and float(speed) >= MOVING_KMH


def suggests_garage_trip(text: str) -> bool:
    for match in _GARAGE_TRIP.finditer(text):
        clause = re.split(r"[.;:!?,]", text[: match.start()])[-1] + match.group(0)
        if not _NEGATED.search(clause):
            return True
    return False
