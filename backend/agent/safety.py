from typing import Any

from schemas import SafetyGuardrailResult, Severity

COOLANT_CRITICAL_C = 120.0  # also the overheat floor of driver/guardian.py


def evaluate_hard_safety(telemetry_context: dict[str, Any]) -> SafetyGuardrailResult:
    """Apply deterministic safety floors before accepting the agent assessment."""
    reasons: list[str] = []
    minimum_severity = Severity.NORMAL

    for record in telemetry_context.get("records", []):
        coolant_temp = record.get("coolant_temp_c", record.get("coolant_temp"))
        battery_voltage = record.get("battery_voltage")

        if coolant_temp is not None and float(coolant_temp) >= COOLANT_CRITICAL_C:
            reasons.append(
                "Nhiệt độ nước làm mát đạt ngưỡng nguy hiểm (>= 120°C)."
            )
            minimum_severity = Severity.CRITICAL

        if battery_voltage is not None and (
            float(battery_voltage) <= 10.5 or float(battery_voltage) >= 15.5
        ):
            reasons.append(
                "Điện áp ắc quy nằm ngoài khoảng an toàn 10.5–15.5V."
            )
            if minimum_severity != Severity.CRITICAL:
                minimum_severity = Severity.WARNING

    # Device batches carry the car's own DTC read. Only stored (confirmed) codes set a floor.
    stored = (telemetry_context.get("dtc_snapshot") or {}).get("stored") or []
    for code in stored:
        if code == "P0217":
            reasons.append("ECU báo mã P0217: động cơ quá nhiệt.")
            minimum_severity = Severity.CRITICAL
        elif code.startswith("P030") and code[-1] in "012345678":
            reasons.append(f"ECU báo mã {code}: bỏ máy.")
            if minimum_severity != Severity.CRITICAL:
                minimum_severity = Severity.WARNING

    return SafetyGuardrailResult(
        triggered=bool(reasons),
        minimum_severity=minimum_severity,
        reasons=list(dict.fromkeys(reasons)),
    )
