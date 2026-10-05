from analysis.rules import rules_assessment
from schemas import Severity


def _context(findings, stored=(), frames=None):
    return {
        "records": [{"coolant_temp_c": 98}] * 5,
        "missing_signals": ["oil_temp_c"],
        "detector_findings": findings,
        "dtc_snapshot": {
            "mil": bool(stored),
            "stored": list(stored),
            "pending": [],
            "freeze_frames": frames or {},
            "knowledge": {
                "P0217": {"known": True, "title": "Động cơ quá nhiệt", "urgency": "critical",
                          "advice": "Dừng xe.", "checks": ["Kiểm tra quạt", "Kiểm tra bơm nước"]},
            },
        },
    }


def test_a_fast_rise_alone_is_evidence_not_a_warning() -> None:
    r2 = {"rule": "R2", "message": "Nước làm mát tăng 4.1°C/phút trong 49 giây.", "floor": None}
    assessment = rules_assessment(_context([r2]))
    assert assessment.severity == Severity.NORMAL
    assert r2["message"] in assessment.evidence
    assert assessment.suspected_faults == []


def test_sustained_heat_warns_and_p0217_is_critical_with_readable_freeze_frame() -> None:
    r1 = {"rule": "R1", "message": "Nước làm mát ≥ 105°C liên tục 21 giây.", "floor": "warning"}
    assert rules_assessment(_context([r1])).severity == Severity.WARNING
    frames = {"P0217": {"rpm": 2169.25, "speed": 59.0, "coolant_temp_c": 118.0, "battery_voltage": 14.088}}
    assessment = rules_assessment(_context([r1], stored=["P0217"], frames=frames))
    assert assessment.severity == Severity.CRITICAL
    line = next(item for item in assessment.evidence if item.startswith("Lúc mã P0217"))
    assert line == "Lúc mã P0217 xuất hiện: Vòng tua 2169 rpm, Tốc độ 59 km/h, Nước làm mát 118.0 °C, Điện áp hệ thống 14.09 V."
    assert assessment.missing_data == ["Nhiệt độ dầu"]
