"""Spoken conversation: Blaze transcript in, one reply, both turns in the session JSON. No live network."""

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from driver.registry import driver_registry
from talk import answer, fallback_reply, guard_reply, router, strip_wake


def _app() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app)


def _post(client: TestClient, text: str = "Nước làm mát đang nóng à?", lang: str = "vi", session: str = "bmw-m2"):
    return client.post(
        "/api/voice/talk",
        data={"sessionId": session, "lang": lang},
        files={"file": ("speech.webm", b"RIFFaudio", "audio/webm")},
    )


def test_rules_mode_stores_both_turns_in_the_script(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    monkeypatch.setattr("talk.transcribe", lambda audio, filename, content_type, language=None: "Xe đang sao rồi?")
    called = {"model": False}

    def explode(*_args, **_kwargs):
        called["model"] = True
        raise AssertionError("rules mode must not call the model")

    monkeypatch.setattr("talk._model_reply", explode)
    response = _post(_app())

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Xe đang sao rồi?"
    assert body["spoken"] is False
    assert "chỉ tư vấn" in body["reply"]
    assert called["model"] is False
    document = json.loads((tmp_path / "bmw-m2.json").read_text(encoding="utf-8"))
    assert [turn["role"] for turn in document["turns"]] == ["driver", "agent"]
    assert document["turns"][0]["source"] == "stt"
    assert document["turns"][1]["source"] == "reply"
    assert document["turns"][1]["text"] == body["reply"]
    assert body["conversation"]["turns"][1]["text"] == body["reply"]


def test_talk_transcribes_in_the_requested_language(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    seen = {}

    def transcribe(audio, filename, content_type, language=None):
        seen["language"] = language
        return "How is the car?"

    monkeypatch.setattr("talk.transcribe", transcribe)
    response = _post(_app(), lang="en")
    assert response.status_code == 200
    assert seen["language"] == "en"
    assert "I heard" in response.json()["reply"]


def test_silence_does_not_append_a_turn(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setattr("talk.transcribe", lambda audio, filename, content_type, language=None: "")
    response = _post(_app())
    assert response.status_code == 200
    assert response.json()["reply"] is None
    assert list(tmp_path.glob("*.json")) == []


def test_a_stop_already_in_force_replaces_an_unsafe_reply(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    driver_registry.clear()
    driver_registry.update("bmw-m2", {"attention": "low_attention", "severity": "critical", "must_stop": True, "state": "drowsy", "responded": False})
    monkeypatch.setattr("talk._model_reply", lambda *args: "Cứ đi tiếp đến garage gần nhất.")
    try:
        reply = answer("bmw-m2", "Tôi lái tiếp được không?", "vi")
    finally:
        driver_registry.clear()
    assert reply == fallback_reply("Tôi lái tiếp được không?", {"must_stop": True}, "vi")
    assert "dừng" in reply.lower()


def test_a_reply_that_claims_control_is_replaced() -> None:
    brief = {"must_stop": False}
    assert guard_reply("Tôi sẽ phanh giúp bạn.", brief, "vi", "Phanh đi") == fallback_reply("Phanh đi", brief, "vi")
    kept = guard_reply("Nước làm mát đang cao hơn mức cảnh báo. Hãy giảm tải.", brief, "vi", "Sao rồi?")
    assert kept.startswith("Nước làm mát")


def test_wake_phrase_is_removed_and_the_question_is_stored(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    assert strip_wake("Hey neuron, xe đang sao?") == "xe đang sao?"
    assert strip_wake("hey neuron") == ""

    def explode(*_args, **_kwargs):
        raise AssertionError("a typed wake question must not call Blaze")

    monkeypatch.setattr("talk.transcribe", explode)
    response = _app().post(
        "/api/voice/talk",
        data={"sessionId": "bmw-m2", "lang": "vi", "text": "Hey neuron, nước làm mát thế nào?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "nước làm mát thế nào?"
    document = json.loads((tmp_path / "bmw-m2.json").read_text(encoding="utf-8"))
    assert document["turns"][0]["source"] == "wake"
    assert document["turns"][0]["text"] == "nước làm mát thế nào?"
    assert document["turns"][1]["role"] == "agent"


def test_talk_rejects_an_empty_clip(monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    response = _app().post(
        "/api/voice/talk",
        data={"sessionId": "bmw-m2"},
        files={"file": ("speech.webm", b"", "audio/webm")},
    )
    assert response.status_code == 400
