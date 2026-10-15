"""Vehicle Guardian: one deterministic decision from the car (ECU) and the driver (camera).

ECU tells how the car is, the camera tells how the driver is, this policy decides the alert and
the mandatory action, and the agent may only reword the explanation. Nothing here waits for the
LLM, so the alert also works with AGENT_MODE=rules or without a network.

`decide()` is the pure core. Its cases live in guardian_cases.json, which the browser mirror
(frontend/src/lib/guardian/policy.ts) is tested against too, so the two cannot drift apart.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from agent.safety import COOLANT_CRITICAL_C
from analysis.detector import thresholds
from driver.rules import RuleResult
from driver.schemas import DriverEvent, VehicleSnapshot
from lang import normalize, number, pick

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


def _num(value: float, lang: str = "vi") -> str:
    return f"{value:.0f}" if float(value).is_integer() else number(value, lang)


_SEVERITY_WORDS_EN = {"Cảnh báo": "Warning", "Trung bình": "Moderate", "Nghiêm trọng": "Severe"}


def _fault_label(label: str | None, lang: str) -> str:
    """The seeded history labels are Vietnamese ("Nghiêm trọng - Nghi bỏ máy (Possible Misfire)"); in English they
    become "Severe - Possible Misfire", which the English part of the label already says."""
    text = (label or "").strip()
    if lang != "en" or not text:
        return text
    if text == "Không phát hiện lỗi":
        return "No fault found"
    match = re.match(r"^(Cảnh báo|Trung bình|Nghiêm trọng)\s*-\s*.*\(([^)]+)\)\s*$", text)
    return f"{_SEVERITY_WORDS_EN[match.group(1)]} - {match.group(2)}" if match else text


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
    lang: str = "vi"

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
    lang = normalize(rule.lang)  # the wording follows the rule result; the decision below never does
    warn_c, _ = thresholds()
    d = decide(speed_kmh=vehicle.speed_kmh, coolant_c=vehicle.coolant_c, warn_c=warn_c, driver_state=rule.state,
               driver_severity=rule.severity, responded=responded, unanswered=unanswered)
    speed, coolant = f"{round(vehicle.speed_kmh)}", _num(vehicle.coolant_c, lang)
    hot = d.vehicle_level == "warning"
    latest = events[-1]
    window = [e for e in events if e.face_present and e.confidence >= 0.5 and latest.captured_at - e.captured_at <= timedelta(seconds=60)]
    closed_ms = max((e.eyes.closed_ms for e in window), default=0)

    simulated = vehicle.source == "simulated"
    ecu = pick(lang, f"ECU ({'mô phỏng' if simulated else 'OBD'}): {speed} km/h, nước làm mát {coolant}°C",
               f"ECU ({'simulated' if simulated else 'OBD'}): {speed} km/h, coolant {coolant}°C")
    if vehicle.engine_load_pct is not None:
        ecu += pick(lang, f", tải máy {_num(vehicle.engine_load_pct, lang)}%", f", engine load {_num(vehicle.engine_load_pct, lang)}%")
    if vehicle.driving_minutes is not None:
        ecu += pick(lang, f", đã lái liên tục {vehicle.driving_minutes} phút", f", driving for {vehicle.driving_minutes} minutes")
    ecu += pick(lang, f" (cảnh báo từ {_num(warn_c, lang)}°C, nguy hiểm từ {_num(COOLANT_CRITICAL_C, lang)}°C).",
                f" (warning from {_num(warn_c, lang)}°C, critical from {_num(COOLANT_CRITICAL_C, lang)}°C).")
    evidence = [ecu, *(f"Camera: {item}" for item in rule.evidence)]
    if responded:
        evidence.append(pick(lang, "Tài xế đã xác nhận cảnh báo khi mắt mở và nhìn thẳng.",
                             "The driver confirmed the alert with eyes open and facing forward."))
    elif unanswered and alert_since is not None:
        waited = int((latest.captured_at - alert_since).total_seconds())
        evidence.append(pick(lang, f"Chưa có phản hồi của tài xế sau {waited} giây kể từ cảnh báo.",
                             f"No driver response {waited} seconds after the alert."))
    if maintenance:
        line = pick(lang, f"Lịch sử bảo trì (mô phỏng): {maintenance['records']} lần vào garage",
                    f"Service history (simulated): {maintenance['records']} garage visits")
        line += (pick(lang, ", chưa ghi nhận sửa chữa hệ thống làm mát", ", no cooling-system repairs recorded")
                 if not maintenance["coolingRecords"]
                 else pick(lang, f", {maintenance['coolingRecords']} lần liên quan hệ thống làm mát",
                           f", {maintenance['coolingRecords']} cooling-related"))
        if maintenance.get("last"):
            label = _fault_label(maintenance["last"]["label"], lang)
            line += pick(lang, f"; gần nhất {_date(maintenance['last']['date'])}: {label}",
                         f"; latest {_date(maintenance['last']['date'])}: {label}")
        evidence.append(line + pick(lang, ". Chỉ là bối cảnh, không xác định nguyên nhân.", ". Context only, not a cause."))

    heat = pick(lang, f"nhiệt độ động cơ đang ở mức cảnh báo ({coolant}°C) nhưng chưa phải dừng khẩn cấp",
                f"the engine temperature is at warning level ({coolant}°C) but not yet an emergency stop")
    if d.action == "stop_engine":
        summary = pick(lang, f"Động cơ quá nhiệt nghiêm trọng ({coolant}°C). Đây là hành động bắt buộc, không phụ thuộc trạng thái người lái.",
                       f"Severe engine overheating ({coolant}°C). This is mandatory, whatever the driver's state.")
        recommendations = [
            pick(lang, "Tấp vào vị trí an toàn gần nhất và tắt động cơ.", "Pull over at the nearest safe place and switch off the engine."),
            pick(lang, "Không tiếp tục đến trạm nghỉ hoặc garage.", "Do not continue to a rest stop or garage."),
            pick(lang, "Không mở nắp két nước khi động cơ còn nóng.", "Do not open the radiator cap while the engine is hot."),
        ]
    elif d.action in ("stop_nearest_safe", "stay_parked"):
        long_drive = vehicle.driving_minutes is not None and vehicle.driving_minutes >= 120
        if lang == "en":
            summary = (f"The car is moving at {speed} km/h" if d.must_stop else "The car is stationary")
            if hot:
                summary += f", {heat}"
            summary += ", and the driver shows signs of low alertness" + (f" after more than {vehicle.driving_minutes // 60} hours of driving" if long_drive else "") + "."
        else:
            parts = [f"Xe đang chạy {speed} km/h" if d.must_stop else "Xe đang đứng yên"]
            if hot:
                parts.append(heat)
            driver = "người lái có dấu hiệu mất tỉnh táo" + (f" sau hơn {vehicle.driving_minutes // 60} giờ vận hành" if long_drive else "")
            summary = ", ".join(parts) + " và " + driver + "."
        if responded:
            summary = pick(lang, "Đã ghi nhận phản hồi của tài xế. ", "The driver's response is recorded. ") + summary
        if d.must_stop:
            summary += pick(lang, " Không nên tiếp tục hành trình đến garage ở xa.", " Do not continue the trip to a distant garage.")
            recommendations = [pick(lang, "Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa.",
                                    "Stop at the nearest safe place to rest; do not continue to a distant garage.")]
        else:
            recommendations = [pick(lang, "Giữ xe ở nơi đỗ an toàn; chưa tiếp tục lái khi còn buồn ngủ.",
                                    "Keep the car safely parked; do not resume driving while drowsy.")]
        if hot:
            recommendations.append(pick(lang, "Khi đã dừng, kiểm tra lại nhiệt độ động cơ trước khi khởi hành lại.",
                                        "Once stopped, check the engine temperature again before setting off."))
        recommendations.append(pick(lang, "Nghỉ ít nhất 15–20 phút hoặc đổi người lái.", "Rest for at least 15–20 minutes or change drivers."))
    elif d.action == "refocus":
        summary = rule.summary + (pick(lang, f" Đồng thời {heat}.", f" At the same time, {heat}.") if hot else "")
        recommendations = [pick(lang, "Đưa mắt nhìn lại phía trước ngay.", "Look back at the road now.")]
        if hot:
            recommendations.append(pick(lang, "Giảm tốc và theo dõi nhiệt độ; nếu tiếp tục tăng, dừng ở nơi an toàn.",
                                        "Slow down and watch the temperature; if it keeps rising, stop somewhere safe."))
        recommendations.append(pick(lang, "Nếu cần xem điện thoại hay chỉnh thiết bị, hãy dừng xe ở nơi an toàn trước.",
                                    "If you need to use your phone or adjust a device, stop somewhere safe first."))
    elif d.action == "reduce_load":
        if d.attention == "unknown":
            who = pick(lang, "Không thể xác định trạng thái người lái từ camera. Cảnh báo kỹ thuật của xe vẫn được duy trì theo dữ liệu ECU.",
                       "The camera cannot determine the driver's state. The vehicle warning stays on, based on the ECU data.")
        elif responded:
            who = pick(lang, "Người lái đã xác nhận cảnh báo.", "The driver confirmed the alert.")
        else:
            who = pick(lang, "Người lái đang chú ý.", "The driver is attentive.")
        summary = pick(lang, f"Nhiệt độ động cơ đang tăng ({coolant}°C) và cần được theo dõi. {who}",
                       f"Engine temperature is rising ({coolant}°C) and needs watching. {who}")
        recommendations = [
            pick(lang, "Giảm tải động cơ: giảm tốc, tránh tăng ga mạnh.", "Ease the engine load: slow down, avoid hard acceleration."),
            pick(lang, "Theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn.", "Watch the temperature; if it keeps rising, stop somewhere safe."),
            pick(lang, "Đến garage phù hợp nếu nhiệt độ không tiếp tục tăng.", "Head to a suitable garage if the temperature stops rising."),
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
    return GuardianResult(d, summary, list(dict.fromkeys(evidence))[:8], recommendations[:4], block, lang)


def load_cases() -> list[dict[str, Any]]:
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))
