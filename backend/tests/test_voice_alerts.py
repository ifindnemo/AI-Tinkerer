"""Spoken alerts reach the browser: driver alerts in the agent's words, car alerts once."""

import time
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import voice
from driver.schemas import DriverNarrative
from driver.service import DriverService


@pytest.fixture
def spoken(monkeypatch, tmp_path):
    """Blaze configured, synthesis faked: every spoken line is recorded and stored as a clip."""
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "speaker-1")
    monkeypatch.setattr(voice, "_spoken", {})
    monkeypatch.setattr(voice, "_clips", voice.deque(maxlen=50))
    monkeypatch.setattr(voice, "_critical_at", {})
    lines = []

    def fake_speak(script, severity, key, session_id=None, lang="vi"):
        lines.append((script, session_id))
        path = tmp_path / f"{len(lines)}.mp3"
        path.write_bytes(b"ID3fake")
        voice._register(session_id, severity, script, path, "audio/mpeg", lang)

    class Inline:
        def submit(self, fn, *args):
            fn(*args)

    monkeypatch.setattr(voice, "_speak", fake_speak)
    monkeypatch.setattr(voice, "_pool", lambda: Inline())
    return lines


def test_spoken_text_keeps_whole_sentences() -> None:
    long = "Câu một rất dài " * 10 + ". Câu hai. Câu ba."
    script = voice.alert_script("Người lái buồn ngủ. " + long, "critical", ["Dừng xe."])
    assert script.startswith("Cảnh báo nguy hiểm. Người lái buồn ngủ.")
    assert len(script) <= 300 and not script.endswith("rất")


def test_clips_route_serves_new_clips_for_a_session(spoken) -> None:
    voice.announce_alert("Người lái buồn ngủ.", severity="critical", dedupe_key="k1", session_id="bmw-m2")
    voice.announce_alert("Xe khác.", severity="warning", dedupe_key="k2", session_id="other")
    app = FastAPI()
    app.include_router(voice.router, prefix="/api")
    client = TestClient(app)
    listing = client.get("/api/voice/clips", params={"session": "bmw-m2"}).json()
    assert listing["enabled"] is True and [c["severity"] for c in listing["clips"]] == ["critical"]
    clip = listing["clips"][0]
    assert "_path" not in clip and clip["text"].startswith("Cảnh báo nguy hiểm.")
    assert client.get(f"/api/voice/clips/{clip['id']}/audio").content == b"ID3fake"
    assert client.get("/api/voice/clips", params={"session": "bmw-m2", "after": clip["seq"]}).json()["clips"] == []
    assert client.get("/api/voice/clips", params={"session": "../etc"}).status_code == 422
    assert client.get("/api/voice/clips/clip_999/audio").status_code == 404


T0 = datetime(2026, 10, 11, 2, 0, 0, tzinfo=timezone.utc)


def _batch(vehicle_id="bmw-m2"):
    from driver.schemas import DriverBatch

    at = (T0).isoformat().replace("+00:00", "Z")
    return DriverBatch.model_validate({
        "schemaVersion": 1, "sessionId": "voice-session-01", "source": "webcam",
        "context": {"vehicleMoving": True, "vehicleId": vehicle_id,
                    "vehicle": {"source": "obd", "capturedAt": at, "speedKmh": 60, "coolantC": 92}},
        "events": [{"capturedAt": at, "facePresent": True, "absentMs": 0,
                    "eyes": {"closed": True, "closedMs": 2600, "perclos": None, "score": 0.9},
                    "head": {"direction": "forward", "yawDeg": 1, "pitchDeg": 0, "awayMs": 0}, "state": "drowsy", "confidence": 0.9}],
    })


def test_driver_alert_is_spoken_in_the_agents_words_for_the_vehicle(spoken, monkeypatch) -> None:
    import driver.agent as agent_module

    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setattr(agent_module, "_narrate", lambda rule, events, moving, guardian: DriverNarrative(
        summary="Bạn đang buồn ngủ, hãy dừng xe ở chỗ an toàn gần nhất.", recommendations=["Dừng xe."]))
    DriverService().process(_batch())
    deadline = time.monotonic() + 3
    while not spoken and time.monotonic() < deadline:
        time.sleep(0.02)
    # The agent's own sentence, once; the step it already says is not appended again.
    assert spoken == [("Cảnh báo nguy hiểm. Bạn đang buồn ngủ, hãy dừng xe ở chỗ an toàn gần nhất.", "bmw-m2")]


def test_a_warning_worded_after_a_critical_alert_is_not_spoken(spoken) -> None:
    voice.announce_alert("Mắt nhắm quá lâu.", severity="critical", dedupe_key="c", session_id="bmw-m2")
    voice.announce_alert("Có dấu hiệu buồn ngủ.", severity="warning", dedupe_key="w", session_id="bmw-m2")
    voice.announce_alert("Xe khác nóng máy.", severity="warning", dedupe_key="o", session_id="other-car")
    assert [session for _, session in spoken] == ["bmw-m2", "other-car"]


def test_slow_or_failed_llm_falls_back_to_the_rule_text_once(spoken, monkeypatch) -> None:
    import driver.service as service_module

    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setenv("DRIVER_AGENT_TIMEOUT_SECONDS", "0.2")
    pending = Future()
    monkeypatch.setattr(service_module, "submit", lambda *args: pending)
    DriverService().process(_batch())
    time.sleep(0.4)
    assert len(spoken) == 1 and "dấu hiệu mất tỉnh táo" in spoken[0][0]
    pending.set_result((DriverNarrative(summary="Quá muộn.", recommendations=["x"]), None))
    assert len(spoken) == 1  # the late wording is not spoken a second time


def test_rules_mode_speaks_the_rule_text_at_once(spoken, monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "rules")
    DriverService().process(_batch())
    assert len(spoken) == 1 and spoken[0][1] == "bmw-m2"


def test_car_agent_stays_quiet_when_only_the_driver_raised_the_alert(spoken, monkeypatch) -> None:
    from agent.orchestrator import vehicle_agent
    from routes import router
    from schemas import Severity, VehicleAssessment

    monkeypatch.setenv("AGENT_MODE", "rules")
    DriverService().process(_batch(vehicle_id="vehicle-voice-1"))
    spoken.clear()
    normal = VehicleAssessment(severity=Severity.NORMAL, diagnosis="Xe ổn.", evidence=["x"], confidence=0.7, recommendations=["Theo dõi."])
    monkeypatch.setattr(vehicle_agent, "model_assessment", lambda context, memory: (normal, []))
    monkeypatch.setenv("AGENT_MODE", "openai")  # driver wording was requested above in rules mode; the car batch uses the stubbed model
    app = FastAPI()
    app.include_router(router, prefix="/api")
    record = {"capturedAt": T0.isoformat(), "rpm": 2400, "map": 60, "tps": 30, "engineLoad": 50, "consumption": 8, "speed": 62,
              "coolant": 96, "intake": 38, "battery": 13.9, "location": {"lat": 10.8, "lon": 106.7}}
    body = {"schemaVersion": 1, "batchId": "voice-1", "vehicleId": "vehicle-voice-1", "source": "blackbox-simulator",
            "sampleIntervalMs": 1000, "recordCount": 1, "records": [record]}
    reply = TestClient(app).post("/api/telemetry/batch", json=body).json()
    assert reply["assessment"]["severity"] == "critical"  # raised by the drowsy driver …
    assert spoken == []  # … whose own alert was already spoken

    hot = normal.model_copy(update={"severity": Severity.WARNING, "diagnosis": "Nhiệt độ động cơ cao. Cần theo dõi."})
    monkeypatch.setattr(vehicle_agent, "model_assessment", lambda context, memory: (hot, []))
    body["vehicleId"] = "vehicle-voice-2"
    TestClient(app).post("/api/telemetry/batch", json={**body, "batchId": "voice-2"})
    assert [line for line, session in spoken if session == "vehicle-voice-2"][0].startswith("Cảnh báo. Nhiệt độ động cơ cao.")
