"""Rule-only assessment, used when the LLM is off (AGENT_MODE=rules), fails or times out.

It states only what the detector and the car's DTCs show; the UI labels it
"Đánh giá theo luật".
"""

from datetime import datetime
from typing import Any

from agent.safety import COOLANT_CRITICAL_C, evaluate_hard_safety
from analysis.detector import thresholds
from schemas import Severity, VehicleAssessment
from telemetry.signals import SIGNALS, format_agent_value

_RANK = {Severity.NORMAL: 0, Severity.WARNING: 1, Severity.CRITICAL: 2}
_URGENCY = {"critical": Severity.CRITICAL, "warning": Severity.WARNING, "info": Severity.NORMAL}
_LABEL_BY_AGENT_KEY = {signal.agent_key: signal.label for signal in SIGNALS}


def _raise(current: Severity, candidate: Severity) -> Severity:
    return candidate if _RANK[candidate] > _RANK[current] else current


def rules_assessment(context: dict[str, Any]) -> VehicleAssessment:
    findings = context.get("detector_findings", [])
    dtc = context.get("dtc_snapshot") or {}
    knowledge = dtc.get("knowledge", {})
    severity = Severity.NORMAL
    evidence: list[str] = []
    faults: list[str] = []
    advice: list[str] = []

    for finding in findings:
        if finding["rule"] == "R3":
            continue  # the codes are listed one by one below
        evidence.append(finding["message"])
        if finding["rule"] == "R2":
            # A fast rise alone can be a normal warm-up; R1 (sustained heat) is what warns.
            advice.append("Theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn và để máy nguội.")
            continue
        severity = _raise(severity, Severity.WARNING)
        if finding["rule"] == "R1":
            faults.append("Hệ thống làm mát cần kiểm tra")
            advice += [
                "Theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn và để máy nguội.",
                "Kiểm tra mức nước làm mát và quạt két nước khi máy đã nguội.",
            ]
        elif finding["rule"] == "R4":
            faults.append("Hệ thống sạc / ắc quy cần kiểm tra")
            advice.append("Kiểm tra ắc quy và máy phát tại garage.")
        elif finding["rule"] == "R5":
            faults.append("Nghi cảm biến nhiệt độ nước làm mát")
            advice.append("Kiểm tra cảm biến nhiệt độ nước làm mát.")

    for kind, codes in (("stored", dtc.get("stored", [])), ("pending", dtc.get("pending", []))):
        for code in codes:
            info = knowledge.get(code) or {}
            urgency = _URGENCY.get(info.get("urgency", "warning"), Severity.WARNING)
            if kind == "pending":
                urgency = Severity.WARNING if urgency != Severity.NORMAL else Severity.NORMAL
            severity = _raise(severity, urgency)
            label = "đã lưu" if kind == "stored" else "đang chờ xác nhận"
            evidence.append(f"Mã {code} ({label}): {info.get('title', 'chưa có trong kho tra cứu')}.")
            faults.append(info.get("title", f"Mã {code}"))
            if info.get("advice"):
                advice.append(info["advice"])
            if info.get("checks"):
                advice.append("Garage nên kiểm tra: " + "; ".join(info["checks"][:2]) + ".")
            frame = (dtc.get("freeze_frames") or {}).get(code)
            if frame:
                parts = [format_agent_value(key, value) for key, value in list(frame.items())[:4]]
                evidence.append(f"Lúc mã {code} xuất hiện: " + ", ".join(parts) + ".")

    records = context.get("records", [])
    if severity == Severity.NORMAL and not evidence:
        diagnosis = (
            f"Theo các luật kiểm tra, {len(records)} mẫu gần nhất chưa vượt ngưỡng cảnh báo "
            "và xe không báo mã lỗi."
        )
        evidence = ["Không có luật cảnh báo nào kích hoạt.", "Không có mã lỗi DTC."]
        advice = ["Tiếp tục theo dõi xe trong các chuyến tiếp theo."]
    else:
        diagnosis = "Theo các luật kiểm tra: " + " ".join(evidence[:3])
        if not advice:
            advice = ["Đưa xe tới garage để kiểm tra khi thuận tiện."]

    missing = [_LABEL_BY_AGENT_KEY.get(key, key) for key in context.get("missing_signals", [])]
    return VehicleAssessment(
        severity=severity,
        diagnosis=diagnosis[:1500],
        suspected_faults=list(dict.fromkeys(faults))[:5],
        evidence=list(dict.fromkeys(evidence))[:8],
        confidence=0.6,
        missing_data=missing[:8],
        recommendations=list(dict.fromkeys(advice))[:5],
    )


def _slope_per_minute(points: list[tuple[datetime, float]]) -> float:
    """Least-squares slope in °C per minute (0 with fewer than two distinct times)."""
    if len(points) < 2:
        return 0.0
    t0 = points[0][0]
    xs = [(t - t0).total_seconds() / 60 for t, _ in points]
    ys = [value for _, value in points]
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
    spread = sum((x - mean_x) ** 2 for x in xs)
    if spread == 0:
        return 0.0
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / spread


def batch_rules_assessment(context: dict[str, Any]) -> VehicleAssessment:
    """Rule-only assessment of a browser blackbox batch (schema v1), used when the LLM is off
    (AGENT_MODE=rules), slow or failing. The detector of the device path needs a stored trip, so
    this reads the batch directly: the coolant threshold, the hard safety floors and the trend.
    `VehicleAgent.finalize` still applies its floors and ceilings afterwards."""
    records = context.get("records") or []
    warn_c, rise_per_min = thresholds()
    safety = evaluate_hard_safety(context)
    coolant = [
        (datetime.fromisoformat(str(r["captured_at"]).replace("Z", "+00:00")), float(r["coolant_temp_c"]))
        for r in records
        if r.get("captured_at") and r.get("coolant_temp_c") is not None
    ]
    severity = safety.minimum_severity
    evidence: list[str] = list(safety.reasons)
    faults: list[str] = []
    advice: list[str] = []
    diagnosis_parts: list[str] = []

    if coolant:
        values = [value for _, value in coolant]
        last = values[-1]
        hot = sum(value >= warn_c for value in values) >= max(3, len(values) // 2) and last >= warn_c
        slope = _slope_per_minute(coolant)
        rising = len(coolant) >= 3 and last > 95 and slope > rise_per_min
        if last >= COOLANT_CRITICAL_C:
            severity = _raise(severity, Severity.CRITICAL)
            diagnosis_parts.append(f"nước làm mát đã tới {last:.1f}°C, chạm ngưỡng nguy hiểm {COOLANT_CRITICAL_C:.0f}°C")
            faults.append("Hệ thống làm mát quá nhiệt")
        elif hot:
            severity = _raise(severity, Severity.WARNING)
            diagnosis_parts.append(f"nước làm mát {last:.1f}°C, vượt ngưỡng cảnh báo {warn_c:.0f}°C")
            faults.append("Hệ thống làm mát cần kiểm tra")
            advice += [
                "Giảm tải động cơ và theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn và để máy nguội.",
                "Kiểm tra mức nước làm mát và quạt két nước khi máy đã nguội.",
            ]
        if hot or last >= COOLANT_CRITICAL_C:
            evidence.append(f"Nước làm mát {min(values):.1f}–{last:.1f}°C trong {len(values)} mẫu gần nhất (ngưỡng cảnh báo {warn_c:.0f}°C).")
            fans = [r["fan_percent"] for r in records if r.get("fan_percent") is not None]
            if fans and fans[-1] == 0:
                evidence.append("Quạt làm mát đang ở 0% trong khi nhiệt độ cao.")
        if rising:
            evidence.append(f"Nước làm mát tăng {slope:.1f}°C/phút trong {(coolant[-1][0] - coolant[0][0]).total_seconds():.0f} giây.")
            if severity == Severity.NORMAL:
                advice.append("Theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn và để máy nguội.")

    if severity == Severity.CRITICAL:
        advice = [
            "Dừng xe ở vị trí an toàn, tắt máy và không mở nắp két nước khi máy còn nóng.",
            *[item for item in advice if not item.startswith("Giảm tải")],
        ]
    if severity != Severity.NORMAL and not diagnosis_parts:
        diagnosis_parts.append("luật an toàn của hệ thống báo bất thường ở dữ liệu xe")
    if severity == Severity.NORMAL:
        diagnosis = f"Theo các luật kiểm tra, {len(records)} mẫu gần nhất chưa vượt ngưỡng cảnh báo."
        evidence = evidence or ["Không có luật cảnh báo nào kích hoạt."]
        advice = advice or ["Tiếp tục theo dõi xe trong các gói dữ liệu tiếp theo."]
    else:
        diagnosis = "Theo các luật kiểm tra: " + "; ".join(diagnosis_parts) + "."
        advice = advice or ["Đưa xe tới garage để kiểm tra khi thuận tiện."]
    return VehicleAssessment(
        severity=severity,
        diagnosis=diagnosis[:1500],
        suspected_faults=list(dict.fromkeys(faults))[:5],
        evidence=list(dict.fromkeys(evidence))[:8],
        confidence=0.6,
        missing_data=[],
        recommendations=list(dict.fromkeys(advice))[:5],
    )


def batch_policy(context: dict[str, Any]) -> dict[str, Any] | None:
    """Floor for a browser blackbox batch: the coolant early-warning threshold held up to the newest
    sample. The OBD path's rule R1 needs 20 s of history, longer than a whole 15-sample batch, so
    without this a model that shrugs at 106 °C could answer "normal" while the Guardian already warns."""
    records = context.get("records") or []
    values = [float(r["coolant_temp_c"]) for r in records if r.get("coolant_temp_c") is not None]
    if len(values) < 5:
        return None
    warn_c, _ = thresholds()
    run = 0
    for value in reversed(values):
        if value < warn_c:
            break
        run += 1
    if run < min(8, len(values)):
        return None
    seconds = run * float(context.get("sample_interval_ms") or 1000) / 1000
    return {
        "minimum_severity": "warning",
        "reasons": [f"Nước làm mát ≥ {warn_c:.0f}°C liên tục {seconds:.0f} giây (hiện {values[-1]:.1f}°C)."],
        "ceiling_normal": False,
    }
