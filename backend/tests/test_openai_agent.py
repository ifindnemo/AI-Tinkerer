import asyncio
import json
from types import SimpleNamespace

from agents.tool_context import ToolContext

import agent.orchestrator as orchestrator
from agent.prompt import build_agent_instructions
from agent.tools.openai_tools import (
    VehicleToolContext,
    get_external_environment_context_tool,
    get_maintenance_history_tool,
    search_nearby_garages_tool,
)
from schemas import Severity, VehicleAssessment


def _telemetry_context(coolant: float = 96) -> dict:
    return {
        "schema_version": 1,
        "batch_id": "batch-test",
        "vehicle_id": "VF-DEMO-001",
        "source": "test",
        "sample_interval_ms": 1000,
        "record_count": 2,
        "current_location": {"latitude": 10.7769, "longitude": 106.7009},
        "records": [
            {
                "captured_at": "2026-09-12T06:29:59Z",
                "coolant_temp_c": coolant - 1,
                "battery_voltage": 13.8,
            },
            {
                "captured_at": "2026-09-12T06:30:00Z",
                "coolant_temp_c": coolant,
                "battery_voltage": 13.8,
            },
        ],
    }


def _normal_assessment() -> VehicleAssessment:
    return VehicleAssessment(
        severity=Severity.NORMAL,
        diagnosis="Các chỉ số hiện chưa cho thấy bất thường đáng kể.",
        suspected_faults=[],
        evidence=["Nhiệt độ nước làm mát ổn định."],
        confidence=0.82,
        missing_data=[],
        recommendations=["Tiếp tục theo dõi xe."],
    )


def _critical_assessment() -> VehicleAssessment:
    return VehicleAssessment(
        severity=Severity.CRITICAL,
        diagnosis="Hệ thống làm mát có nguy cơ hỏng.",
        suspected_faults=["Hệ thống làm mát"],
        evidence=["Quạt không hoạt động."],
        confidence=0.8,
        missing_data=[],
        recommendations=["Dừng xe ngay."],
    )


def test_agent_registers_read_tools_and_only_proposes_bookings() -> None:
    tool_names = {tool.name for tool in orchestrator.vehicle_agent.agent.tools}
    assert tool_names == {
        "get_external_environment_context",
        "get_maintenance_history",
        "search_nearby_garages",
        "propose_booking",  # a proposal only: saving needs the driver's confirmation (test_booking.py)
    }


def test_diagnostic_skill_is_loaded_into_agent_instructions() -> None:
    instructions = build_agent_instructions()

    assert "<diagnostic_skill>" in instructions
    assert "Chẩn đoán và sửa chữa động cơ xăng" in instructions


def test_maintenance_function_tool_uses_run_context() -> None:
    state = VehicleToolContext("bmw-m2", 10.7769, 106.7009)
    context = ToolContext(
        context=state,
        tool_name="get_maintenance_history",
        tool_call_id="test-call",
        tool_arguments="{}",
    )

    output = asyncio.run(get_maintenance_history_tool.on_invoke_tool(context, "{}"))

    assert json.loads(output)["total_records"] > 0
    assert state.trace[0]["arguments"] == {"vehicle_id": "bmw-m2"}


def test_location_tools_do_not_fabricate_missing_gps() -> None:
    state = VehicleToolContext("VF-DEMO-001", None, None)
    for tool, name in (
        (get_external_environment_context_tool, "get_external_environment_context"),
        (search_nearby_garages_tool, "search_nearby_garages"),
    ):
        context = ToolContext(
            context=state,
            tool_name=name,
            tool_call_id=f"test-{name}",
            tool_arguments="{}",
        )
        output = asyncio.run(tool.on_invoke_tool(context, "{}"))
        assert "GPS coordinates were not provided" in json.loads(output)["error"]


def test_agent_receives_batch_safety_and_short_term_memory(monkeypatch) -> None:
    previous_memory = {"incident_id": "inc_previous", "status": "active"}

    def fake_run_sync(agent, input_text, *, context, max_turns):
        payload = json.loads(input_text)
        assert agent.name == "Vehicle Guardian"
        assert max_turns == 6
        assert payload["telemetry_context"]["record_count"] == 2
        assert payload["short_term_memory"] == previous_memory
        assert payload["hard_safety_guardrail"]["triggered"] is False
        context.trace.append(
            {"tool": "get_external_environment_context", "arguments": {}, "result": {}}
        )
        return SimpleNamespace(final_output=_normal_assessment())

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)

    assessment, trace, safety = orchestrator.vehicle_agent._run_analysis(
        _telemetry_context(),
        previous_memory,
    )

    assert assessment.severity == Severity.NORMAL
    assert safety["triggered"] is False
    assert trace[0]["tool"] == "get_external_environment_context"


def test_hard_safety_guardrail_cannot_be_downgraded(monkeypatch) -> None:
    monkeypatch.setenv("EXTERNAL_TOOLS", "on")  # search_nearby_garages is stubbed below
    garage_calls = []
    monkeypatch.setattr(
        orchestrator.Runner,
        "run_sync",
        lambda *args, **kwargs: SimpleNamespace(final_output=_normal_assessment()),
    )
    monkeypatch.setattr(
        orchestrator,
        "search_nearby_garages",
        lambda **kwargs: garage_calls.append(kwargs) or {"options": []},
    )

    assessment, trace, safety = orchestrator.vehicle_agent._run_analysis(
        _telemetry_context(coolant=125),
        None,
    )

    assert safety["minimum_severity"] == "critical"
    assert assessment.severity == Severity.CRITICAL
    assert assessment.recommendations[0].startswith("Dừng xe")
    assert garage_calls == [
        {
            "latitude": 10.7769,
            "longitude": 106.7009,
            "radius_meters": 5_000,
            "max_results": 5,
        }
    ]
    assert trace[-1]["tool"] == "search_nearby_garages"


def test_existing_agent_garage_lookup_is_not_duplicated(monkeypatch) -> None:
    warning = _normal_assessment().model_copy(
        update={"severity": Severity.WARNING}
    )

    def fake_run_sync(*args, context, **kwargs):
        context.trace.append(
            {"tool": "search_nearby_garages", "arguments": {}, "result": {}}
        )
        return SimpleNamespace(final_output=warning)

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)
    monkeypatch.setattr(
        orchestrator,
        "search_nearby_garages",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("duplicate lookup")),
    )

    _, trace, _ = orchestrator.vehicle_agent._run_analysis(
        _telemetry_context(),
        None,
    )

    assert [item["tool"] for item in trace].count("search_nearby_garages") == 1


def test_stable_simulated_thermal_profile_cannot_be_escalated_by_model(
    monkeypatch,
) -> None:
    context = _telemetry_context(coolant=88)
    context["source"] = "simulated"
    for record in context["records"]:
        record.update(
            {
                "oil_temp_c": 94,
                "intake_air_temp_c": 34,
                "fuel_percent": 68,
                "fan_percent": 0,
                "dtc": [],
            }
        )
    monkeypatch.setattr(
        orchestrator.Runner,
        "run_sync",
        lambda *args, **kwargs: SimpleNamespace(final_output=_critical_assessment()),
    )
    monkeypatch.setattr(
        orchestrator,
        "search_nearby_garages",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("false alert lookup")),
    )

    assessment, trace, safety = orchestrator.vehicle_agent._run_analysis(
        context,
        {"incident_id": "inc_old", "status": "active"},
    )

    assert safety["triggered"] is False
    assert assessment.severity == Severity.NORMAL
    assert assessment.suspected_faults == []
    assert "chưa ghi nhận dấu hiệu quá nhiệt" in assessment.diagnosis
    assert not any(item["tool"] == "search_nearby_garages" for item in trace)


def test_every_run_logs_where_the_time_went_and_a_broken_log_never_fails_it(monkeypatch, caplog) -> None:
    def fake_run_sync(agent, input_text, *, context, max_turns):
        context.timings.append(("get_maintenance_history", 12.0))
        context.timings.append(("search_nearby_garages", 340.0))
        usage = SimpleNamespace(input_tokens=9000, output_tokens=420)
        return SimpleNamespace(final_output=_normal_assessment(), raw_responses=[1, 2], context_wrapper=SimpleNamespace(usage=usage))

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)
    with caplog.at_level("INFO", logger="car_neuron.agent"):
        orchestrator.vehicle_agent._run_analysis(_telemetry_context(), None)
    line = next(record.getMessage() for record in caplog.records if record.getMessage().startswith("agent run"))
    assert "llm_calls=2" in line and "get_maintenance_history:12" in line and "search_nearby_garages:340" in line
    assert "input_tokens=9000 output_tokens=420" in line and "instructions_chars=" in line

    # No usage, no raw responses and a context without timings: the run still returns its assessment.
    monkeypatch.setattr(orchestrator.Runner, "run_sync", lambda *args, **kwargs: SimpleNamespace(final_output=_normal_assessment()))
    assessment, _, _ = orchestrator.vehicle_agent._run_analysis(_telemetry_context(), None)
    assert assessment.severity == Severity.NORMAL


def test_the_tool_wrapper_times_a_tool_and_keeps_the_trace_unchanged() -> None:
    from agent.tools.openai_tools import _run_and_trace

    state = VehicleToolContext("VF-DEMO-001", None, None)
    wrapper = SimpleNamespace(context=state)
    _run_and_trace(wrapper, "ok_tool", {"a": 1}, lambda: {"fine": True})
    _run_and_trace(wrapper, "bad_tool", {}, lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert [step["tool"] for step in state.trace] == ["ok_tool", "bad_tool"]
    assert set(state.trace[0]) == {"tool", "arguments", "result"}, "the trace shown in the UI gains no field"
    assert state.trace[1]["result"] == {"error": "boom"}
    assert [name for name, _ in state.timings] == ["ok_tool", "bad_tool"] and all(ms >= 0 for _, ms in state.timings)


def test_the_paid_agent_script_refuses_without_the_opt_in(monkeypatch, capsys) -> None:
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("agent_latency", Path(__file__).resolve().parents[1] / "scripts" / "agent_latency.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.delenv("CAR_NEURON_ALLOW_PAID_LLM", raising=False)
    assert module.main([]) == 2 and "Refusing paid LLM calls" in capsys.readouterr().out
    body = module.warm_body()
    assert body["recordCount"] == 15 and body["records"][-1]["coolant"] == 106.5 and body["records"][0]["coolant"] == 96.0


def _stub_lookups(monkeypatch, calls: list[str]) -> None:
    import agent.tools.openai_tools as tools

    class Weather:
        def model_dump(self, mode="json"):
            return {"outside_temperature_c": 31}

    def weather(*args, **kwargs):
        calls.append("weather")
        return Weather()

    def history(vehicle_id):
        calls.append("history")
        return {"records": []}

    def garages(**kwargs):
        calls.append("garages")
        return {"garages": [{"name": "Gara An Phat"}]}

    monkeypatch.setattr(tools, "get_external_environment_context_data", weather)
    monkeypatch.setattr(tools, "get_maintenance_history", history)
    monkeypatch.setattr(tools, "search_nearby_garages", garages)


def test_prefetch_is_off_unless_asked_and_the_model_keeps_all_four_tools(monkeypatch) -> None:
    monkeypatch.delenv("AGENT_PREFETCH_TOOLS", raising=False)
    seen = {}

    def fake_run_sync(agent, input_text, *, context, max_turns):
        seen["tools"] = {tool.name for tool in agent.tools}
        seen["payload"] = json.loads(input_text)
        return SimpleNamespace(final_output=_normal_assessment())

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)
    orchestrator.vehicle_agent.model_assessment(_telemetry_context(), None)

    assert len(seen["tools"]) == 4 and "tool_results" not in seen["payload"]
    assert "<prefetched_tools>" not in build_agent_instructions()


def test_prefetch_looks_the_tools_up_before_the_model_and_leaves_it_only_the_booking_tool(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_PREFETCH_TOOLS", "1")
    calls: list[str] = []
    _stub_lookups(monkeypatch, calls)
    seen = {}

    def fake_run_sync(agent, input_text, *, context, max_turns):
        seen["tools"] = {tool.name for tool in agent.tools}
        seen["payload"] = json.loads(input_text)
        seen["instructions"] = agent.instructions
        return SimpleNamespace(final_output=_normal_assessment())

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)
    # 125 °C coolant: the rules floor is critical, so the garages are fetched too
    _, trace = orchestrator.vehicle_agent.model_assessment(_telemetry_context(coolant=125), None)

    assert sorted(calls) == ["garages", "history", "weather"]
    assert seen["tools"] == {"propose_booking"}
    assert set(seen["payload"]["tool_results"]) == {
        "get_external_environment_context", "get_maintenance_history", "search_nearby_garages",
    }
    assert "<prefetched_tools>" in seen["instructions"]
    # the trace the page shows is the same shape and always in the same order
    assert [step["tool"] for step in trace] == [
        "get_external_environment_context", "get_maintenance_history", "search_nearby_garages",
    ]
    assert all(set(step) == {"tool", "arguments", "result"} for step in trace)


def test_prefetch_skips_the_garages_when_the_rules_say_normal_and_finalize_still_adds_them(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_PREFETCH_TOOLS", "1")
    monkeypatch.setenv("EXTERNAL_TOOLS", "on")
    calls: list[str] = []
    _stub_lookups(monkeypatch, calls)
    warning = _normal_assessment().model_copy(update={"severity": Severity.WARNING})
    monkeypatch.setattr(
        orchestrator.Runner, "run_sync", lambda *a, **k: SimpleNamespace(final_output=warning)
    )
    monkeypatch.setattr(
        orchestrator, "search_nearby_garages", lambda **kwargs: calls.append("garages") or {"options": []}
    )

    _, trace, _ = orchestrator.vehicle_agent._run_analysis(_telemetry_context(), None)

    assert calls.count("garages") == 1, "looked up once, by finalize, not twice"
    assert [step["tool"] for step in trace].count("search_nearby_garages") == 1
    assert sorted(set(calls)) == ["garages", "history", "weather"]


def test_prefetch_lookup_failure_becomes_an_error_entry_and_missing_gps_is_reported(monkeypatch) -> None:
    from agent.tools.openai_tools import prefetch_read_tools

    calls: list[str] = []
    _stub_lookups(monkeypatch, calls)
    import agent.tools.openai_tools as tools

    monkeypatch.setattr(tools, "get_maintenance_history", lambda vehicle_id: (_ for _ in ()).throw(OSError("disk")))
    context = VehicleToolContext("VF-DEMO-001", None, None)

    results = prefetch_read_tools(context, include_garages=True)

    assert results["get_maintenance_history"] == {"error": "disk"}
    assert "GPS" in results["get_external_environment_context"]["error"]
    assert "GPS" in results["search_nearby_garages"]["error"]
    assert calls == [], "no GPS: no external lookup was attempted"
    assert [name for name, _ in context.timings] == [step["tool"] for step in context.trace]


def test_the_run_log_says_whether_prefetch_was_on(monkeypatch, caplog) -> None:
    import logging

    caplog.set_level(logging.INFO, logger="car_neuron.agent")
    monkeypatch.setenv("AGENT_PREFETCH_TOOLS", "1")
    _stub_lookups(monkeypatch, [])
    monkeypatch.setattr(
        orchestrator.Runner, "run_sync", lambda *a, **k: SimpleNamespace(final_output=_normal_assessment())
    )
    orchestrator.vehicle_agent.model_assessment(_telemetry_context(), None)
    assert any("prefetch=on" in record.getMessage() for record in caplog.records)


def test_prefetch_fetches_the_garages_for_the_sustained_heat_floor_that_drives_the_booking_scene(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_PREFETCH_TOOLS", "1")
    calls: list[str] = []
    _stub_lookups(monkeypatch, calls)
    monkeypatch.setattr(
        orchestrator.Runner, "run_sync", lambda *a, **k: SimpleNamespace(final_output=_normal_assessment())
    )
    context = _telemetry_context(coolant=108)
    context["records"] = [dict(context["records"][0], coolant_temp_c=108.0) for _ in range(10)]

    orchestrator.vehicle_agent.model_assessment(context, None)

    assert "garages" in calls, "warm engine, no hard-safety trigger: the batch floor must still fetch garages"


def test_outside_lookups_are_cached_per_place_and_errors_are_not(monkeypatch) -> None:
    from agent.tools import lookup_cache
    from agent.tools.openai_tools import prefetch_read_tools

    monkeypatch.setenv("TOOL_CACHE_SECONDS", "600")
    lookup_cache.clear()
    calls: list[str] = []
    _stub_lookups(monkeypatch, calls)

    def run(latitude: float = 10.7769, longitude: float = 106.7009) -> dict:
        return prefetch_read_tools(VehicleToolContext("VF-DEMO-001", latitude, longitude), include_garages=True)

    first = run()
    second = run()
    assert calls.count("weather") == 1 and calls.count("garages") == 1, "second run served from the cache"
    assert calls.count("history") == 2, "the local history file is cheap and always read fresh"
    assert second == first
    run(latitude=10.77694, longitude=106.70088)  # GPS jitter of a few metres: same spot
    assert calls.count("weather") == 1
    run(latitude=10.80, longitude=106.70)  # a different place
    assert calls.count("weather") == 2 and calls.count("garages") == 2

    # an error is retried, not remembered
    import agent.tools.openai_tools as tools

    lookup_cache.clear()
    failing = {"on": True}

    def flaky(**kwargs):
        if failing["on"]:
            raise TimeoutError("slow")
        return {"garages": []}

    monkeypatch.setattr(tools, "search_nearby_garages", flaky)
    assert "error" in run()["search_nearby_garages"]
    failing["on"] = False
    assert run()["search_nearby_garages"] == {"garages": []}
    lookup_cache.clear()


def test_the_cache_returns_copies_expires_and_can_be_switched_off(monkeypatch) -> None:
    from agent.tools import lookup_cache

    monkeypatch.setenv("TOOL_CACHE_SECONDS", "600")
    lookup_cache.clear()
    value = {"items": [1]}
    got = lookup_cache.cached(("k",), lambda: value)
    got["items"].append(2)  # a caller changing its copy must not change what is stored
    assert lookup_cache.cached(("k",), lambda: {"items": ["new"]}) == {"items": [1]}
    monkeypatch.setenv("TOOL_CACHE_SECONDS", "0")
    assert lookup_cache.cached(("k",), lambda: {"items": ["new"]}) == {"items": ["new"]}
    monkeypatch.setenv("TOOL_CACHE_SECONDS", "oops")
    assert lookup_cache.ttl_seconds() == 600.0
    monkeypatch.setenv("TOOL_CACHE_SECONDS", "600")
    clock = iter([1000.0, 1000.0, 1601.0, 1601.0])  # now + stored-at for each call
    monkeypatch.setattr(lookup_cache.time, "monotonic", lambda: next(clock))
    lookup_cache.clear()
    assert lookup_cache.cached(("t",), lambda: 1) == 1
    assert lookup_cache.cached(("t",), lambda: 2) == 2, "expired after the TTL"
    lookup_cache.clear()
