"""The browser blackbox batch (/api/telemetry/batch) answers from rules when the LLM is off, fails or is slow."""

import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import agent.orchestrator as orchestrator
from agent.orchestrator import vehicle_agent
from routes import router

T0 = datetime(2026, 10, 14, 9, 0, 0, tzinfo=timezone.utc)


def _body(coolant: list[float], *, vehicle_id: str, speed: float = 65, fan: float = 0) -> dict:
    records = [
        {"capturedAt": (T0 + timedelta(seconds=i)).isoformat().replace("+00:00", "Z"), "rpm": 2400, "map": 60, "tps": 30,
         "engineLoad": 50, "consumption": 8, "speed": speed, "coolant": value, "intake": 38, "battery": 13.9, "fan": fan,
         "location": {"lat": 10.8, "lon": 106.7}}
        for i, value in enumerate(coolant)
    ]
    return {"schemaVersion": 1, "batchId": f"batch-{vehicle_id}", "vehicleId": vehicle_id, "source": "blackbox-simulator",
            "sampleIntervalMs": 1000, "recordCount": len(records), "records": records}


def _post(body: dict) -> dict:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    response = TestClient(app).post("/api/telemetry/batch", json=body)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(autouse=True)
def _no_speech(monkeypatch):
    import voice

    monkeypatch.setattr(voice, "announce_alert", lambda *args, **kwargs: None)


def _fail_if_model_called(monkeypatch) -> None:
    def boom(*args, **kwargs):
        raise AssertionError("the LLM must not be called")

    monkeypatch.setattr(vehicle_agent, "model_assessment", boom)


def test_rules_mode_does_not_call_the_llm_and_warns_above_the_threshold(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "rules")
    _fail_if_model_called(monkeypatch)
    reply = _post(_body([104, 105.5, 106, 106.5, 107, 107.5, 108, 108.5], vehicle_id="batch-rules-hot"))
    assert reply["engine"] == "rules" and reply["fallback_reason"] == "rules_mode"
    assert reply["assessment"]["severity"] == "warning"
    assert "vượt ngưỡng cảnh báo" in reply["assessment"]["diagnosis"]
    assert any("Quạt" in line for line in reply["assessment"]["evidence"])


def test_rules_mode_stays_normal_for_a_stable_engine(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "rules")
    _fail_if_model_called(monkeypatch)
    reply = _post(_body([90, 90.2, 90.1, 90.3, 90.2], vehicle_id="batch-rules-normal", fan=20))
    assert reply["assessment"]["severity"] == "normal" and reply["engine"] == "rules"


def test_rules_mode_requires_a_stop_at_the_critical_threshold(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "rules")
    _fail_if_model_called(monkeypatch)
    reply = _post(_body([118, 119, 120.5, 121, 122], vehicle_id="batch-rules-critical"))
    assessment = reply["assessment"]
    assert assessment["severity"] == "critical"
    assert assessment["recommendations"][0].startswith("Dừng xe")
    assert reply["hard_safety_guardrail"]["minimum_severity"] == "critical"


def test_a_failing_llm_falls_back_to_rules_instead_of_a_502(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")

    def fail(context, memory):
        raise RuntimeError("provider down")

    monkeypatch.setattr(vehicle_agent, "model_assessment", fail)
    reply = _post(_body([106, 106.5, 107, 107.5, 108, 108.5], vehicle_id="batch-llm-error"))
    assert reply["engine"] == "rules" and reply["fallback_reason"] == "error"
    assert reply["assessment"]["severity"] == "warning"


def test_a_slow_llm_falls_back_to_rules_after_the_timeout(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setenv("BATCH_AGENT_TIMEOUT_SECONDS", "0.2")

    def slow(context, memory):
        time.sleep(1.0)
        raise AssertionError("a late reply must be dropped")

    monkeypatch.setattr(vehicle_agent, "model_assessment", slow)
    started = time.monotonic()
    reply = _post(_body([121, 122, 122, 123, 123], vehicle_id="batch-llm-slow"))
    assert time.monotonic() - started < 0.9
    assert reply["engine"] == "rules" and reply["fallback_reason"] == "timeout"
    assert reply["assessment"]["severity"] == "critical"
    time.sleep(1.0)  # let the abandoned call finish; it must not break anything


def test_a_working_llm_is_labelled_as_the_agent(monkeypatch) -> None:
    from schemas import Severity, VehicleAssessment

    monkeypatch.setenv("AGENT_MODE", "openai")
    fine = VehicleAssessment(severity=Severity.NORMAL, diagnosis="Xe ổn.", evidence=["x"], confidence=0.7, recommendations=["Theo dõi."])
    monkeypatch.setattr(vehicle_agent, "model_assessment", lambda context, memory: (fine, []))
    reply = _post(_body([90, 90, 90.1, 90.1, 90], vehicle_id="batch-llm-ok", fan=20))
    assert reply["engine"] == "agent" and reply["fallback_reason"] is None


def test_a_model_that_shrugs_at_a_sustained_hot_coolant_cannot_answer_normal(monkeypatch) -> None:
    from schemas import Severity, VehicleAssessment

    monkeypatch.setenv("AGENT_MODE", "openai")
    shrug = VehicleAssessment(severity=Severity.NORMAL, diagnosis="Xe ổn.", evidence=["x"], confidence=0.7, recommendations=["Theo dõi."])
    monkeypatch.setattr(vehicle_agent, "model_assessment", lambda context, memory: (shrug, []))
    reply = _post(_body([106, 106.4, 106.8, 106.5, 107, 106.6, 106.9, 107.1, 106.7, 106.8], vehicle_id="batch-floor-hot", speed=65, fan=35))
    assert reply["assessment"]["severity"] == "warning"
    assert any("liên tục" in line for line in reply["assessment"]["evidence"])
    assert reply["engine"] == "agent"  # the wording is still the model's; only the level has a floor


def test_a_short_or_cool_batch_has_no_coolant_floor(monkeypatch) -> None:
    from schemas import Severity, VehicleAssessment

    monkeypatch.setenv("AGENT_MODE", "openai")
    fine = VehicleAssessment(severity=Severity.NORMAL, diagnosis="Xe ổn.", evidence=["x"], confidence=0.7, recommendations=["Theo dõi."])
    monkeypatch.setattr(vehicle_agent, "model_assessment", lambda context, memory: (fine, []))
    # hot only in the last two samples: a spike, not a sustained reading
    reply = _post(_body([96, 97, 98, 99, 100, 101, 102, 103, 106, 107], vehicle_id="batch-floor-spike", fan=35))
    assert reply["assessment"]["severity"] == "normal"
