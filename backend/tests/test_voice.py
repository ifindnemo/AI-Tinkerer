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
            assert [clip["text"] for clip in voice.clips_for("long-options")] == parts[:len(spoken)]
        spoken.append(text)
        return Speech(text=text, audio=b"ID3file", content_type="audio/mpeg", job_id=f"job-{len(spoken)}")

    monkeypatch.setattr(BlazeTTS, "synthesize", synthesize)
    voice._speak(script, "warning", "long-options", session_id="long-options", remember=False)
    assert spoken == [voice.spoken_form(part) for part in parts]  # what is read: no bracketed label
    assert " ".join(clip["text"] for clip in voice.clips_for("long-options")) == script  # what is shown: all of it
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
                "model": "v2.0_pro",
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


def test_the_alert_voice_is_read_at_1_5_speed_by_default_and_the_speed_is_clamped(monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "t")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "v")
    monkeypatch.delenv("BLAZE_AUDIO_SPEED", raising=False)
    assert voice._client_from_env("vi").audio_speed == 1.5 and voice._client_from_env("vi").model == "v2.0_pro"
    for raw, expected in (("1.0", 1.0), ("9", 1.5), ("0.1", 0.5), ("fast", 1.5)):
        monkeypatch.setenv("BLAZE_AUDIO_SPEED", raw)
        assert voice._client_from_env("en").audio_speed == expected


def test_the_speed_is_sent_to_blaze() -> None:
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            sent.update(json.loads(request.content))
            return httpx.Response(200, content=b"ID3x", headers={"content-type": "audio/mpeg"})
        return httpx.Response(404)

    client = voice.BlazeTTS(token="t", speaker_id="v", audio_speed=1.3, client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.synthesize("Xin chào.")
    assert sent["audio_speed"] == 1.3 and sent["model"] == "v2.0_pro"


@pytest.mark.parametrize("text,lang,expected", [
    ("Nước làm mát 108°C.", "vi", "Nước làm mát 108 độ C."),
    ("Nhiệt độ 112,2 °C và 95℃", "vi", "Nhiệt độ 112,2 độ C và 95 độ C"),
    ("Coolant is 108°C.", "en", "Coolant is 108 degrees Celsius."),
    ("Không có nhiệt độ.", "vi", "Không có nhiệt độ."),
])
def test_the_degree_sign_is_read_as_words(text, lang, expected) -> None:
    assert voice.spoken_form(text, lang) == expected


def test_what_is_sent_to_blaze_says_do_c_but_the_clip_text_keeps_the_sign(monkeypatch, tmp_path) -> None:
    sent = []

    class Fake:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def synthesize(self, text):
            sent.append(text)
            return voice.Speech(text=text, audio=b"ID3x", content_type="audio/mpeg", job_id="j")

    monkeypatch.setattr(voice, "_client_from_env", lambda lang="vi": Fake())
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    voice._speak("Cảnh báo. Nước làm mát 108°C.", "warning", "k-degree", "s-degree", "vi")
    assert sent == ["Cảnh báo. Nước làm mát 108 độ C."]
    assert voice.clips_for("s-degree")[0]["text"] == "Cảnh báo. Nước làm mát 108°C."


def test_the_follow_up_names_the_proposed_booking_and_nothing_else() -> None:
    garages = [{"tool": "search_nearby_garages", "result": {"options": [{"name": "Garage Minh Khoa", "distance_km": 1.2}]}}]
    booking = {"id": "act_1", "status": "pending_confirmation", "payload": {"garage_id": "Garage Minh Khoa"}}
    warning = {"assessment": {"severity": "warning"}, "tool_trace": garages}
    assert voice.follow_up_for({**warning, "pending_action": booking}) == "Tôi đề xuất đặt lịch tại Garage Minh Khoa. Bạn xác nhận trên màn hình nhé."
    assert voice.follow_up_for({**warning, "pending_action": booking}, "en") == "I suggest booking at Garage Minh Khoa. Please confirm on the screen."
    assert voice.follow_up_for(warning) == "", "without a proposal the nearby garages are spoken by tool_options_line"
    assert voice.follow_up_for({"assessment": {"severity": "critical"}, "tool_trace": garages}) == "", "stopping safely comes first"
    assert voice.follow_up_for({"assessment": {"severity": "warning"}, "tool_trace": []}) == ""


def test_the_follow_up_is_spoken_after_the_alert(monkeypatch) -> None:
    queued = []

    class Inline:
        def submit(self, fn, *args):
            queued.append(args[0])

    monkeypatch.setenv("BLAZE_API_TOKEN", "t")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "v")
    monkeypatch.setattr(voice, "_pool", lambda: Inline())
    voice.announce_alert("Nước làm mát nóng.", severity="warning", dedupe_key="follow-up-1", follow_up="Garage gần nhất là A.")
    assert queued == ["Cảnh báo. Nước làm mát nóng. Garage gần nhất là A."]


def test_what_is_read_never_switches_language_mid_sentence() -> None:
    vi = voice.spoken_form("Tình trạng là critical: ECT/EOT cao trong batch, hard_safety_guardrail yêu cầu dừng. Garage Minh Quân (đối tác quen).", "vi")
    assert vi == "Tình trạng là nguy hiểm: nhiệt độ nước làm mát và dầu cao trong đợt dữ liệu, giới hạn an toàn bắt buộc yêu cầu dừng. Garage Minh Quân."
    assert voice.spoken_form("ECT reached 108°C (hard_safety_guardrail).", "en") == "coolant temperature reached 108 degrees Celsius."


def test_a_drowsy_driver_hears_rest_first_not_a_choice_of_garages() -> None:
    trace = _garage_trace()
    vi = tool_options_line(trace, rest=True)
    assert vi.startswith("Hãy nghỉ trước.") and "gọi cứu hộ" in vi and "Bạn muốn chọn" not in vi
    assert vi.count("cách") == 1, "only the nearest garage, as information"
    en = tool_options_line(trace, "en", rest=True)
    assert en.startswith("Rest first.") and "roadside assistance" in en and "You can choose" not in en
    assert tool_options_line([], rest=True) == ""


def test_the_same_garages_at_slightly_different_distances_are_the_same_alert() -> None:
    near = "Quanh bạn có 3 garage: Garage A cách 0,8 kilômét, Garage B cách 1,3 kilômét."
    drifted = "Quanh bạn có 3 garage: Garage A cách 1,0 kilômét, Garage B cách 1,4 kilômét."
    other = "Quanh bạn có 3 garage: Garage A cách 0,8 kilômét, Garage C cách 1,3 kilômét."
    key = voice.alert_dedupe_key("bmw-m2", "warning", "vi", near)
    assert key == voice.alert_dedupe_key("bmw-m2", "warning", "vi", drifted)
    assert key != voice.alert_dedupe_key("bmw-m2", "warning", "vi", other)


def test_an_alert_is_spoken_once_per_episode_not_every_ninety_seconds(monkeypatch) -> None:
    voice.clear_alert_history("once-car")
    assert voice._claim("once-car:warning:vi", once=True)
    later = voice.time.monotonic() + 3600
    monkeypatch.setattr(voice.time, "monotonic", lambda: later)
    assert not voice._claim("once-car:warning:vi", once=True), "an hour later it is still the same episode"
    voice.clear_alert_history("once-car")  # a normal assessment ends the episode
    assert voice._claim("once-car:warning:vi", once=True)
    voice.clear_alert_history("once-car")
