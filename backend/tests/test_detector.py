from datetime import datetime, timedelta, timezone

from analysis.detector import evaluate, policy_for, should_analyze

T0 = datetime(2026, 10, 11, 1, 0, tzinfo=timezone.utc)


def _samples(seconds: int, signals_at) -> list[dict]:
    return [
        {"capturedAt": (T0 + timedelta(seconds=s)).isoformat(timespec="milliseconds"), "signals": signals_at(s)}
        for s in range(seconds)
    ]


def _overheat(s: int) -> dict:
    # Mirrors the gateway scenario: flat load, coolant 92 → 122 °C between 30 s and 180 s.
    coolant = 92 if s <= 30 else min(122.0, 92 + 30 * (s - 30) / 150)
    return {"coolant": round(coolant, 1), "engineLoad": 36, "rpm": 2200, "speed": 60}


def _rules(samples) -> list[str]:
    return [finding.rule for finding in evaluate(samples)]


def test_nominal_driving_raises_nothing() -> None:
    samples = _samples(300, lambda s: {"coolant": 90 + (s % 3) * 0.2, "engineLoad": 30, "rpm": 2000, "battery": 14.1})
    assert evaluate(samples) == []
    assert policy_for([], None)["ceiling_normal"] is True


def test_overheat_rises_first_then_crosses_105_before_120() -> None:
    samples = _samples(181, _overheat)
    first_rise = next(s for s in range(30, 181) if "R2" in _rules(samples[: s + 1]))
    first_hot = next(s for s in range(30, 181) if "R1" in _rules(samples[: s + 1]))

    assert first_rise < first_hot
    coolant_at_hot = samples[first_hot]["signals"]["coolant"]
    assert 105 <= coolant_at_hot < 120
    floor = policy_for(evaluate(samples[: first_hot + 1]), None)
    assert floor["minimum_severity"] == "warning" and floor["ceiling_normal"] is False


def test_rising_heat_with_rising_load_is_not_flagged() -> None:
    samples = _samples(90, lambda s: {"coolant": 96 + s * 0.1, "engineLoad": 20 + s * 0.5})
    assert "R2" not in _rules(samples)


def test_low_voltage_needs_the_engine_running_for_30_seconds() -> None:
    running = _samples(40, lambda s: {"battery": 11.6, "rpm": 800})
    off = _samples(40, lambda s: {"battery": 11.6, "rpm": 0})
    assert "R4" in _rules(running)
    assert "R4" not in _rules(off)


def test_stuck_coolant_sensor_while_moving() -> None:
    samples = _samples(605, lambda s: {"coolant": 88.0, "speed": 40})
    assert "R5" in _rules(samples)


def test_dtc_counts_as_a_signal_for_the_ceiling() -> None:
    dtc = {"mil": True, "codes": [{"code": "P0217", "kind": "stored"}]}
    findings = evaluate(_samples(5, lambda s: {"coolant": 90}), dtc)
    assert [f.rule for f in findings] == ["R3"]
    assert policy_for(findings, dtc)["ceiling_normal"] is False


def test_should_analyze_triggers() -> None:
    at = T0 + timedelta(minutes=1)
    common = {"batch_last_at": at, "trip_id": "t1", "findings": [], "new_dtc_codes": [], "profile_changed": False}
    last = {"trip_id": "t1", "at": T0.isoformat(), "rules": []}

    assert should_analyze(**common, last=None) == "trip_start"
    assert should_analyze(**common, last={**last, "trip_id": "t0"}) == "trip_start"
    assert should_analyze(**common, last=last) is None
    assert should_analyze(**{**common, "new_dtc_codes": ["P0217"]}, last=last) == "dtc"
    hot = evaluate(_samples(60, lambda s: {"coolant": 110}))
    assert should_analyze(**{**common, "findings": hot}, last=last) == "detector"
    assert should_analyze(**{**common, "findings": hot}, last={**last, "rules": ["R1"]}) is None
    assert should_analyze(**{**common, "batch_last_at": T0 + timedelta(minutes=5)}, last=last) == "heartbeat"


def test_thresholds_can_be_set_per_car(monkeypatch) -> None:
    warm_car = _samples(40, lambda s: {"coolant": 106.0, "engineLoad": 30})
    assert "R1" in _rules(warm_car)
    monkeypatch.setenv("COOLANT_WARN_C", "110")
    assert "R1" not in _rules(warm_car)
    assert "≥ 110°C" in evaluate(_samples(40, lambda s: {"coolant": 111.0}))[0].message
