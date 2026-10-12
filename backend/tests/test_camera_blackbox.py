"""Camera + blackbox: the vehicle agent sees the driver's state from the camera page (no images)."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.orchestrator import VehicleAgent, vehicle_agent
from driver.registry import STOP_FOR_DRIVER, DriverRegistry, attach_driver, driver_registry, suggests_garage_trip
from driver.schemas import DriverBatch
from driver.service import DriverService
from routes import router as blackbox_router
from schemas import Severity, VehicleAssessment

T0 = datetime(2026, 10, 11, 2, 0, 0, tzinfo=timezone.utc)


def _iso(second: float) -> str:
    return (T0 + timedelta(seconds=second)).isoformat().replace("+00:00", "Z")


def _event(second: float, state="attentive", closed_ms=0) -> dict:
    return {
        "capturedAt": _iso(second), "facePresent": state != "no_face", "absentMs": 3000 if state == "no_face" else 0,
        "eyes": {"closed": state == "drowsy", "closedMs": closed_ms, "perclos": None, "score": 0.9 if state == "drowsy" else 0.1},
        "head": {"direction": "forward", "yawDeg": 1.0, "pitchDeg": 0.5, "awayMs": 0}, "state": state, "confidence": 0.9,
    }


def _driver_batch(events, vehicle_id="bmw-m2", speed=65.0, coolant=96.0) -> DriverBatch:
    return DriverBatch.model_validate({
        "schemaVersion": 1, "sessionId": "garage-camera-01", "source": "webcam",
        "context": {"vehicleMoving": True, "vehicleId": vehicle_id,
                    "vehicle": {"source": "obd", "capturedAt": _iso(0), "speedKmh": speed, "coolantC": coolant}},
        "events": events,
    })


def _context(speed=65.0, vehicle_id="bmw-m2") -> dict:
    return {"vehicle_id": vehicle_id, "records": [{"captured_at": _iso(0), "speed": speed, "coolant_temp_c": 96.0}]}


def _raw(severity=Severity.NORMAL, recommendations=None) -> VehicleAssessment:
    return VehicleAssessment(
        severity=severity, diagnosis="Thông số xe trong ngưỡng.", evidence=["Nhiệt độ 96°C."], confidence=0.7,
        recommendations=recommendations or ["Đưa xe tới garage để kiểm tra khi thuận tiện.", "Theo dõi nhiệt độ."],
    )


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.setenv("AGENT_MODE", "rules")
    driver_registry.clear()
    yield
    driver_registry.clear()


def test_registry_reports_off_live_and_stale() -> None:
    clock = [0.0]
    registry = DriverRegistry(clock=lambda: clock[0])
    assert registry.get("bmw-m2")["status"] == "off"
    assert registry.update("bmw-m2", {"attention": "attentive", "severity": "normal"}) is True
    assert registry.update("bmw-m2", {"attention": "attentive", "severity": "normal"}) is False
    assert registry.update("bmw-m2", {"attention": "low_attention", "severity": "warning"}) is True
    assert registry.get("bmw-m2")["status"] == "live"
    clock[0] = 61.0
    stale = registry.get("bmw-m2")
    assert stale["status"] == "stale" and "attention" not in stale  # old state is not presented as current


def test_camera_events_with_a_vehicle_id_reach_the_vehicle_agent_context() -> None:
    DriverService().process(_driver_batch([_event(0), _event(1, "drowsy", 2600)]))
    context = attach_driver(_context())
    driver = context["driver_attention"]
    assert driver["status"] == "live"
    assert driver["attention"] == "low_attention" and driver["severity"] == "critical"
    assert driver["closed_ms_max_60s"] == 2600 and driver["must_stop"] is True
    assert set(driver) >= {"source", "state", "responded", "unanswered", "observed_at", "privacy"}
    assert not any(key in str(driver).lower() for key in ("landmark", "base64", "frame"))


def test_camera_without_a_vehicle_id_is_not_shared() -> None:
    batch = _driver_batch([_event(0, "drowsy", 2600)])
    batch.context.vehicle_id = None
    DriverService().process(batch)
    assert attach_driver(_context())["driver_attention"]["status"] == "off"


def test_finalize_makes_a_drowsy_driver_in_a_moving_car_stop_nearby() -> None:
    DriverService().process(_driver_batch([_event(0, "drowsy", 2600)]))
    context = attach_driver(_context())
    assessment, _ = vehicle_agent.finalize(_raw(), context, [], None)
    assert assessment.severity == Severity.CRITICAL
    assert assessment.recommendations[0] == STOP_FOR_DRIVER
    assert not any(suggests_garage_trip(step) for step in assessment.recommendations)
    assert assessment.evidence[0].startswith("Camera tài xế: dấu hiệu buồn ngủ, nhắm mắt lâu nhất 2,6 giây")
    assert assessment.diagnosis.startswith("Camera cho thấy người lái có dấu hiệu buồn ngủ khi xe đang chạy")


def test_engine_stop_stays_first_when_the_driver_is_drowsy_too() -> None:
    DriverService().process(_driver_batch([_event(0, "drowsy", 1600)]))
    context = attach_driver(_context())
    context["records"][0]["coolant_temp_c"] = 121.0
    assessment, _ = vehicle_agent.finalize(_raw(Severity.WARNING, ["Kiểm tra két nước."]), context, [], None)
    assert assessment.severity == Severity.CRITICAL
    assert assessment.recommendations[:2] == ["Dừng xe ở vị trí an toàn và không tiếp tục lái.", STOP_FOR_DRIVER]


@pytest.mark.parametrize("case", ["parked", "attentive", "stale", "off"])
def test_driver_policy_changes_nothing_without_a_live_low_attention_driver_in_a_moving_car(case, monkeypatch) -> None:
    if case == "parked":
        DriverService().process(_driver_batch([_event(0, "drowsy", 2600)], speed=0))
        context = attach_driver(_context(speed=0))
    elif case == "attentive":
        DriverService().process(_driver_batch([_event(0)]))
        context = attach_driver(_context())
    elif case == "stale":
        context = {**_context(), "driver_attention": {"status": "stale", "last": {"attention": "low_attention", "severity": "critical"}}}
    else:
        context = attach_driver(_context())
    raw = _raw()
    assessment = VehicleAgent._apply_driver_policy(raw, context)
    assert assessment.severity == raw.severity and assessment.recommendations == raw.recommendations


def test_unknown_driver_only_adds_a_note() -> None:
    DriverService().process(_driver_batch([_event(0, "no_face")]))
    raw = _raw()
    assessment = VehicleAgent._apply_driver_policy(raw, attach_driver(_context()))
    assert assessment.severity == raw.severity
    assert any("chưa xác định được trạng thái người lái" in item for item in assessment.evidence)


def test_classic_blackbox_batch_sends_the_driver_state_to_the_agent(monkeypatch) -> None:
    DriverService().process(_driver_batch([_event(0, "drowsy", 2600)], vehicle_id="vehicle-demo-001"))
    seen = {}

    def fake_model(context, memory):
        seen.update(context)
        return _raw(), []

    monkeypatch.setattr(vehicle_agent, "model_assessment", fake_model)
    app = FastAPI()
    app.include_router(blackbox_router, prefix="/api")
    record = {"capturedAt": _iso(0), "rpm": 2400, "map": 60, "tps": 30, "engineLoad": 50, "consumption": 8, "speed": 62,
              "coolant": 96, "intake": 38, "battery": 13.9, "location": {"lat": 10.8, "lon": 106.7}}
    body = {"schemaVersion": 1, "batchId": "camera-blackbox-1", "vehicleId": "vehicle-demo-001", "source": "blackbox-simulator",
            "sampleIntervalMs": 1000, "recordCount": 1, "records": [record]}
    reply = TestClient(app).post("/api/telemetry/batch", json=body).json()
    assert seen["driver_attention"]["attention"] == "low_attention"
    assert reply["assessment"]["recommendations"][0] == STOP_FOR_DRIVER


def test_device_analysis_includes_the_drowsy_driver(tmp_path, monkeypatch) -> None:
    """OBD device mode (rules mode): an alert from the camera reaches the next device analysis."""
    import uuid
    from types import SimpleNamespace

    import tests.test_device_analysis as device_tests
    from analysis.worker import AnalysisWorker
    from store import Store
    from telemetry.db import TelemetryStore

    telemetry = TelemetryStore(Store(tmp_path / "camera.db"))
    telemetry.initialize()
    env = SimpleNamespace(telemetry=telemetry, broker=device_tests.RecordingBroker(), seq=0,
                          device=telemetry.create_device(f"car-{uuid.uuid4().hex[:8]}", "test"))
    env.worker = AnalysisWorker(telemetry, env.broker, agent=vehicle_agent, timeout=5)
    device_tests._feed(env, 0, 5, lambda s: {"coolant": 92.0, "engineLoad": 40, "rpm": 2200, "speed": 64})
    env.worker.run_pending()  # the trip-start analysis
    vehicle_id = env.device["vehicle_id"]

    # The camera reports an alert; the next device analysis (here: a new batch) includes the driver.
    DriverService().process(_driver_batch([_event(0, "drowsy", 2600)], vehicle_id=vehicle_id))
    from analysis.worker import Job
    from telemetry.queries import latest_trip

    trip = latest_trip(telemetry, vehicle_id)
    env.worker.submit(Job(vehicle_id, trip["id"], trip["ended_at"], "heartbeat"))
    [payload] = env.worker.run_pending()
    assessment = payload["reply"]["assessment"]
    assert payload["severity"] == "critical"
    assert assessment["recommendations"][0] == STOP_FOR_DRIVER
    assert assessment["evidence"][0].startswith("Camera tài xế:")
