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


def test_agent_registers_read_tools() -> None:
    tool_names = {tool.name for tool in orchestrator.vehicle_agent.agent.tools}
    assert tool_names == {
        "get_external_environment_context",
        "get_maintenance_history",
        "search_nearby_garages",
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
