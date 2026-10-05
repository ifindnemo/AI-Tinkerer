"""Deterministic rules that run on every batch, before (and instead of) the LLM.

All windows use sample time (`capturedAt`), never the wall clock, so replays and
the gateway's --fast mode behave like a real drive. Thresholds are the demo
defaults from docs/ke-hoach-demo-18-10.md (decision 5: speak up at 105 °C).
"""

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

COOLANT_HOT = 105.0  # R1: product early-warning threshold (env COOLANT_WARN_C)
COOLANT_HOT_HOLD = timedelta(seconds=20)
RISE_MIN_COOLANT = 95.0  # R2
RISE_PER_MINUTE = 3.0  # env COOLANT_RISE_PER_MIN
RISE_WINDOW = timedelta(seconds=60)
RISE_MIN_SPAN = timedelta(seconds=30)
RISE_MAX_LOAD_CHANGE = 5.0
VOLTAGE_LOW, VOLTAGE_HIGH, VOLTAGE_HOLD = 12.0, 15.2, timedelta(seconds=30)  # R4
STUCK_WINDOW = timedelta(minutes=10)  # R5
HEARTBEAT = timedelta(minutes=5)
LOOKBACK = STUCK_WINDOW  # how much history the detector needs


@dataclass(frozen=True)
class Finding:
    rule: str
    message: str
    floor: str | None = None  # minimum severity this rule imposes

    def to_dict(self) -> dict[str, Any]:
        return {"rule": self.rule, "message": self.message, "floor": self.floor}


def _time(sample: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(sample["capturedAt"])


def _series(samples: list[dict[str, Any]], name: str) -> list[tuple[datetime, float]]:
    return [(_time(s), s["signals"][name]) for s in samples if name in s["signals"]]


def _slope_per_minute(points: list[tuple[datetime, float]]) -> float:
    """Least-squares slope, °C per minute."""
    t0 = points[0][0]
    xs = [(t - t0).total_seconds() / 60 for t, _ in points]
    ys = [value for _, value in points]
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
    spread = sum((x - mean_x) ** 2 for x in xs)
    if spread == 0:
        return 0.0
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / spread


def _sustained(points: list[tuple[datetime, float]], hold: timedelta, test) -> tuple[bool, timedelta]:
    """Whether the latest run of points passing `test` lasts at least `hold`."""
    run_start = None
    for at, value in reversed(points):
        if not test(value):
            break
        run_start = at
    if run_start is None:
        return False, timedelta(0)
    duration = points[-1][0] - run_start
    return duration >= hold, duration


def thresholds() -> tuple[float, float]:
    """(R1 coolant °C, R2 rise °C/min). Set per car: some engines run near 100–105 °C normally."""
    return (
        float(os.getenv("COOLANT_WARN_C", COOLANT_HOT)),
        float(os.getenv("COOLANT_RISE_PER_MIN", RISE_PER_MINUTE)),
    )


def evaluate(samples: list[dict[str, Any]], dtc: dict[str, Any] | None = None) -> list[Finding]:
    """Findings for the newest sample, given up to 10 minutes of history (oldest first)."""
    findings: list[Finding] = []
    if not samples:
        return findings
    now = _time(samples[-1])
    hot_c, rise_per_minute = thresholds()

    coolant = _series(samples, "coolant")
    if coolant:
        hot, duration = _sustained(coolant, COOLANT_HOT_HOLD, lambda value: value >= hot_c)
        if hot:
            findings.append(Finding(
                "R1",
                f"Nước làm mát ≥ {hot_c:.0f}°C liên tục {duration.total_seconds():.0f} giây "
                f"(hiện {coolant[-1][1]:.1f}°C).",
                "warning",
            ))

        recent = [(t, v) for t, v in coolant if now - t <= RISE_WINDOW]
        if len(recent) >= 3 and recent[-1][0] - recent[0][0] >= RISE_MIN_SPAN and recent[-1][1] > RISE_MIN_COOLANT:
            slope = _slope_per_minute(recent)
            if slope > rise_per_minute:
                load = [(t, v) for t, v in _series(samples, "engineLoad") if now - t <= RISE_WINDOW]
                if load:
                    third = max(1, len(load) // 3)
                    start = sum(v for _, v in load[:third]) / third
                    end = sum(v for _, v in load[-third:]) / third
                    flat = end - start <= RISE_MAX_LOAD_CHANGE
                    context = f"tải máy {start:.0f} → {end:.0f}%"
                else:
                    flat, context = True, "không có dữ liệu tải máy"
                if flat:
                    findings.append(Finding(
                        "R2",
                        f"Nước làm mát tăng {slope:.1f}°C/phút trong "
                        f"{(recent[-1][0] - recent[0][0]).total_seconds():.0f} giây ({context}).",
                    ))

        window = [(t, v) for t, v in coolant if now - t <= STUCK_WINDOW]
        moving = any(s["signals"].get("speed", 0) > 0 for s in samples if now - _time(s) <= STUCK_WINDOW)
        if (
            window
            and now - window[0][0] >= STUCK_WINDOW - timedelta(seconds=5)
            and len({v for _, v in window}) == 1
            and moving
        ):
            findings.append(Finding(
                "R5",
                f"Nhiệt độ nước làm mát đứng yên ở {window[0][1]:.1f}°C suốt 10 phút khi xe đang chạy: "
                "nghi cảm biến.",
            ))

    battery = _series(samples, "battery")
    if battery:
        rpm = {t: v for t, v in _series(samples, "rpm")}
        low, low_for = _sustained(
            [(t, v) for t, v in battery if rpm.get(t, 0) > 500], VOLTAGE_HOLD, lambda v: v < VOLTAGE_LOW
        )
        high, high_for = _sustained(battery, VOLTAGE_HOLD, lambda v: v > VOLTAGE_HIGH)
        if low:
            findings.append(Finding(
                "R4", f"Điện áp {battery[-1][1]:.2f} V (< {VOLTAGE_LOW} V) khi nổ máy, kéo dài {low_for.total_seconds():.0f} giây."
            ))
        elif high:
            findings.append(Finding(
                "R4", f"Điện áp {battery[-1][1]:.2f} V (> {VOLTAGE_HIGH} V), kéo dài {high_for.total_seconds():.0f} giây."
            ))

    if dtc and (dtc.get("codes") or dtc.get("mil")):
        codes = ", ".join(f"{c['code']} ({'đã lưu' if c['kind'] == 'stored' else 'đang chờ'})" for c in dtc.get("codes", []))
        lamp = "đèn check engine bật" if dtc.get("mil") else "đèn check engine tắt"
        findings.append(Finding("R3", f"Mã lỗi hiện có: {codes or 'không có'}; {lamp}."))
    return findings


def should_analyze(
    *,
    batch_last_at: datetime,
    trip_id: str,
    findings: list[Finding],
    new_dtc_codes: list[str],
    profile_changed: bool,
    last: dict[str, Any] | None,
) -> str | None:
    """The trigger for a new analysis, or None. `last` is the latest analysis (or queued job)
    for the vehicle: {"trip_id", "at" (ISO), "rules"}."""
    if new_dtc_codes:
        return "dtc"
    if last is None or last["trip_id"] != trip_id:
        return "trip_start"
    if {f.rule for f in findings} - set(last["rules"]):
        return "detector"
    if profile_changed:
        return "profile"
    if batch_last_at - datetime.fromisoformat(last["at"]) >= HEARTBEAT:
        return "heartbeat"
    return None


def policy_for(findings: list[Finding], dtc: dict[str, Any] | None) -> dict[str, Any]:
    """Floor from the rules; ceiling to normal when nothing at all points at a problem."""
    floor = "warning" if any(f.floor == "warning" for f in findings) else "normal"
    reasons = [f.message for f in findings if f.floor]
    has_signal = bool(findings) or bool(dtc and (dtc.get("codes") or dtc.get("mil")))
    return {"minimum_severity": floor, "reasons": reasons, "ceiling_normal": not has_signal}
