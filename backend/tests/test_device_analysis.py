import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import agent.orchestrator as orchestrator
from analysis.worker import AnalysisWorker
from schemas import Severity, VehicleAssessment
from store import Store, store
from telemetry.db import TelemetryStore
from telemetry.ingest import ingest_batch
from telemetry.notify import after_ingest
from telemetry.queries import snapshot
from telemetry.schemas_v2 import IngestBatchV2
from telemetry.stream import Broker, redact

T0 = datetime(2026, 10, 11, 1, 0, tzinfo=timezone.utc)


class RecordingBroker(Broker):
    def __init__(self):
        super().__init__()
        self.events: list[tuple[str, dict]] = []

    def publish(self, vehicle_id, event, data):
        self.events.append((event, redact(data)))


def _assessment(severity: Severity) -> VehicleAssessment:
    return VehicleAssessment(
        severity=severity,
        diagnosis="Nhận định của model.",
        suspected_faults=["Hệ thống làm mát"] if severity != Severity.NORMAL else [],
        evidence=["Bằng chứng của model."],
        confidence=0.7,
        missing_data=[],
        recommendations=["Khuyến nghị của model."],
    )


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_MODE", "openai")
    telemetry = TelemetryStore(Store(tmp_path / "device.db"))
    telemetry.initialize()
    broker = RecordingBroker()
    worker = AnalysisWorker(telemetry, broker, agent=orchestrator.vehicle_agent, timeout=5)
    device = telemetry.create_device(f"car-{uuid.uuid4().hex[:8]}", "test")
    return SimpleNamespace(telemetry=telemetry, broker=broker, worker=worker, device=device, seq=0)


def _model_returns(monkeypatch, severity: Severity, trace_error: str | None = None) -> list:
    calls = []

    def fake_run_sync(agent, input_text, *, context, max_turns):
        calls.append(json.loads(input_text))
        if trace_error:
            context.trace.append({"tool": "get_external_environment_context", "arguments": {}, "result": {"error": trace_error}})
        return SimpleNamespace(final_output=_assessment(severity))

    monkeypatch.setattr(orchestrator.Runner, "run_sync", fake_run_sync)
    return calls


def _feed(env, start: int, count: int, signals_at, dtc=None, trip="trip-1"):
    payload = {
        "schemaVersion": 2,
        "batchId": f"{trip}-{env.seq}",
        "deviceId": env.device["id"],
        "tripId": trip,
        "seq": env.seq,
        "source": "fake-elm",
        "sampleIntervalMs": 1000,
        "vehicle": {"vin": "CNXFAKEELM0000001", "supportedPids": ["0104", "0105", "010C", "010D"]},
        "records": [
            {
                "capturedAt": (T0 + timedelta(seconds=s)).isoformat(),
                "location": {"lat": 10.8023, "lon": 106.7311, "fixed": True},
                "signals": signals_at(s),
            }
            for s in range(start, start + count)
        ],
    }
    if dtc:
        payload["dtc"] = dtc
    env.seq += 1
    batch = IngestBatchV2.model_validate(payload)
    result = ingest_batch(env.telemetry, env.device, batch)
    return after_ingest(env.telemetry, env.broker, env.worker, batch, result)


def _nominal(s):
    return {"coolant": 90.0, "engineLoad": 30, "rpm": 2000, "speed": 40}


def _analyses(env) -> list[dict]:
    with env.telemetry.base.connect() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM analyses ORDER BY at")]


def test_model_alone_cannot_raise_an_alert_on_nominal_data(env, monkeypatch) -> None:
    calls = _model_returns(monkeypatch, Severity.WARNING)
    assert _feed(env, 0, 5, _nominal) == "trip_start"

    [payload] = env.worker.run_pending()

    assert payload["engine"] == "agent" and payload["model_severity"] == "warning"
    assert payload["severity"] == "normal" and payload["reply"]["assessment"]["severity"] == "normal"
    assert store.get_open_incident(env.device["vehicle_id"]) is None
    sent = calls[0]["telemetry_context"]
    assert sent["records"][0]["coolant_temp_c"] == 90.0  # snake_case keys reach the guardrails
    assert "oil_temp_c" in sent["missing_signals"]


def test_detector_floor_overrides_a_normal_model(env, monkeypatch) -> None:
    _model_returns(monkeypatch, Severity.NORMAL)
    _feed(env, 0, 15, lambda s: {"coolant": 110.0, "engineLoad": 30, "rpm": 2000})
    _feed(env, 15, 15, lambda s: {"coolant": 110.0, "engineLoad": 30, "rpm": 2000})

    payloads = env.worker.run_pending()

    final = payloads[-1]
    assert final["severity"] == "warning"
    assert any("≥ 105°C" in item for item in final["reply"]["assessment"]["evidence"])
    assert store.get_open_incident(env.device["vehicle_id"]) is not None
    with env.telemetry.base.connect() as connection:
        kinds = [row["kind"] for row in connection.execute("SELECT kind FROM trip_events ORDER BY at")]
    assert kinds[0] == "start" and "warning" in kinds


def test_rules_mode_never_calls_the_model_and_p0217_is_critical(env, monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "rules")
    monkeypatch.setattr(
        orchestrator.Runner, "run_sync", lambda *a, **k: (_ for _ in ()).throw(AssertionError("LLM called"))
    )
    dtc = {
        "readAt": (T0 + timedelta(seconds=4)).isoformat(),
        "mil": True,
        "stored": ["P0217"],
        "freezeFrame": {"dtc": "P0217", "signals": {"coolant": 118, "rpm": 2169}},
    }
    assert _feed(env, 0, 5, lambda s: {"coolant": 118.0, "engineLoad": 36, "rpm": 2200}, dtc=dtc) == "dtc"

    [payload] = env.worker.run_pending()

    reply = payload["reply"]
    assert payload["engine"] == "rules" and payload["severity"] == "critical"
    assert reply["assessment"]["recommendations"][0].startswith("Dừng xe")
    assert reply["hard_safety_guardrail"]["triggered"] is True
    assert any("P0217" in item for item in reply["assessment"]["evidence"])


def test_agent_timeout_falls_back_to_rules_and_persists_once(env, monkeypatch) -> None:
    def slow_run_sync(*args, **kwargs):
        time.sleep(0.6)
        return SimpleNamespace(final_output=_assessment(Severity.CRITICAL))

    monkeypatch.setattr(orchestrator.Runner, "run_sync", slow_run_sync)
    env.worker.timeout = 0.1
    _feed(env, 0, 5, _nominal)

    [payload] = env.worker.run_pending()
    time.sleep(0.8)  # let the abandoned model call finish

    assert payload["engine"] == "rules" and payload["fallback_reason"] == "timeout"
    assert len(_analyses(env)) == 1
    assert store.get_open_incident(env.device["vehicle_id"]) is None


def test_trigger_sequence_follows_data_time(env, monkeypatch) -> None:
    _model_returns(monkeypatch, Severity.NORMAL)
    assert _feed(env, 0, 5, _nominal) == "trip_start"
    assert _feed(env, 5, 5, _nominal) is None  # the queued job already covers this trip
    env.worker.run_pending()
    assert _feed(env, 10, 5, _nominal) is None

    def rising(s):
        return {"coolant": 96 + (s - 15) * 0.2, "engineLoad": 30, "rpm": 2000, "speed": 40}

    assert _feed(env, 15, 40, rising) == "detector"
    env.worker.run_pending()
    pending = {"readAt": (T0 + timedelta(seconds=60)).isoformat(), "mil": False, "pending": ["P0128"]}
    assert _feed(env, 56, 5, _nominal, dtc=pending) == "dtc"
    env.worker.run_pending()
    assert _feed(env, 61, 5, _nominal) is None
    assert _feed(env, 400, 5, _nominal) == "heartbeat"


def test_analysis_event_is_redacted_and_shaped_for_the_dashboard(env, monkeypatch) -> None:
    _model_returns(monkeypatch, Severity.NORMAL, trace_error="HTTP 401 https://api.x/y?key=SECRET123")
    _feed(env, 0, 5, _nominal)
    [payload] = env.worker.run_pending()

    events = dict(env.broker.events)
    assert "samples" in events and "trip" in events and "analysis" in events
    published = events["analysis"]
    assert "SECRET123" not in json.dumps(published) and "SECRET123" not in _analyses(env)[0]["payload_json"]
    assert published["reply"]["batch_id"] == payload["id"]
    assert published["reply"]["accepted_records"] == payload["record_count"] == 5

    state = snapshot(env.telemetry, env.device["vehicle_id"])
    assert state["profile"]["known"] and state["profile"]["supported_signals"] == ["rpm", "speed", "engineLoad", "coolant"]
    assert len(state["samples"]) == 5 and state["analysis"]["id"] == payload["id"]
    assert state["trip"]["simulated"] is True
