import asyncio
import json
from types import SimpleNamespace

from agents.tool_context import ToolContext

import agent.orchestrator as orchestrator
from agent.tools.openai_tools import (
    VehicleToolContext,
    get_maintenance_history_tool,
    search_nearby_garages_tool,
)
from schemas import PolicyDecision, PredictionResult, Severity, TelemetryInput


def _sample() -> TelemetryInput:
    return TelemetryInput(
        vehicle_id="VF-DEMO-001",
        coolant_temp=122,
        engine_rpm=2_500,
        vehicle_speed=40,
        intake_air_temp=35,
        engine_load=70,
        battery_voltage=13.8,
        latitude=10.7769,
        longitude=106.7009,
    )


def test_agent_registers_read_tools() -> None:
    tool_names = {tool.name for tool in orchestrator.vehicle_agent.agent.tools}
    assert tool_names == {"get_maintenance_history", "search_nearby_garages"}


def test_maintenance_function_tool_uses_run_context() -> None:
    state = VehicleToolContext("VF-DEMO-001", 10.7769, 106.7009)
    context = ToolContext(
        context=state,
        tool_name="get_maintenance_history",
        tool_call_id="test-call",
        tool_arguments="{}",
    )

    output = asyncio.run(
        get_maintenance_history_tool.on_invoke_tool(context, "{}")
    )

    assert json.loads(output)["total_records"] > 0
    assert state.trace[0]["arguments"] == {"vehicle_id": "VF-DEMO-001"}


def test_garage_tool_does_not_fabricate_missing_gps() -> None:
    state = VehicleToolContext("VF-DEMO-001", None, None)
    context = ToolContext(
        context=state,
        tool_name="search_nearby_garages",
        tool_call_id="test-call",
        tool_arguments="{}",
    )

    output = asyncio.run(
        search_nearby_garages_tool.on_invoke_tool(context, "{}")
    )

    assert "GPS coordinates were not provided" in json.loads(output)["error"]
    assert state.trace[0]["arguments"] == {}


def test_openai_analysis_uses_runner_and_collects_tool_trace(monkeypatch) -> None:
    def fake_run_sync(agent, input_text, *, context, max_turns):
        assert agent.name == "Vehicle Guardian"
        assert max_turns == 6
        payload = json.loads(input_text)
        assert payload["telemetry"]["vehicle_id"] == "VF-DEMO-001"
        assert payload["diagnostic_metrics"]["window"]["sample_count"] == 1
        context.trace.extend(
            [
                {"tool": "get_maintenance_history", "arguments": {}, "result": {}},
                {"tool": "search_nearby_garages", "arguments": {}, "result": {}},
            ]
        )
        return SimpleNamespace(
            final_output=orchestrator.VehicleAnalysis(
                diagnosis="Kết quả kiểm thử",
                recommendations=["Đề xuất từ agent"],
            )
        )

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)
    prediction = PredictionResult(
        label="overheating",
        severity=Severity.CRITICAL,
        confidence=0.95,
        probabilities={"overheating": 0.95},
        model_version="test",
    )
    decision = PolicyDecision(
        status="hard_limit_alert",
        should_create_incident=True,
        severity=Severity.CRITICAL,
        reasons=["test"],
    )

    analysis, trace = orchestrator.vehicle_agent._openai_analysis(
        _sample(), prediction, decision, [_sample()]
    )

    assert analysis.diagnosis == "Kết quả kiểm thử"
    assert analysis.recommendations == ["Đề xuất từ agent"]
    assert [item["tool"] for item in trace] == [
        "get_maintenance_history",
        "search_nearby_garages",
    ]
