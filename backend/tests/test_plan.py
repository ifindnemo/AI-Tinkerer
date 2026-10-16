"""The plan comes from the car and the driver together: the same fault, different advice."""

import pytest

from agent.plan import decide, driver_state

TRACE = [
    {"tool": "search_nearby_garages", "result": {"options": [
        {"name": "Garage Kiên Bảo", "distance_km": 1.3}, {"name": "Garage An Phú", "distance_km": 0.8}]}},
    {"tool": "get_maintenance_history", "result": {"records": [{"garage": "Garage Minh Quân"}]}},
]
MOVING = [{"speed": 60}]


def _context(attention=None, state=None, severity="warning", status="live", speed=60):
    context = {"records": [{"speed": speed}]}
    if attention:
        context["driver_attention"] = {"status": status, "attention": attention, "state": state, "severity": severity}
    return context


@pytest.mark.parametrize("car,context,code,booking", [
    ("warning", _context(), "garage_when_convenient", True),
    ("warning", _context("attentive", "attentive", "normal"), "garage_when_convenient", True),
    ("warning", _context("low_attention", "distracted"), "focus_then_garage", True),
    ("warning", _context("low_attention", "drowsy"), "rest_then_decide", False),
    ("critical", _context(), "stop_and_get_help", False),
    ("critical", {**_context("low_attention", "drowsy", "critical"), "records": [{"speed": 60, "coolant_temp_c": 122}]}, "stop_rest_and_get_help", False),
    ("warning", _context("low_attention", "drowsy", status="stale"), "garage_when_convenient", True),
])
def test_the_plan_depends_on_both_the_car_and_the_driver(car, context, code, booking) -> None:
    plan = decide(car, context, TRACE)
    assert plan["code"] == code and plan["booking"] is booking


def test_no_plan_for_a_normal_car() -> None:
    assert decide("normal", _context("low_attention", "drowsy"), TRACE) is None


def test_a_drowsy_driver_with_a_warning_rests_first_and_is_offered_help() -> None:
    plan = decide("warning", _context("low_attention", "drowsy"), TRACE)
    assert plan["spoken"].startswith("Hãy nghỉ trước.") and "Garage An Phú" in plan["spoken"]
    assert any("nhờ người đến đón" in option for option in plan["options"])
    assert "nghỉ 15–20 phút" in plan["steps"][0]


def test_a_critical_car_is_towed_not_driven_and_names_only_found_garages() -> None:
    plan = decide("critical", _context(), TRACE, "en")
    assert plan["spoken"].startswith("Do not drive the car to a garage yourself.")
    assert "Garage An Phú" in plan["options"][0] and "tow" in plan["options"][0]
    without = decide("critical", _context(), [])
    assert "kéo xe về garage" in without["options"][0]


def test_an_alert_driver_hears_the_nearest_and_the_usual_garage_in_one_short_line() -> None:
    plan = decide("warning", _context(), TRACE)
    assert plan["spoken"] == "Garage gần nhất là Garage An Phú, cách 0,8 kilômét. Hoặc về garage quen Garage Minh Quân."
    assert any("Garage Minh Quân" in option for option in plan["options"])


def test_driver_state_reads_only_a_live_summary() -> None:
    assert driver_state({}) == "none"
    assert driver_state(_context("low_attention", "drowsy", status="stale")) == "none"
    assert driver_state(_context("unknown")) == "unknown"


def test_critical_only_because_of_the_driver_means_rest_not_a_tow() -> None:
    context = {**_context("low_attention", "drowsy", "critical"), "driver_policy_raised": True}
    plan = decide("critical", context, TRACE)
    assert plan["code"] == "rest_then_decide" and plan["title"].startswith("Dừng xe ngay và nghỉ")
    assert not any("kéo xe" in option for option in plan["options"]) and plan["booking"] is False


def test_the_model_calling_it_critical_for_a_drowsy_driver_does_not_send_a_tow_truck() -> None:
    warm = {**_context("low_attention", "drowsy", "critical"), "records": [{"speed": 65, "coolant_temp_c": 106.7}]}
    assert decide("critical", warm, TRACE)["code"] == "rest_then_decide"
    boiling = {**warm, "records": [{"speed": 65, "coolant_temp_c": 122}]}
    assert decide("critical", boiling, TRACE)["code"] == "stop_rest_and_get_help"
