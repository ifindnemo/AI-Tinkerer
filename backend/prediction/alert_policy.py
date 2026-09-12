import os
from collections import defaultdict
from threading import Lock

from schemas import PolicyDecision, PredictionResult, Severity, TelemetryInput


class AlertPolicy:
    def __init__(self):
        self.confidence_threshold = float(os.getenv("ML_CONFIDENCE_THRESHOLD", "0.65"))
        self.debounce_count = int(os.getenv("ALERT_DEBOUNCE_COUNT", "2"))
        self._consecutive_alerts: dict[str, int] = defaultdict(int)
        self._lock = Lock()

    def evaluate_hard_limits(self, sample: TelemetryInput) -> PolicyDecision | None:
        hard_reasons: list[str] = []
        hard_severity = Severity.NORMAL

        # Independent guardrails remain active even if the model is unavailable or uncertain.
        if sample.coolant_temp >= 120:
            hard_reasons.append("Nhiệt độ nước làm mát đạt ngưỡng nguy hiểm (>= 120°C).")
            hard_severity = Severity.CRITICAL
        if sample.battery_voltage <= 10.5 or sample.battery_voltage >= 15.5:
            hard_reasons.append("Điện áp ắc quy nằm ngoài khoảng an toàn 10.5–15.5V.")
            if hard_severity != Severity.CRITICAL:
                hard_severity = Severity.WARNING

        if hard_reasons:
            with self._lock:
                self._consecutive_alerts[sample.vehicle_id] = self.debounce_count
            return PolicyDecision(
                status="hard_limit_alert",
                should_create_incident=True,
                severity=hard_severity,
                reasons=hard_reasons,
            )
        return None

    def evaluate(
        self,
        sample: TelemetryInput,
        prediction: PredictionResult,
    ) -> PolicyDecision:
        hard_limit = self.evaluate_hard_limits(sample)
        if hard_limit:
            return hard_limit

        model_alert = (
            prediction.severity != Severity.NORMAL
            and prediction.confidence >= self.confidence_threshold
        )
        with self._lock:
            if model_alert:
                self._consecutive_alerts[sample.vehicle_id] += 1
            else:
                self._consecutive_alerts[sample.vehicle_id] = 0
            count = self._consecutive_alerts[sample.vehicle_id]

        if model_alert and count >= self.debounce_count:
            return PolicyDecision(
                status="model_alert",
                should_create_incident=True,
                severity=prediction.severity,
                reasons=[
                    f"ML phát hiện {prediction.label} với độ tin cậy {prediction.confidence:.0%}.",
                    f"Tín hiệu lặp lại {count} lần liên tiếp.",
                ],
            )

        return PolicyDecision(
            status="monitoring" if model_alert else "normal",
            should_create_incident=False,
            severity=prediction.severity if model_alert else Severity.NORMAL,
            reasons=[f"Đang chờ xác nhận tín hiệu ({count}/{self.debounce_count})."]
            if model_alert
            else [],
        )

    def reset(self, vehicle_id: str) -> None:
        with self._lock:
            self._consecutive_alerts.pop(vehicle_id, None)


alert_policy = AlertPolicy()
