"""Blaze TTS for agent warnings. No live network: httpx.MockTransport stands in for api.blaze.vn."""

import json

import httpx
import pytest

import voice
from voice import BlazeError, BlazeTTS, Speech, alert_script, announce_alert


@pytest.fixture(autouse=True)
def _reset_voice_state():
    voice._spoken.clear()
    voice._missing_logged = False
    yield
    voice._spoken.clear()
    voice._missing_logged = False


def _client(handler) -> BlazeTTS:
    return BlazeTTS(
        token="test-token",
        speaker_id="voice-1",
        timeout=2,
        poll_interval=0,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_alert_script_states_the_severity_once() -> None:
    spoken = alert_script(
        "Nhiệt độ nước làm mát cao.",
        "critical",
        ["Dừng xe ở vị trí an toàn."],
    )
    assert spoken == "Cảnh báo nguy hiểm. Nhiệt độ nước làm mát cao. Dừng xe ở vị trí an toàn."
    assert alert_script("Cảnh báo. Đã hạ nhiệt.", "warning") == "Cảnh báo. Đã hạ nhiệt."


def test_announce_skips_normal_and_missing_credentials(monkeypatch) -> None:
    queued: list[str] = []
    monkeypatch.setattr(voice, "_pool", lambda: None)
    monkeypatch.delenv("BLAZE_API_TOKEN", raising=False)
    monkeypatch.delenv("BLAZE_SPEAKER_ID", raising=False)

    announce_alert("Nóng.", severity="normal")
    announce_alert("Nóng.", severity="warning")
    assert queued == []
    assert voice._missing_logged is True


def test_announce_speaks_a_warning_once(monkeypatch) -> None:
    spoken: list[tuple[str, str]] = []

    class _Inline:
        def submit(self, fn, *args):
            fn(*args)

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_speak", lambda script, severity, key, session_id=None: spoken.append((script, severity)))
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())

    announce_alert("Nhiệt độ nước làm mát cao.", severity="warning", recommendations=["Giảm tải."])
    announce_alert("Nhiệt độ nước làm mát cao.", severity="warning", recommendations=["Giảm tải."])

    assert spoken == [("Cảnh báo. Nhiệt độ nước làm mát cao. Giảm tải.", "warning")]


def test_synthesize_polls_then_downloads() -> None:
    seen: list[tuple[str, str]] = []
    polls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path))
        if request.method == "POST" and request.url.path == "/v1/tts":
            body = json.loads(request.content)
            assert body == {
                "query": "Cảnh báo. Nước làm mát nóng.",
                "language": "vi",
                "speaker_id": "voice-1",
                "model": "v2.0_flash",
                "audio_format": "mp3",
            }
            assert request.headers["authorization"] == "Bearer test-token"
            return httpx.Response(202, json={"id": "job-1", "status": "queued"})
        if request.method == "GET" and request.url.path == "/v1/tts/job-1":
            polls["n"] += 1
            status = "processing" if polls["n"] == 1 else "completed"
            return httpx.Response(200, json={"id": "job-1", "status": status})
        if request.method == "GET" and request.url.path == "/v1/tts/job-1/download":
            return httpx.Response(200, content=b"ID3fake-mp3", headers={"content-type": "audio/mpeg"})
        return httpx.Response(404)

    speech = _client(handler).synthesize("Cảnh báo. Nước làm mát nóng.")

    assert speech.audio == b"ID3fake-mp3"
    assert speech.content_type == "audio/mpeg"
    assert speech.job_id == "job-1"
    assert ("GET", "/v1/tts/job-1/download") in seen


def test_synthesize_follows_audio_url_without_the_api_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"id": "job-9", "status": "completed", "audio_url": "https://cdn.example/a.mp3"})
        assert request.url.host == "cdn.example"
        assert "authorization" not in request.headers
        return httpx.Response(200, content=b"ID3cdn", headers={"content-type": "audio/mpeg"})

    speech = _client(handler).synthesize("Cảnh báo.")
    assert speech.audio == b"ID3cdn"
    assert speech.job_id == "job-9"


def test_failed_job_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"id": "job-x", "status": "queued"})
        return httpx.Response(200, json={"id": "job-x", "status": "failed", "message": "speaker not found"})

    with pytest.raises(BlazeError, match="speaker not found"):
        _client(handler).synthesize("Cảnh báo.")


def test_speak_writes_the_audio_file(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))

    def synthesize(self, text: str) -> Speech:
        return Speech(text=text, audio=b"ID3file", content_type="audio/mpeg", job_id="job/1")

    monkeypatch.setattr(BlazeTTS, "synthesize", synthesize)
    voice._spoken["vehicle:warning"] = 10**12
    voice._speak("Cảnh báo. Nóng.", "warning", "vehicle:warning")

    written = list(tmp_path.iterdir())
    assert len(written) == 1
    assert written[0].name.endswith("-job1.mp3")
    assert written[0].read_bytes() == b"ID3file"
    assert voice._spoken["vehicle:warning"] == 10**12
