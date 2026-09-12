from statistics import fmean, pstdev
from typing import Any

from schemas import TelemetryInput


SIGNAL_UNITS = {
    "coolant_temp": "celsius",
    "intake_air_temp": "celsius",
    "engine_oil_temp_c": "celsius",
    "engine_rpm": "rpm",
    "vehicle_speed": "km/h",
    "engine_load": "percent",
    "battery_voltage": "volt",
    "map_kpa": "kPa",
    "baro_kpa": "kPa",
    "tps_percent": "percent",
    "lambda_value": "ratio",
    "afr": "ratio",
    "o2_narrowband_voltage": "volt",
    "exhaust_o2_percent": "percent",
    "co_percent": "percent",
    "hc_ppm": "ppm",
    "co2_percent": "percent",
    "engine_power_kw": "kW",
    "fuel_consumption_l_per_100km": "L/100km",
}


def _rounded(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(float(value), digits)


def calculate_ratio(actual: float | None, expected: float | None) -> float | None:
    """Return actual / expected without assigning a diagnostic label."""
    if actual is None or expected is None or expected <= 0:
        return None
    return _rounded(actual / expected)


def calculate_lambda(
    afr: float | None,
    stoichiometric_afr: float | None,
) -> float | None:
    """Convert AFR to Lambda when the fuel's stoichiometric AFR is supplied."""
    return calculate_ratio(afr, stoichiometric_afr)


def calculate_afr(
    lambda_value: float | None,
    stoichiometric_afr: float | None,
) -> float | None:
    """Convert Lambda to AFR when the fuel's stoichiometric AFR is supplied."""
    if lambda_value is None or stoichiometric_afr is None:
        return None
    return _rounded(lambda_value * stoichiometric_afr)


def _calculate_air_fuel_metrics(sample: TelemetryInput) -> dict[str, Any]:
    lambda_value = sample.lambda_value
    afr = sample.afr
    lambda_source = "measured" if lambda_value is not None else "unavailable"
    afr_source = "measured" if afr is not None else "unavailable"

    if lambda_value is None:
        lambda_value = calculate_lambda(afr, sample.stoichiometric_afr)
        if lambda_value is not None:
            lambda_source = "calculated_from_afr"
    if afr is None:
        afr = calculate_afr(lambda_value, sample.stoichiometric_afr)
        if afr is not None:
            afr_source = "calculated_from_lambda"

    expected_afr = calculate_afr(lambda_value, sample.stoichiometric_afr)
    consistency_difference_percent = None
    if (
        sample.afr is not None
        and sample.lambda_value is not None
        and expected_afr not in (None, 0)
    ):
        consistency_difference_percent = _rounded(
            abs(sample.afr - expected_afr) / expected_afr * 100
        )

    return {
        "lambda_value": _rounded(lambda_value),
        "lambda_source": lambda_source,
        "afr": _rounded(afr),
        "afr_source": afr_source,
        "stoichiometric_afr": _rounded(sample.stoichiometric_afr),
        "lambda_afr_absolute_difference_percent": (
            consistency_difference_percent
        ),
    }


def _calculate_snapshot_metrics(sample: TelemetryInput) -> dict[str, Any]:
    return {
        "air_fuel": _calculate_air_fuel_metrics(sample),
        "intake": {
            "map_to_baro_ratio": calculate_ratio(
                sample.map_kpa,
                sample.baro_kpa,
            ),
            "baro_minus_map_kpa": (
                _rounded(sample.baro_kpa - sample.map_kpa)
                if sample.baro_kpa is not None and sample.map_kpa is not None
                else None
            ),
        },
        "performance": {
            "actual_to_expected_power_ratio": calculate_ratio(
                sample.engine_power_kw,
                sample.expected_power_kw,
            ),
            "actual_to_expected_fuel_consumption_ratio": calculate_ratio(
                sample.fuel_consumption_l_per_100km,
                sample.expected_fuel_consumption_l_per_100km,
            ),
        },
        "temperature": {
            "coolant_minus_intake_c": _rounded(
                sample.coolant_temp - sample.intake_air_temp
            ),
            "oil_minus_coolant_c": (
                _rounded(sample.engine_oil_temp_c - sample.coolant_temp)
                if sample.engine_oil_temp_c is not None
                else None
            ),
        },
    }


def _calculate_signal_trend(
    samples: list[TelemetryInput],
    field_name: str,
) -> dict[str, Any] | None:
    points = sorted(
        (
            (sample.timestamp.timestamp(), float(value))
            for sample in samples
            if (value := getattr(sample, field_name)) is not None
        ),
        key=lambda point: point[0],
    )
    if not points:
        return None

    timestamps = [point[0] for point in points]
    values = [point[1] for point in points]
    duration_seconds = timestamps[-1] - timestamps[0]
    slope_per_minute = None
    if len(points) >= 2 and duration_seconds > 0:
        offsets = [timestamp - timestamps[0] for timestamp in timestamps]
        mean_offset = fmean(offsets)
        mean_value = fmean(values)
        denominator = sum((offset - mean_offset) ** 2 for offset in offsets)
        if denominator > 0:
            slope_per_second = sum(
                (offset - mean_offset) * (value - mean_value)
                for offset, value in zip(offsets, values, strict=True)
            ) / denominator
            slope_per_minute = slope_per_second * 60

    return {
        "unit": SIGNAL_UNITS[field_name],
        "sample_count": len(values),
        "duration_seconds": _rounded(duration_seconds, 2),
        "minimum": _rounded(min(values)),
        "maximum": _rounded(max(values)),
        "mean": _rounded(fmean(values)),
        "standard_deviation": _rounded(pstdev(values)),
        "change": _rounded(values[-1] - values[0]),
        "slope_per_minute": _rounded(slope_per_minute),
    }


def calculate_diagnostic_metrics(
    samples: list[TelemetryInput],
) -> dict[str, Any]:
    """Calculate neutral derived metrics for the diagnostic skill and agent."""
    if not samples:
        raise ValueError("At least one telemetry sample is required")

    vehicle_ids = {sample.vehicle_id for sample in samples}
    if len(vehicle_ids) != 1:
        raise ValueError("All telemetry samples must belong to the same vehicle")

    ordered_samples = sorted(samples, key=lambda sample: sample.timestamp)
    trends = {
        field_name: trend
        for field_name in SIGNAL_UNITS
        if (trend := _calculate_signal_trend(ordered_samples, field_name))
        is not None
    }
    return {
        "vehicle_id": ordered_samples[-1].vehicle_id,
        "window": {
            "sample_count": len(ordered_samples),
            "started_at": ordered_samples[0].timestamp.isoformat(),
            "ended_at": ordered_samples[-1].timestamp.isoformat(),
            "duration_seconds": _rounded(
                (
                    ordered_samples[-1].timestamp
                    - ordered_samples[0].timestamp
                ).total_seconds(),
                2,
            ),
        },
        "snapshot": _calculate_snapshot_metrics(ordered_samples[-1]),
        "trends": trends,
    }
