import unittest
from datetime import datetime, timedelta, timezone

from schemas import TelemetryInput
from services import calculate_diagnostic_metrics
from services.diagnostic_metrics import (
    calculate_afr,
    calculate_lambda,
    calculate_ratio,
)


def _sample(timestamp: datetime, coolant_temp: float) -> TelemetryInput:
    return TelemetryInput(
        vehicle_id="VF-DEMO-001",
        timestamp=timestamp,
        coolant_temp=coolant_temp,
        engine_rpm=800,
        vehicle_speed=0,
        intake_air_temp=30,
        engine_load=25,
        battery_voltage=13.8,
        map_kpa=35,
        baro_kpa=100,
        tps_percent=12,
        lambda_value=1.1,
        stoichiometric_afr=14.7,
        engine_oil_temp_c=100,
        engine_power_kw=72,
        expected_power_kw=80,
        fuel_consumption_l_per_100km=12,
        expected_fuel_consumption_l_per_100km=10,
    )


class DiagnosticMetricsTests(unittest.TestCase):
    def test_conversion_and_ratio_functions(self) -> None:
        self.assertEqual(calculate_ratio(72, 80), 0.9)
        self.assertEqual(calculate_afr(1.1, 14.7), 16.17)
        self.assertEqual(calculate_lambda(16.17, 14.7), 1.1)
        self.assertIsNone(calculate_ratio(10, None))

    def test_snapshot_and_window_trend(self) -> None:
        started_at = datetime(2026, 9, 12, tzinfo=timezone.utc)
        samples = [
            _sample(started_at, 90),
            _sample(started_at + timedelta(seconds=60), 100),
            _sample(started_at + timedelta(seconds=120), 110),
        ]

        metrics = calculate_diagnostic_metrics(samples)

        self.assertEqual(metrics["snapshot"]["intake"]["map_to_baro_ratio"], 0.35)
        self.assertEqual(
            metrics["snapshot"]["performance"][
                "actual_to_expected_power_ratio"
            ],
            0.9,
        )
        self.assertEqual(
            metrics["snapshot"]["performance"][
                "actual_to_expected_fuel_consumption_ratio"
            ],
            1.2,
        )
        coolant_trend = metrics["trends"]["coolant_temp"]
        self.assertEqual(coolant_trend["change"], 20)
        self.assertEqual(coolant_trend["slope_per_minute"], 10)
        self.assertEqual(metrics["window"]["duration_seconds"], 120)


if __name__ == "__main__":
    unittest.main()
