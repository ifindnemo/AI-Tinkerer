"""Rule-only assessment, used when the LLM is off (AGENT_MODE=rules), fails or times out.

It states only what the detector and the car's DTCs show; the UI labels it
"Đánh giá theo luật".
"""

from typing import Any

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
