"""Vehicle Guardian: ECU + camera + maintenance, decided by fixed rules (docs: README_VEHICLE_GUARDIAN_CAMERA)."""

import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import driver.agent as agent_module
from driver.agent import unsafe_for_stop
from driver.guardian import decide, load_cases
from driver.routes import get_driver_service, router
from driver.schemas import DriverBatch, DriverNarrative
from driver.service import DriverService

T0 = datetime(2026, 10, 11, 2, 0, 0, tzinfo=timezone.utc)


def _iso(second: float) -> str:
    return (T0 + timedelta(seconds=second)).isoformat().replace("+00:00", "Z")


def _event(second: float, state="attentive", closed_ms=0, **over) -> dict:
    event = {
        "capturedAt": _iso(second),
        "facePresent": state != "no_face",
        "absentMs": 3000 if state == "no_face" else 0,
        "eyes": {"closed": state == "drowsy", "closedMs": closed_ms, "perclos": None, "score": 0.9 if state == "drowsy" else 0.1},
        "head": {"direction": "forward", "yawDeg": 1.0, "pitchDeg": 0.5, "awayMs": 0},
        "state": state,
        "confidence": 0.9,
    }
    event.update(over)
    return event


def _vehicle(second: float = 0, speed=65, coolant=107) -> dict:
    return {"source": "simulated", "capturedAt": _iso(second), "speedKmh": speed, "coolantC": coolant, "engineLoadPct": 72, "drivingMinutes": 128}


def _batch(events, vehicle=None, ack=None, session="guardian-session-01") -> DriverBatch:
    context = {"vehicleMoving": True}
    if vehicle is not None:
        context["vehicle"] = vehicle
    if ack is not None:
        context["acknowledgedAt"] = ack
    return DriverBatch.model_validate({"schemaVersion": 1, "sessionId": session, "source": "webcam", "context": context, "events": events})


@pytest.fixture(autouse=True)
def rules_only(monkeypatch):
    monkeypatch.setenv("AGENT_MODE", "rules")
    monkeypatch.delenv("COOLANT_WARN_C", raising=False)


@pytest.mark.parametrize("case", load_cases(), ids=lambda case: case["name"])
def test_shared_policy_cases(case) -> None:
    i = case["input"]
    d = decide(speed_kmh=i["speedKmh"], coolant_c=i["coolantC"], warn_c=i["warnC"], driver_state=i["driverState"],
               driver_severity=i["driverSeverity"], responded=i["responded"], unanswered=i["unanswered"])
    got = {"severity": d.severity, "action": d.action, "mustStop": d.must_stop, "attention": d.attention,
           "vehicleLevel": d.vehicle_level, "driverSeverity": d.driver_severity}
    assert got == case["expect"]


def test_without_an_ecu_reading_the_reply_is_unchanged() -> None:
    reply = DriverService().process(_batch([_event(0, "drowsy", 2600)]))
    assert "guardian" not in reply
    assert reply["assessment"]["severity"] == "critical"


def test_demo_flow_blink_then_closure_then_stop_nearest_safe() -> None:
    service = DriverService()
    # 1–2. Face found; a normal blink raises nothing, but the warm engine is already a warning.
    reply = service.process(_batch([_event(0), _event(1, "attentive", 200)], _vehicle(1)))
    g = reply["guardian"]
    assert g["driver"]["attention"] == "attentive" and g["action"] == "reduce_load"
    assert reply["assessment"]["severity"] == "warning"
    assert any("garage phù hợp" in step for step in reply["assessment"]["recommendations"])
    # 3–6. Eyes closed past the threshold: low attention, stop at the nearest safe place, not the far garage.
    reply = service.process(_batch([_event(2, "drowsy", 1600), _event(3, "drowsy", 2600)], _vehicle(3)))
    g, a = reply["guardian"], reply["assessment"]
    assert g["driver"]["attention"] == "low_attention" and g["driver"]["closedMs"] == 2600
    assert g["action"] == "stop_nearest_safe" and g["mustStop"] is True
    assert a["severity"] == "critical"
    assert a["recommendations"][0].startswith("Dừng tại vị trí an toàn gần nhất")
    assert not any("garage phù hợp" in step for step in a["recommendations"])
    assert "Không nên tiếp tục hành trình đến garage ở xa." in a["summary"]
    # 5. Evidence cites all three sources, each labelled.
    assert a["evidence"][0].startswith("ECU (mô phỏng): 65 km/h, nước làm mát 107°C")
    assert any(item.startswith("Camera: ") for item in a["evidence"])
    assert any(item.startswith("Lịch sử bảo trì (mô phỏng): 8 lần") and "không xác định nguyên nhân" in item for item in a["evidence"])
    assert g["maintenance"]["simulated"] is True and g["maintenance"]["records"] == 8
    # 7. Eyes open and the driver confirms: response recorded, the vehicle warning stays.
    reply = service.process(_batch([_event(5)], _vehicle(5), ack=_iso(5)))
    g, a = reply["guardian"], reply["assessment"]
    assert g["driver"]["responded"] is True
    assert g["vehicle"]["level"] == "warning"
    assert a["severity"] == "warning"  # at least the vehicle warning, no longer the horn-level alert
    assert g["action"] == "stop_nearest_safe"  # the microsleep is still recent: rest before going on
    assert a["summary"].startswith("Đã ghi nhận phản hồi của tài xế.")


def test_overheat_alert_works_with_the_agent_off_and_ignores_the_driver() -> None:
    service = DriverService()
    reply = service.process(_batch([_event(0)], _vehicle(0, coolant=121)))
    a = reply["assessment"]
    assert a["severity"] == "critical" and a["engine"] == "rules"
    assert reply["guardian"]["action"] == "stop_engine"
    assert a["recommendations"] == [
        "Tấp vào vị trí an toàn gần nhất và tắt động cơ.",
        "Không tiếp tục đến trạm nghỉ hoặc garage.",
        "Không mở nắp két nước khi động cơ còn nóng.",
    ]


@pytest.mark.parametrize("bad", [
    "eyes_closed", "looking_away", "unknown_time", "before_alert", "relapse", "low_confidence",
])
def test_acknowledgement_is_checked_against_the_sessions_own_events(bad) -> None:
    service = DriverService()
    service.process(_batch([_event(0, "drowsy", 2600)], _vehicle(0)))
    confirm = _event(2)
    ack = _iso(2)
    extra = []
    if bad == "eyes_closed":
        confirm = _event(2, "attentive", 300, eyes={"closed": True, "closedMs": 300, "perclos": None, "score": 0.7})
    elif bad == "looking_away":
        confirm["head"] = {"direction": "left", "yawDeg": 20.0, "pitchDeg": 0.5, "awayMs": 500}
    elif bad == "unknown_time":
        ack = _iso(2.5)
    elif bad == "relapse":
        extra = [_event(3, "drowsy", 1600)]
    elif bad == "low_confidence":
        confirm["confidence"] = 0.3
    if bad == "before_alert":
        service = DriverService()
        reply = service.process(_batch([_event(0)], _vehicle(0), ack=_iso(0)))
    else:
        reply = service.process(_batch([confirm, *extra], _vehicle(3), ack=ack))
    assert reply["guardian"]["driver"]["responded"] is False


def test_unanswered_alert_escalates_after_ten_seconds() -> None:
    service = DriverService()
    first = service.process(_batch([_event(0, "drowsy", 1600)], _vehicle(0)))
    assert first["assessment"]["severity"] == "warning"
    later = service.process(_batch([_event(11, "drowsy", 1600)], _vehicle(11)))
    assert later["guardian"]["driver"]["unanswered"] is True
    assert later["assessment"]["severity"] == "critical"
    assert any("Chưa có phản hồi" in item for item in later["assessment"]["evidence"])


def test_unknown_driver_keeps_the_vehicle_warning() -> None:
    reply = DriverService().process(_batch([_event(0, "no_face")], _vehicle(0)))
    assert reply["guardian"]["driver"]["attention"] == "unknown"
    assert reply["assessment"]["severity"] == "warning"
    assert "Không thể xác định trạng thái người lái từ camera" in reply["assessment"]["summary"]


def test_speed_from_the_ecu_decides_moving() -> None:
    parked = DriverService().process(_batch([_event(0, "drowsy", 1600)], _vehicle(0, speed=0, coolant=88)))
    assert parked["guardian"]["action"] == "stay_parked" and parked["guardian"]["mustStop"] is False
    assert parked["guardian"]["vehicle"]["moving"] is False


def test_vehicle_level_change_rekeys_the_agent_wording(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    calls = []

    def fake(rule, events, moving, guardian):
        calls.append(guardian.decision.action)
        return DriverNarrative(summary="Xe mô phỏng: dừng tại vị trí an toàn gần nhất.", recommendations=["Dừng xe."])

    monkeypatch.setattr(agent_module, "_narrate", fake)
    service = DriverService()
    service.process(_batch([_event(0)], _vehicle(0)))
    time.sleep(0.2)  # let the background wording finish
    service.process(_batch([_event(1)], _vehicle(1, coolant=121)))
    time.sleep(0.2)
    reply = service.process(_batch([_event(2)], _vehicle(2, coolant=121)))
    assert calls == ["reduce_load", "stop_engine"]
    assert reply["assessment"]["engine"] == "agent"
    assert reply["assessment"]["recommendations"][0] == "Tấp vào vị trí an toàn gần nhất và tắt động cơ."  # steps stay the policy's


def test_agent_payload_has_structured_values_only() -> None:
    from driver.guardian import combine, maintenance_context
    from driver.rules import assess

    batch = _batch([_event(0, "drowsy", 2600)], _vehicle(0))
    rule = assess(batch.events, True)
    guardian = combine(rule, batch.events, batch.context.vehicle, responded=False, unanswered=False, alert_since=None, maintenance=maintenance_context())
    captured = agent_module.guardian_payload(guardian)
    assert set(captured) == {"ecu", "driver", "maintenance", "policy"}
    assert captured["ecu"]["simulated"] is True
    assert captured["policy"]["must_stop"] is True
    assert "events" not in captured["driver"]  # a summary, not the raw event stream


@pytest.mark.parametrize("text,unsafe", [
    ("Hãy tiếp tục lái đến garage.", True),
    ("Bạn có thể đi tiếp tới trạm nghỉ.", True),
    ("Không nên dừng lâu, cứ tiếp tục hành trình.", True),
    ("Không tiếp tục đến garage ở xa; dừng tại vị trí an toàn gần nhất.", False),
    ("Đừng tiếp tục lái khi còn buồn ngủ.", False),
    ("Không nên tiếp tục hành trình đến garage ở xa.", False),
    ("Hãy dừng tại vị trí an toàn gần nhất thay vì tiếp tục hành trình đến garage ở xa.", False),
    ("Xe đang chạy ở tốc độ 65 km/h, nhiệt độ động cơ đang tăng ở mức cảnh báo và người lái có dấu hiệu mất tỉnh táo sau hơn hai giờ vận hành. Không nên tiếp tục đến garage ở xa. Hãy dừng tại vị trí an toàn gần nhất, nghỉ ngơi và kiểm tra lại nhiệt độ động cơ trước khi tiếp tục.", False),
])
def test_stop_guard_rejects_continue_wording(text, unsafe) -> None:
    assert unsafe_for_stop(text) is unsafe


def test_endpoint_accepts_the_vehicle_context_and_rejects_unknown_fields() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    service = DriverService()
    app.dependency_overrides[get_driver_service] = lambda: service
    client = TestClient(app)
    body = {"schemaVersion": 1, "sessionId": "guardian-session-02", "source": "simulated",
            "context": {"vehicleMoving": True, "vehicle": _vehicle(0)}, "events": [_event(0)]}
    assert client.post("/api/driver/events", json=body).json()["guardian"]["vehicle"]["level"] == "warning"
    body["context"]["vehicle"]["frame"] = "data:image/jpeg;base64,AAAA"
    assert client.post("/api/driver/events", json=body).status_code == 422
    del body["context"]["vehicle"]["frame"]
    body["context"]["vehicle"]["source"] = "obd"
    assert client.post("/api/driver/events", json=body).status_code == 422
    body["context"]["vehicle"]["source"] = "simulated"
    body["context"]["acknowledgedAt"] = "2026-10-11T02:00:00"
    assert client.post("/api/driver/events", json=body).status_code == 422


@pytest.mark.parametrize("coolant,state,closed", [(107, "drowsy", 2600), (107, "drowsy", 1600), (121, "drowsy", 2600), (121, "attentive", 0), (88, "drowsy", 1600)])
def test_the_policys_own_wording_passes_the_stop_guard(coolant, state, closed) -> None:
    for responded in (False, True):
        reply = DriverService().process(_batch([_event(0, state, closed)], _vehicle(0, coolant=coolant)))
        a = reply["assessment"]
        assert not unsafe_for_stop(a["summary"]), a["summary"]
        assert not any(unsafe_for_stop(step) for step in a["recommendations"])


def test_unsafe_agent_wording_falls_back_to_the_rules(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setattr(agent_module, "_narrate", lambda rule, events, moving, guardian: DriverNarrative(
        summary="Nhiệt độ vẫn ổn, bạn có thể tiếp tục lái đến garage.", recommendations=["Đi tiếp."]))
    service = DriverService()
    service.process(_batch([_event(0, "drowsy", 2600)], _vehicle(0)))
    time.sleep(0.2)
    reply = service.process(_batch([_event(1, "drowsy", 2600)], _vehicle(1)))
    a = reply["assessment"]
    assert a["engine"] == "rules" and a["fallbackReason"] == "unsafe_wording"
    assert "Không nên tiếp tục hành trình đến garage ở xa." in a["summary"]
