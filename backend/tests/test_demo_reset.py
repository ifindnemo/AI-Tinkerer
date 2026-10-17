"""POST /api/demo/reset: a fresh run starts without what the last one left in memory."""
import json

import pytest
from fastapi.testclient import TestClient

import main
import talk
from driver.registry import driver_registry
from situation import current_situation, remember_vehicle_situation
from store import store
import voice


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    return TestClient(main.app)


def _leave_a_critical_run(tmp_path) -> str:
    vehicle = "reset-test-car"
    remember_vehicle_situation(vehicle, {"severity": "critical", "diagnosis": "Overheating"}, [], {"code": "stop_and_get_help"})
    driver_registry.update(vehicle, {"attention": "low_attention", "severity": "critical", "state": "drowsy", "must_stop": True})
    voice._spoken[f"{vehicle}:critical:en:x"] = 9e9
    voice._critical_at[vehicle] = 1.0
    (tmp_path / f"{vehicle}.json").write_text(json.dumps({"sessionId": vehicle, "turns": []}))
    incident = store.create_incident(
        vehicle_id=vehicle, severity="critical", diagnosis="Overheating", assessment={"severity": "critical"},
        reasons=[], recommendations=["Stop"], tool_trace=[],
    )
    store.upsert_incident_memory(incident_id=incident["id"], vehicle_id=vehicle, telemetry_context={"vehicle_id": vehicle},
                                 assessment={"severity": "critical"}, tool_trace=[])
    return vehicle


def test_reset_forgets_the_last_run_so_the_first_question_is_not_told_to_stop(client, tmp_path) -> None:
    vehicle = _leave_a_critical_run(tmp_path)
    assert talk.situation(vehicle)["must_stop"] is True and driver_registry.get(vehicle)["status"] == "live"

    response = client.post("/api/demo/reset")

    assert response.status_code == 200 and response.json()["ok"] is True and response.json()["closed_incidents"] >= 1
    assert current_situation(vehicle) is None
    assert driver_registry.get(vehicle)["status"] == "off"
    assert not any(key.startswith(vehicle) for key in voice._spoken) and vehicle not in voice._critical_at
    assert store.get_open_incident(vehicle) is None and store.get_active_incident_memory(vehicle) is None
    assert not (tmp_path / f"{vehicle}.json").exists()
    brief = talk.situation(vehicle)
    assert brief["must_stop"] is False and brief["stale"] is True, "no fresh reading is said, nothing is ordered"


def test_reset_keeps_the_incident_rows_for_the_record(client, tmp_path) -> None:
    vehicle = _leave_a_critical_run(tmp_path)
    client.post("/api/demo/reset")
    incident = next(row for row in _all_incidents() if row["vehicle_id"] == vehicle)
    assert incident["status"] == "closed"


def _all_incidents():
    with store.connect() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM incidents")]


def test_reset_refuses_a_client_that_is_not_the_local_machine(client) -> None:
    from demo_reset import _LOOPBACK

    remote = TestClient(main.app, client=("203.0.113.9", 5000))
    assert remote.post("/api/demo/reset").status_code == 403
    assert "203.0.113.9" not in _LOOPBACK


def test_switching_scenario_clears_the_car_but_keeps_the_camera_and_the_conversation(client, tmp_path) -> None:
    vehicle = _leave_a_critical_run(tmp_path)

    response = client.post("/api/demo/reset", json={"scope": "car"})

    assert response.status_code == 200 and response.json()["scope"] == "car"
    assert current_situation(vehicle) is None and store.get_open_incident(vehicle) is None
    assert not any(key.startswith(vehicle) for key in voice._spoken), "the new scenario's alert may be spoken again"
    assert driver_registry.get(vehicle)["status"] == "live", "the driver did not change"
    assert (tmp_path / f"{vehicle}.json").exists()
    driver_registry.clear()


def test_an_analysis_that_straddles_a_reset_stores_nothing_and_answers_409(client, monkeypatch) -> None:
    from agent.orchestrator import vehicle_agent
    from schemas import Severity, VehicleAssessment

    def slow_model(*args, **kwargs):
        client.post("/api/demo/reset", json={"scope": "car"})  # the scenario is switched while the model works
        return (VehicleAssessment(severity=Severity.CRITICAL, diagnosis="Old scenario", recommendations=["Stop"], confidence=0.9),
                [], "agent", None)

    monkeypatch.setattr(vehicle_agent, "_model_or_rules", slow_model)
    before = {row["id"] for row in _all_incidents()}
    body = {"schemaVersion": 1, "batchId": "b-straddle", "vehicleId": "straddle-car", "source": "blackbox-simulator",
            "sampleIntervalMs": 1000, "recordCount": 1, "lang": "en",
            "records": [{"capturedAt": "2026-10-17T00:00:00Z", "rpm": 2000, "engineLoad": 40, "speed": 60, "coolant": 125,
                         "intake": 30, "battery": 13.8, "location": {"lat": 10.8, "lon": 106.7}}]}
    response = client.post("/api/telemetry/batch", json=body)

    assert response.status_code == 409
    assert {row["id"] for row in _all_incidents()} == before, "no incident was opened for the old scenario"
    assert current_situation("straddle-car") is None
