"""Blaze speech-to-text and the temporary JSON conversation file. No live network."""

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import voice
from stt import BlazeSTT, BlazeSttError, append_turn, load_conversation, router
from voice import Speech


def _client(handler) -> BlazeSTT:
    return BlazeSTT(
        token="test-token",
        timeout=2,
        poll_interval=0,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_transcribe_posts_the_audio_file() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/stt/execute"
        assert request.url.params["language"] == "vi"
        assert request.url.params["model"] == "stt-async-1.5"
        assert request.headers["authorization"] == "Bearer test-token"
        assert b'name="audio_file"' in request.content
        assert b"speech.wav" in request.content
        return httpx.Response(200, json={"result": {"data": {"transcription": "  Dừng xe giúp tôi.  "}}})

    assert _client(handler).transcribe(b"RIFF", filename="speech.wav", content_type="audio/wav") == "Dừng xe giúp tôi."


def test_transcribe_polls_an_async_job() -> None:
    polls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"id": "job-1", "status": "queued"})
        if request.url.path == "/v1/stt/job-1":
            polls["n"] += 1
            if polls["n"] == 1:
                return httpx.Response(200, json={"id": "job-1", "status": "processing"})
            return httpx.Response(200, json={"id": "job-1", "status": "completed", "result": {"data": {"transcription": "Đã nghe."}}})
        return httpx.Response(404)

    assert _client(handler).transcribe(b"RIFF", filename="speech.wav", content_type="audio/wav") == "Đã nghe."


def test_failed_transcription_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"id": "job-x", "status": "queued"})
        return httpx.Response(200, json={"id": "job-x", "status": "failed", "message": "audio is silent"})

    with pytest.raises(BlazeSttError, match="audio is silent"):
        _client(handler).transcribe(b"RIFF", filename="speech.wav", content_type="audio/wav")


def test_conversation_file_keeps_the_latest_turns(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    for index in range(105):
        append_turn("trip-1", role="driver", text=f"câu {index}", source="stt")
    document = json.loads((tmp_path / "trip-1.json").read_text(encoding="utf-8"))
    assert document["sessionId"] == "trip-1"
    assert len(document["turns"]) == 100
    assert document["turns"][0]["text"] == "câu 5"
    assert document["turns"][-1]["text"] == "câu 104"
    assert load_conversation("trip-1")["turns"][-1]["role"] == "driver"
    assert load_conversation("missing") == {"sessionId": "missing", "updatedAt": None, "turns": []}


def test_session_id_cannot_escape_the_conversation_directory(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    append_turn("../secret", role="driver", text="xin chào", source="stt")
    assert (tmp_path / "secret.json").is_file()
    assert list(tmp_path.rglob("*.json")) == [tmp_path / "secret.json"]


def test_listen_appends_the_transcript(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setattr("stt.transcribe", lambda audio, filename, content_type: "Dừng xe giúp tôi.")
    app = FastAPI()
    app.include_router(router, prefix="/api")
    client = TestClient(app)

    response = client.post(
        "/api/voice/listen",
        data={"sessionId": "trip-1"},
        files={"file": ("speech.wav", b"RIFFaudio", "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Dừng xe giúp tôi."
    assert body["turn"]["role"] == "driver"
    assert body["turn"]["source"] == "stt"
    saved = json.loads((tmp_path / "trip-1.json").read_text(encoding="utf-8"))
    assert saved["turns"][0]["text"] == "Dừng xe giúp tôi."
    listed = client.get("/api/voice/conversation/trip-1")
    assert listed.status_code == 200
    assert listed.json()["turns"][0]["id"] == body["turn"]["id"]


def test_listen_rejects_an_empty_clip(monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    app = FastAPI()
    app.include_router(router, prefix="/api")
    response = TestClient(app).post(
        "/api/voice/listen",
        files={"file": ("speech.wav", b"", "audio/wav")},
    )
    assert response.status_code == 400


def test_spoken_alert_joins_the_same_conversation(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path / "audio"))

    def synthesize(self, text: str) -> Speech:
        return Speech(text=text, audio=b"ID3file", content_type="audio/mpeg", job_id="job1")

    monkeypatch.setattr(voice.BlazeTTS, "synthesize", synthesize)
    append_turn("trip-1", role="driver", text="Nghe rõ không?", source="stt")
    voice._speak("Cảnh báo. Nước làm mát nóng.", "critical", "trip-1:critical", "trip-1")

    document = load_conversation("trip-1")
    assert [turn["role"] for turn in document["turns"]] == ["driver", "agent"]
    assert document["turns"][1]["source"] == "tts"
    assert document["turns"][1]["severity"] == "critical"
    assert document["turns"][1]["text"] == "Cảnh báo. Nước làm mát nóng."
