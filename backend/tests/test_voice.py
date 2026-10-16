"""Blaze TTS for agent warnings. No live network: httpx.MockTransport stands in for api.blaze.vn."""

import json

import httpx
import pytest

import voice
from driver.registry import suggests_garage_trip
from voice import BlazeError, BlazeTTS, Speech, alert_script, announce_alert, tool_options_line


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
    assert alert_script("Cảnh báo. Nước làm mát quá nóng.", "critical").startswith("Cảnh báo nguy hiểm.")
    assert alert_script("Cảnh báo nguy hiểm. Nước làm mát ấm.", "warning").startswith("Cảnh báo. Nước")


def test_announce_skips_normal_and_missing_credentials(monkeypatch) -> None:
    queued: list[str] = []
    monkeypatch.setattr(voice, "_pool", lambda: None)
    monkeypatch.delenv("BLAZE_API_TOKEN", raising=False)
    monkeypatch.delenv("BLAZE_SPEAKER_ID", raising=False)

    announce_alert("Nóng.", severity="normal")
    announce_alert("Nóng.", severity="warning")
    assert queued == []
    assert voice._missing_logged is True


def _garage_trace() -> list[dict]:
    return [
        {
            "tool": "get_maintenance_history",
            "arguments": {},
            "result": {"records": [
                {"garage": "Garage Thành Phát"},
                {"garage": "Garage Minh Quân (đối tác quen)"},
                {"garage": "Garage Thành Phát"},
            ]},
        },
        {
            "tool": "search_nearby_garages",
            "arguments": {},
            "result": {"options": [
                {"name": "An Bình Auto", "distance_km": 1.2},
                {"name": "Thành Phát", "distance_km": 2.4},
                {"name": "Minh Quân", "distance_km": 1.8},
            ]},
        },
    ]


def test_spoken_options_use_only_the_tool_results() -> None:
    spoken = tool_options_line(_garage_trace(), "vi")
    assert "An Bình Auto cách 1,2 kilômét" in spoken
    assert "Minh Quân cách 1,8 kilômét" in spoken
    assert "Thành Phát cách 2,4 kilômét" in spoken
    assert "trung bình" in spoken and "1,8 kilômét" in spoken
    assert "Garage Minh Quân (đối tác quen)" in spoken
    assert not suggests_garage_trip(spoken)

    held = tool_options_line(_garage_trace(), "vi", hold=True)
    assert "sau khi bạn đã dừng" in held
    assert "Garage Minh Quân (đối tác quen)" in held
    assert "Bạn muốn chọn" not in held
    assert not suggests_garage_trip(held)

    english = tool_options_line(_garage_trace(), "en")
    assert "An Bình Auto, 1.2 kilometres away" in english
    assert "average distance is about 1.8 kilometres" in english
    assert "usual garage" in english
    assert not suggests_garage_trip(english)
    assert tool_options_line([{"tool": "search_nearby_garages", "result": {"error": "no gps"}}]) == ""
    assert tool_options_line([]) == ""


def test_alert_script_speaks_the_tool_options_after_the_step() -> None:
    spoken = alert_script(
        "Nhiệt độ nước làm mát cao.",
        "warning",
        ["Giảm tải và theo dõi."],
        options=tool_options_line(_garage_trace()),
    )
    assert spoken.startswith("Cảnh báo. Nhiệt độ nước làm mát cao. Giảm tải và theo dõi.")
    assert "An Bình Auto cách 1,2 kilômét" in spoken
    assert spoken.index("Giảm tải") < spoken.index("An Bình Auto")


def test_long_options_are_split_without_losing_the_final_choice(monkeypatch, tmp_path) -> None:
    trace = _garage_trace()
    for index, garage in enumerate(trace[1]["result"]["options"]):
        garage["name"] = f"Garage {index} " + "Trung tâm bảo dưỡng " * 7
    script = alert_script("Nhiệt độ nước làm mát cao.", "warning", ["Giảm tải và theo dõi."],
                          options=tool_options_line(trace))
    parts = voice._tts_parts(script)
    assert len(parts) > 1
    assert len(parts[0]) <= voice._FIRST_PART_CHARS
    assert all(len(part) <= voice._MAX_CHARS for part in parts)
    assert " ".join(parts) == script
    assert "Bạn muốn chọn" in parts[-1]

    spoken: list[str] = []
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))

    def synthesize(self, text: str) -> Speech:
        if spoken:
            assert [clip["text"] for clip in voice.clips_for("long-options")] == spoken
        spoken.append(text)
        return Speech(text=text, audio=b"ID3file", content_type="audio/mpeg", job_id=f"job-{len(spoken)}")

    monkeypatch.setattr(BlazeTTS, "synthesize", synthesize)
    voice._speak(script, "warning", "long-options", session_id="long-options", remember=False)
    assert spoken == parts
    assert " ".join(clip["text"] for clip in voice.clips_for("long-options")) == script
    assert {clip["group"] for clip in voice.clips_for("long-options")} == {"long-options"}


def test_familiar_garage_falls_back_to_the_most_frequent_name() -> None:
    trace = _garage_trace()
    trace[0]["result"]["records"][1]["garage"] = "Garage khác"
    assert "garage quen thuộc Garage Thành Phát" in tool_options_line(trace)


def test_announce_speaks_a_warning_once(monkeypatch) -> None:
    spoken: list[tuple[str, str]] = []

    class _Inline:
        def submit(self, fn, *args):
            fn(*args)

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_speak", lambda script, severity, key, session_id=None, lang="vi": spoken.append((script, severity)))
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())

    announce_alert("Nhiệt độ nước làm mát cao.", severity="warning", recommendations=["Giảm tải."])
    announce_alert("Nhiệt độ nước làm mát cao.", severity="warning", recommendations=["Giảm tải."])

    assert spoken == [("Cảnh báo. Nhiệt độ nước làm mát cao. Giảm tải.", "warning")]


def test_normal_result_allows_the_same_warning_in_a_new_episode(monkeypatch) -> None:
    scripts = []
    class _Inline:
        def submit(self, fn, *args):
            fn(*args)
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    monkeypatch.setattr(voice, "_speak", lambda script, *args: scripts.append(script))
    key = voice.alert_dedupe_key("bmw-m2", "warning", "vi", "")
    announce_alert("Nước làm mát nóng.", severity="warning", dedupe_key=key, session_id="bmw-m2")
    announce_alert("Nước làm mát nóng.", severity="warning", dedupe_key=key, session_id="bmw-m2")
    assert len(scripts) == 1
    voice.clear_alert_history("bmw-m2")
    announce_alert("Nước làm mát nóng.", severity="warning", dedupe_key=key, session_id="bmw-m2")
    assert len(scripts) == 2
    assert key != voice.alert_dedupe_key("bmw-m2", "warning", "vi", "Garage A cách 1 kilômét")


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


def test_download_answering_425_while_processing_is_polled_until_ready() -> None:
    """Blaze's real behaviour: no status route (404), /download says 425 until the audio exists."""
    import httpx

    calls = {"download": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(202, json={"id": "job-425", "message": "Request accepted for processing"})
        if request.url.path.endswith("/download"):
            calls["download"] += 1
            if calls["download"] < 3:
                return httpx.Response(425, json={"error": "Audio is still processing, please try a few seconds later"})
            return httpx.Response(200, content=b"ID3audio", headers={"Content-Type": "audio/mpeg"})
        return httpx.Response(404, json={"detail": "Not Found"})

    client = voice.BlazeTTS(token="t", speaker_id="s", client=httpx.Client(transport=httpx.MockTransport(handler)), poll_interval=0)
    speech = client.synthesize("Xin chào.")
    assert speech.audio == b"ID3audio" and calls["download"] == 3
