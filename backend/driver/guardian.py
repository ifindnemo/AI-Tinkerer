"""Vehicle Guardian: one deterministic decision from the car (ECU) and the driver (camera).

ECU tells how the car is, the camera tells how the driver is, this policy decides the alert and
the mandatory action, and the agent may only reword the explanation. Nothing here waits for the
LLM, so the alert also works with AGENT_MODE=rules or without a network.

`decide()` is the pure core. Its cases live in guardian_cases.json, which the browser mirror
(frontend/src/lib/guardian/policy.ts) is tested against too, so the two cannot drift apart.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from agent.safety import COOLANT_CRITICAL_C
from analysis.detector import thresholds
from driver.rules import RuleResult
from driver.schemas import DriverEvent, VehicleSnapshot

Severity = Literal["normal", "warning", "critical"]
Action = Literal["continue", "reduce_load", "refocus", "stop_nearest_safe", "stay_parked", "check_camera", "stop_engine"]

MOVING_KMH = 5.0
RESPONSE_TIMEOUT = timedelta(seconds=10)  # an unanswered driver alert escalates after this
DEMO_VEHICLE_ID = "bmw-m2"  # the seeded maintenance history belongs to the demo car
CASES_FILE = Path(__file__).with_name("guardian_cases.json")
_RANK = {"normal": 0, "warning": 1, "critical": 2}
_LOW = ("drowsy", "distracted")
_COOLING_WORDS = ("làm mát", "két nước", "quá nhiệt", "nước làm mát", "thermostat", "bơm nước")

log = logging.getLogger("car_neuron.guardian")


def _max(*levels: str) -> Severity:
    return max(levels, key=lambda level: _RANK[level])  # type: ignore[return-value]


def vehicle_level(coolant_c: float, warn_c: float) -> Severity:
    if coolant_c >= COOLANT_CRITICAL_C:
        return "critical"
    return "warning" if coolant_c >= warn_c else "normal"


def attention_of(state: str) -> str:
    """The three states of the product brief: attentive, low_attention, unknown."""
    if state in _LOW:
        return "low_attention"
    return "unknown" if state in ("no_face", "uncertain") else "attentive"


@dataclass(frozen=True)
class Decision:
    severity: Severity
    action: Action
    must_stop: bool
    attention: str
    vehicle_level: Severity
    driver_severity: Severity  # after acknowledgement / missing response


def decide(*, speed_kmh: float, coolant_c: float, warn_c: float, driver_state: str, driver_severity: str,
           responded: bool, unanswered: bool) -> Decision:
    level = vehicle_level(coolant_c, warn_c)
    moving = speed_kmh >= MOVING_KMH
    attention = attention_of(driver_state)
    driver: Severity = driver_severity  # type: ignore[assignment]
    if driver != "normal" and driver_state in _LOW:
        if responded:
            driver = "warning"  # the response is recorded; the alert itself stays until it expires
        elif unanswered:
            driver = "critical"

    if level == "critical":
        # Mandatory and independent of the driver: no state of the driver can soften it.
        return Decision("critical", "stop_engine", True, attention, level, driver)
    if driver_state == "drowsy" and driver != "normal":
        return Decision(_max(driver, level), "stop_nearest_safe" if moving else "stay_parked", moving, attention, level, driver)
    if driver_state == "distracted" and driver != "normal":
        return Decision(_max(driver, level), "refocus", False, attention, level, driver)
    if level == "warning":
        return Decision(_max(driver, level), "reduce_load", False, attention, level, driver)
    if driver != "normal":
        return Decision(driver, "check_camera", False, attention, level, driver)
    return Decision(driver, "continue", False, attention, level, driver)


def acknowledgement_valid(events: list[DriverEvent], acknowledged_at: datetime | None) -> bool:
    """The client's claim is checked against the session's own events: the confirming event must
    exist, be reliable, show open eyes facing forward, follow a low-attention event, and no new
    low-attention event may come after it."""
    if acknowledged_at is None:
        return False
    confirming = next((e for e in events if e.captured_at == acknowledged_at), None)
    if (
        confirming is None
        or not confirming.face_present
        or confirming.confidence < 0.5
        or confirming.state != "attentive"
        or confirming.eyes.closed
        or confirming.head.direction != "forward"
    ):
        return False
    reliable = [e for e in events if e.face_present and e.confidence >= 0.5]
    alerted = any(e.state in _LOW and e.captured_at < acknowledged_at for e in reliable)
    relapsed = any(e.state in _LOW and e.captured_at > acknowledged_at for e in reliable)
    return alerted and not relapsed


def maintenance_context(vehicle_id: str = DEMO_VEHICLE_ID) -> dict[str, Any] | None:
    """A short, labelled summary of the seeded history. Context only, never a cause."""
    try:
        from agent.tools.maintenance_history import get_maintenance_history

        history = get_maintenance_history(vehicle_id)
    except Exception:
        log.warning("maintenance history unavailable", exc_info=True)
        return None
    records = history.get("records", [])
    cooling = [r for r in records if any(w in f"{r.get('fault_label', '')} {r.get('diagnosis', '')}".lower() for w in _COOLING_WORDS)]
    last = max(records, key=lambda r: r.get("date", ""), default=None)
    return {
        "vehicleId": vehicle_id,
        "simulated": True,
        "records": len(records),
        "coolingRecords": len(cooling),
        "last": {"date": last.get("date"), "label": last.get("fault_label"), "status": last.get("status")} if last else None,
        "recent": [
            {"date": r.get("date"), "label": r.get("fault_label"), "status": r.get("status")}
            for r in sorted(records, key=lambda r: r.get("date", ""))[-3:]
        ],
    }


def _num(value: float) -> str:
    return f"{value:.0f}" if float(value).is_integer() else f"{value:.1f}".replace(".", ",")


def _date(value: str | None) -> str:
    try:
        return datetime.fromisoformat(value or "").strftime("%d/%m/%Y")
    except ValueError:
        return value or "?"


@dataclass(frozen=True)
class GuardianResult:
    decision: Decision
    summary: str
    evidence: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    block: dict[str, Any] = field(default_factory=dict)

    @property
    def episode_key(self) -> str:
        d = self.decision
        return f"{d.action}:{d.severity}:{d.vehicle_level}:{d.attention}:{d.driver_severity}"


def combine(
    rule: RuleResult,
    events: list[DriverEvent],
    vehicle: VehicleSnapshot,
    *,
    responded: bool,
    unanswered: bool,
    alert_since: datetime | None,
    maintenance: dict[str, Any] | None,
) -> GuardianResult:
    warn_c, _ = thresholds()
    d = decide(speed_kmh=vehicle.speed_kmh, coolant_c=vehicle.coolant_c, warn_c=warn_c, driver_state=rule.state,
               driver_severity=rule.severity, responded=responded, unanswered=unanswered)
    speed, coolant = f"{round(vehicle.speed_kmh)}", _num(vehicle.coolant_c)
    hot = d.vehicle_level == "warning"
    latest = events[-1]
    window = [e for e in events if e.face_present and e.confidence >= 0.5 and latest.captured_at - e.captured_at <= timedelta(seconds=60)]
    closed_ms = max((e.eyes.closed_ms for e in window), default=0)

    ecu = f"ECU ({'mô phỏng' if vehicle.source == 'simulated' else 'OBD'}): {speed} km/h, nước làm mát {coolant}°C"
    if vehicle.engine_load_pct is not None:
        ecu += f", tải máy {_num(vehicle.engine_load_pct)}%"
    if vehicle.driving_minutes is not None:
        ecu += f", đã lái liên tục {vehicle.driving_minutes} phút"
    ecu += f" (cảnh báo từ {_num(warn_c)}°C, nguy hiểm từ {_num(COOLANT_CRITICAL_C)}°C)."
    evidence = [ecu, *(f"Camera: {item}" for item in rule.evidence)]
    if responded:
        evidence.append("Tài xế đã xác nhận cảnh báo khi mắt mở và nhìn thẳng.")
    elif unanswered and alert_since is not None:
        waited = int((latest.captured_at - alert_since).total_seconds())
        evidence.append(f"Chưa có phản hồi của tài xế sau {waited} giây kể từ cảnh báo.")
    if maintenance:
        line = f"Lịch sử bảo trì (mô phỏng): {maintenance['records']} lần vào garage"
        line += ", chưa ghi nhận sửa chữa hệ thống làm mát" if not maintenance["coolingRecords"] else f", {maintenance['coolingRecords']} lần liên quan hệ thống làm mát"
        if maintenance.get("last"):
            line += f"; gần nhất {_date(maintenance['last']['date'])}: {maintenance['last']['label']}"
        evidence.append(line + ". Chỉ là bối cảnh, không xác định nguyên nhân.")

    heat = f"nhiệt độ động cơ đang ở mức cảnh báo ({coolant}°C) nhưng chưa phải dừng khẩn cấp"
    if d.action == "stop_engine":
        summary = f"Động cơ quá nhiệt nghiêm trọng ({coolant}°C). Đây là hành động bắt buộc, không phụ thuộc trạng thái người lái."
        recommendations = [
            "Tấp vào vị trí an toàn gần nhất và tắt động cơ.",
            "Không tiếp tục đến trạm nghỉ hoặc garage.",
            "Không mở nắp két nước khi động cơ còn nóng.",
        ]
    elif d.action in ("stop_nearest_safe", "stay_parked"):
        parts = [f"Xe đang chạy {speed} km/h" if d.must_stop else "Xe đang đứng yên"]
        if hot:
            parts.append(heat)
        long_drive = vehicle.driving_minutes is not None and vehicle.driving_minutes >= 120
        driver = "người lái có dấu hiệu mất tỉnh táo" + (f" sau hơn {vehicle.driving_minutes // 60} giờ vận hành" if long_drive else "")
        summary = ", ".join(parts) + " và " + driver + "."
        if responded:
            summary = "Đã ghi nhận phản hồi của tài xế. " + summary
        if d.must_stop:
            summary += " Không nên tiếp tục hành trình đến garage ở xa."
            recommendations = ["Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa."]
        else:
            recommendations = ["Giữ xe ở nơi đỗ an toàn; chưa tiếp tục lái khi còn buồn ngủ."]
        if hot:
            recommendations.append("Khi đã dừng, kiểm tra lại nhiệt độ động cơ trước khi khởi hành lại.")
        recommendations.append("Nghỉ ít nhất 15–20 phút hoặc đổi người lái.")
    elif d.action == "refocus":
        summary = rule.summary + (f" Đồng thời {heat}." if hot else "")
        recommendations = ["Đưa mắt nhìn lại phía trước ngay."]
        if hot:
            recommendations.append("Giảm tốc và theo dõi nhiệt độ; nếu tiếp tục tăng, dừng ở nơi an toàn.")
        recommendations.append("Nếu cần xem điện thoại hay chỉnh thiết bị, hãy dừng xe ở nơi an toàn trước.")
    elif d.action == "reduce_load":
        if d.attention == "unknown":
            who = "Không thể xác định trạng thái người lái từ camera. Cảnh báo kỹ thuật của xe vẫn được duy trì theo dữ liệu ECU."
        elif responded:
            who = "Người lái đã xác nhận cảnh báo."
        else:
            who = "Người lái đang chú ý."
        summary = f"Nhiệt độ động cơ đang tăng ({coolant}°C) và cần được theo dõi. {who}"
        recommendations = [
            "Giảm tải động cơ: giảm tốc, tránh tăng ga mạnh.",
            "Theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn.",
            "Đến garage phù hợp nếu nhiệt độ không tiếp tục tăng.",
        ]
    else:
        summary, recommendations = rule.summary, list(rule.recommendations)

    block = {
        "vehicle": {
            "source": vehicle.source,
            "capturedAt": vehicle.captured_at.isoformat().replace("+00:00", "Z"),
            "speedKmh": vehicle.speed_kmh,
            "coolantC": vehicle.coolant_c,
            "engineLoadPct": vehicle.engine_load_pct,
            "drivingMinutes": vehicle.driving_minutes,
            "level": d.vehicle_level,
            "warnC": warn_c,
            "criticalC": COOLANT_CRITICAL_C,
            "moving": vehicle.speed_kmh >= MOVING_KMH,
        },
        "driver": {
            "attention": d.attention,
            "state": rule.state,
            "severity": d.driver_severity,
            "closedMs": closed_ms,
            "responded": responded,
            "unanswered": unanswered,
            "alertSince": alert_since.isoformat().replace("+00:00", "Z") if alert_since else None,
        },
        "action": d.action,
        "mustStop": d.must_stop,
        "maintenance": maintenance,
    }
    return GuardianResult(d, summary, list(dict.fromkeys(evidence))[:8], recommendations[:4], block)


def load_cases() -> list[dict[str, Any]]:
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))
