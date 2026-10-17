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


def test_voice_job_timings_are_logged_and_private(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    monkeypatch.setattr(BlazeTTS, "synthesize", lambda self, text: Speech(text, b"ID3fake", "audio/mpeg", "job"))
    with caplog.at_level("INFO", logger="car_neuron.voice"):
        voice._queued_speak("Private test sentence.", "normal", "private-test-key", voice.time.monotonic() - 0.01, "timings-car", "en", False)
    clip = voice.clips_for("timings-car")[-1]
    assert not any(key.startswith("_") for key in clip)
    assert voice._clips[-1]["_queue_wait_ms"] >= 10
    assert "voice job key=" in caplog.text and "synth_ms=" in caplog.text
    assert "private-test-key" not in caplog.text and "Private test sentence" not in caplog.text


def test_paid_latency_script_refuses_without_opt_in(monkeypatch, capsys):
    from scripts.tts_latency import main
    monkeypatch.delenv("CAR_NEURON_ALLOW_PAID_TTS", raising=False)
    assert main([]) == 2
    assert "Refusing paid TTS" in capsys.readouterr().out


@pytest.mark.parametrize("status", [429, 502, 503, 504, "timeout", "connect"])
def test_creation_is_retried_once_only(monkeypatch, status):
    calls, waits = [], []
    def handler(request):
        calls.append(request.method)
        if len(calls) == 1:
            if status == "timeout": raise httpx.ConnectTimeout("fixture")
            if status == "connect": raise httpx.ConnectError("fixture")
            return httpx.Response(status)
        return httpx.Response(200, content=b"ID3fixture", headers={"content-type": "audio/mpeg"})
    monkeypatch.setattr(voice.time, "sleep", waits.append)
    assert _client(handler).synthesize("Test.").audio.startswith(b"ID3")
    assert calls == ["POST", "POST"] and waits == [0.4]


@pytest.mark.parametrize("error", [httpx.ReadTimeout("fixture"), httpx.WriteTimeout("fixture")])
def test_a_read_or_write_timeout_is_not_retried_because_the_job_may_exist(monkeypatch, error):
    calls = []
    monkeypatch.setattr(voice.time, "sleep", lambda _: pytest.fail("unexpected retry"))
    def handler(request):
        calls.append(request.method)
        raise error
    with pytest.raises(httpx.TimeoutException): _client(handler).synthesize("Test.")
    assert calls == ["POST"]


@pytest.mark.parametrize("status", [400, 401, 403, 500])
def test_creation_does_not_retry_permanent_or_unlisted_error(monkeypatch, status):
    calls = []
    monkeypatch.setattr(voice.time, "sleep", lambda _: pytest.fail("unexpected retry"))
    def handler(request):
        calls.append(request.method)
        return httpx.Response(status)
    with pytest.raises(BlazeError): _client(handler).synthesize("Test.")
    assert calls == ["POST"]


def test_polling_failure_never_creates_a_second_job(monkeypatch):
    methods = []
    def handler(request):
        methods.append(request.method)
        if request.method == "POST": return httpx.Response(202, json={"id": "known"})
        return httpx.Response(200, json={"status": "failed"})
    with pytest.raises(BlazeError): _client(handler).synthesize("Test.")
    assert methods.count("POST") == 1


def test_creation_503_twice_degrades_without_raising_from_announce(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request.method)
        return httpx.Response(503)
    class Inline:
        def submit(self, fn, *args): fn(*args)
    monkeypatch.setattr(voice, "_configured", lambda _: True)
    monkeypatch.setattr(voice, "_pool", lambda: Inline())
    monkeypatch.setattr(voice, "_client_from_env", lambda _: _client(handler))
    monkeypatch.setattr(voice.time, "sleep", lambda _: None)
    voice.announce_alert("Fixture.", severity="warning", dedupe_key="failed-create", session_id="failed-create-car")
    assert calls == ["POST", "POST"]
    assert "failed-create" not in voice._spoken
    assert not voice.clips_for("failed-create-car")


@pytest.mark.parametrize("blocked", [0, 1])
def test_parallel_parts_publish_in_order_without_waiting_for_all(monkeypatch, tmp_path, blocked):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    release, fast, first_published = threading.Event(), threading.Event(), threading.Event()
    registered = []
    class Client:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def synthesize(self, text):
            if text == f"part{blocked}": assert release.wait(3)
            else: fast.set()
            return Speech(text, b"ID3fake", "audio/mpeg", text)
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    monkeypatch.setattr(voice, "_client_from_env", lambda _: Client())
    monkeypatch.setattr(voice, "_tts_parts", lambda _: ["part0", "part1", "part2"])
    def register(*args, **kwargs):
        registered.append(args[2])
        if args[2] == "part0": first_published.set()
    monkeypatch.setattr(voice, "_register", register)
    with ThreadPoolExecutor(1) as pool:
        job = pool.submit(voice._speak, "script", "normal", "parts", None, "en", False)
        try:
            assert fast.wait(2)
            if blocked == 0: assert registered == []
            else: assert first_published.wait(2)
        finally:
            release.set()
        job.result(timeout=3)
    assert registered == ["part0", "part1", "part2"]


@pytest.mark.parametrize("failure", ["cancel", "error"])
def test_later_parts_do_not_publish_after_cancel_or_failed_middle_part(monkeypatch, tmp_path, failure):
    registered = []
    live = [True]
    class Client:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def synthesize(self, text):
            if text == "part1" and failure == "error": raise BlazeError("fixture")
            return Speech(text, b"ID3fake", "audio/mpeg", text)
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    monkeypatch.setattr(voice, "_client_from_env", lambda _: Client())
    monkeypatch.setattr(voice, "_tts_parts", lambda _: ["part0", "part1", "part2"])
    def register(*args, **kwargs):
        registered.append(args[2])
        if failure == "cancel": live[0] = False
    monkeypatch.setattr(voice, "_register", register)
    voice._spoken["parts"] = float("inf")
    voice._speak("script", "normal", "parts", None, "en", False, lambda: live[0])
    assert registered == ["part0"]
    if failure == "error": assert "parts" not in voice._spoken


def test_alert_lane_starts_while_three_talk_parts_are_blocked(monkeypatch, tmp_path):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    release, talks_started, alert_started = threading.Event(), threading.Event(), threading.Event()
    lock = threading.Lock()
    active, maximum = [0], [0]
    class Client:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def synthesize(self, text):
            with lock:
                active[0] += 1; maximum[0] = max(maximum[0], active[0])
                if active[0] == 3: talks_started.set()
            try:
                if text.startswith("talk"): assert release.wait(3)
                else: alert_started.set()
                return Speech(text, b"ID3fake", "audio/mpeg", "same-id")
            finally:
                with lock: active[0] -= 1
    with ThreadPoolExecutor(2) as alert, ThreadPoolExecutor(2) as talk, ThreadPoolExecutor(3) as alert_parts, ThreadPoolExecutor(3) as talk_parts:
        monkeypatch.setattr(voice, "_executor", alert)
        monkeypatch.setattr(voice, "_talk_executor", talk)
        monkeypatch.setattr(voice, "_part_executors", {False: alert_parts, True: talk_parts})
        monkeypatch.setattr(voice, "_client_from_env", lambda _: Client())
        monkeypatch.setattr(voice, "_configured", lambda _: True)
        monkeypatch.setattr(voice, "_tts_parts", lambda script: script.split("|"))
        monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
        try:
            assert voice.speak_line("talk0|talk1|talk2", session_id="lanes")
            assert talks_started.wait(2)
            voice.announce_alert("An alert.", severity="critical", dedupe_key="lane-alert")
            assert alert_started.wait(2), "alert must not queue behind the blocked talk"
            assert maximum[0] == 4
        finally:
            release.set()


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
        spoken.append(text)
        return Speech(text=text, audio=b"ID3file", content_type="audio/mpeg", job_id=f"job-{len(spoken)}")

    monkeypatch.setattr(BlazeTTS, "synthesize", synthesize)
    voice._speak(script, "warning", "long-options", session_id="long-options", remember=False)
    assert sorted(spoken) == sorted(voice.spoken_form(part) for part in parts)  # what is read: no bracketed label
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
    monkeypatch.setattr(voice, "_speak", lambda script, severity, key, session_id=None, lang="vi", *args: spoken.append((script, severity)))
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


def test_a_drowsy_driver_hears_the_garages_only_as_choices_after_rest() -> None:
    trace = _garage_trace()
    vi = tool_options_line(trace, rest=True)
    assert vi.startswith("Quanh bạn có 3 garage") and "chỉ sau khi bạn đã dừng, nghỉ và tỉnh táo" in vi
    assert "Bạn muốn chọn" not in vi, "no invitation to pick a garage and drive on"
    en = tool_options_line(trace, "en", rest=True)
    assert "only after you have stopped, rested and feel alert" in en and "You can choose" not in en
    assert tool_options_line([], rest=True) == ""


def test_the_same_garages_at_slightly_different_distances_are_the_same_alert() -> None:
    near = "Quanh bạn có 3 garage: Garage A cách 0,8 kilômét, Garage B cách 1,3 kilômét."
    drifted = "Quanh bạn có 3 garage: Garage A cách 1,0 kilômét, Garage B cách 1,4 kilômét."
    other = "Quanh bạn có 3 garage: Garage A cách 0,8 kilômét, Garage C cách 1,3 kilômét."
    key = voice.alert_dedupe_key("bmw-m2", "warning", "vi", near)
    assert key == voice.alert_dedupe_key("bmw-m2", "warning", "vi", drifted)
    assert key != voice.alert_dedupe_key("bmw-m2", "warning", "vi", other)


def test_an_alert_is_quiet_for_45_seconds_then_spoken_again_and_a_normal_reading_ends_the_episode(monkeypatch) -> None:
    voice.clear_alert_history("once-car")
    now = voice.time.monotonic()
    clock = {"t": now}
    monkeypatch.setattr(voice.time, "monotonic", lambda: clock["t"])
    assert voice._claim("once-car:warning:vi", once=True)
    clock["t"] = now + 30
    assert not voice._claim("once-car:warning:vi", once=True), "30 s after the first: still the same alert"
    clock["t"] = now + 46
    assert voice._claim("once-car:warning:vi", once=True), "45 s after the first it is spoken again"
    voice.clear_alert_history("once-car")  # a normal assessment ends the episode
    assert voice._claim("once-car:warning:vi", once=True)
    voice.clear_alert_history("once-car")


def test_with_a_repeat_of_zero_an_alert_is_spoken_once_per_episode(monkeypatch) -> None:
    monkeypatch.setenv("ALERT_REPEAT_SECONDS", "0")
    voice.clear_alert_history("zero-car")
    assert voice._claim("zero-car:warning:vi", once=True)
    later = voice.time.monotonic() + 3600
    monkeypatch.setattr(voice.time, "monotonic", lambda: later)
    assert not voice._claim("zero-car:warning:vi", once=True)
    voice.clear_alert_history("zero-car")


def test_after_the_fast_rule_line_only_the_plan_is_added(monkeypatch) -> None:
    queued = []

    class _Inline:
        def submit(self, fn, *args):
            queued.append(args[0])

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    voice.clear_alert_history("fast-car")
    voice.speak_car_fast("fast-car", "critical", "vi", "Nước làm mát 121°C, vượt ngưỡng nguy hiểm. Chi tiết dài.", "Dừng xe ở vị trí an toàn.")
    assert queued == ["Cảnh báo nguy hiểm. Động cơ quá nhiệt. Dừng xe ở vị trí an toàn."]
    result = {"assessment": {"severity": "critical"}, "plan": {"code": "stop_and_get_help", "spoken": "Đừng tự lái xe đến garage."}}
    voice.speak_car_result("fast-car", "critical", "vi", result, "Chẩn đoán dài của agent.", ["Dừng xe."])
    assert queued[1] == "Đừng tự lái xe đến garage.", "no second lead, no repeated diagnosis"
    voice.speak_car_result("fast-car", "critical", "vi", result, "Chẩn đoán dài của agent.", ["Dừng xe."])
    assert len(queued) == 2, "once per episode"
    voice.clear_alert_history("fast-car")
    voice.speak_car_fast("fast-car", "warning", "vi", "Theo các luật kiểm tra: nước làm mát 109.7°C, vượt ngưỡng cảnh báo 105°C.", None)
    assert queued[2] == "Cảnh báo. Động cơ đang nóng."
    assert voice.spoken_form("Nước làm mát 109.7°C, vượt ngưỡng.") == "Nước làm mát 109,7 độ C, vượt ngưỡng."
    voice.clear_alert_history("fast-car")


def test_a_changed_plan_is_spoken_but_the_level_is_not_repeated(monkeypatch) -> None:
    queued = []

    class _Inline:
        def submit(self, fn, *args):
            queued.append(args[0])

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    voice.clear_alert_history("plan-car")
    garage = {"assessment": {"severity": "warning"}, "plan": {"code": "garage_when_convenient", "spoken": "Garage gần nhất là A."}}
    rest = {"assessment": {"severity": "warning"}, "plan": {"code": "rest_then_decide", "spoken": "Hãy nghỉ trước."}}
    voice.speak_car_result("plan-car", "warning", "vi", garage, "Nhiệt độ cao. Chi tiết.", ["Giảm tải."])
    voice.speak_car_result("plan-car", "warning", "vi", garage, "Nhiệt độ cao. Chi tiết.", ["Giảm tải."])
    voice.speak_car_result("plan-car", "warning", "vi", rest, "Nhiệt độ cao. Chi tiết.", ["Giảm tải."])
    assert queued == ["Cảnh báo. Nhiệt độ cao. Garage gần nhất là A.", "Hãy nghỉ trước."]
    voice.clear_alert_history("plan-car")


def test_the_rule_line_stays_quiet_when_the_agent_announced_the_level_first(monkeypatch) -> None:
    queued = []

    class _Inline:
        def submit(self, fn, *args):
            queued.append(args[0])

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    voice.clear_alert_history("agent-first")
    result = {"assessment": {"severity": "critical"}, "plan": {"code": "stop_and_get_help", "spoken": "Đừng tự lái xe."}}
    voice.speak_car_result("agent-first", "critical", "vi", result, "Nước làm mát quá nóng.", ["Dừng xe."])
    voice.speak_car_fast("agent-first", "critical", "vi", "Nước làm mát 122°C.", "Dừng xe.")
    assert len(queued) == 1, "one 'critical warning', not two"
    voice.clear_alert_history("agent-first")


def test_an_alert_made_only_of_figures_still_speaks() -> None:
    assert alert_script("Nước làm mát 109.7°C.", "warning") == "Cảnh báo. Xem chi tiết trên màn hình."
    assert alert_script("Battery 9.8 V.", "critical", lang="en") == "Critical warning. See the screen for details."
    assert alert_script("Battery 9.8 V.", "warning", ["Check the battery."], "en") == "Warning. Check the battery."
    with pytest.raises(ValueError):
        alert_script("  ", "warning")


def test_a_spoken_alert_is_short_and_the_same_for_every_reading() -> None:
    """The cache needs the same words for 106.0, 106.5 and 107.2 °C, and a driver needs them to be few."""
    from voice import fast_alert_line
    lines = {
        alert_script(fast_alert_line(f"Theo các luật kiểm tra: nước làm mát {c}°C, vượt ngưỡng cảnh báo 105°C.", "vi"), "warning",
                     ["Giảm tải động cơ và theo dõi nhiệt độ; nếu tiếp tục tăng, dừng xe ở nơi an toàn và để máy nguội."], "vi")
        for c in ("106.0", "106.5", "107.2")
    }
    assert lines == {"Cảnh báo. Động cơ đang nóng. Giảm tải động cơ và theo dõi nhiệt độ."}
    drowsy = {
        alert_script(f"Xe đang chạy {speed} km/h, nhiệt độ động cơ đang ở mức cảnh báo ({c}°C) nhưng chưa phải dừng khẩn cấp và người lái có dấu hiệu mất tỉnh táo. Không nên tiếp tục hành trình đến garage ở xa.",
                     "critical", ["Dừng tại vị trí an toàn gần nhất để nghỉ; không tiếp tục đến garage ở xa."], "vi")
        for speed in (60, 65) for c in (106, 107)
    }
    assert drowsy == {"Cảnh báo nguy hiểm. Bạn có dấu hiệu mất tỉnh táo. Dừng tại vị trí an toàn gần nhất để nghỉ."}
    assert all(len(line) < 110 for line in lines | drowsy)
    english = alert_script("The car is moving at 65 km/h, the engine temperature is at warning level (107°C) but not yet an emergency stop, and the driver shows signs of low alertness.",
                           "critical", ["Stop at the nearest safe place to rest."], "en")
    assert english == "Critical warning. You show signs of low alertness. Stop at the nearest safe place to rest."


def test_a_critical_engine_wins_over_the_driver_and_a_plan_speaks_one_sentence(monkeypatch) -> None:
    assert alert_script("Severe engine overheating (122°C). This is mandatory, whatever the driver's state.", "critical",
                        ["Stop at a safe place."], "en") == "Critical warning. Engine overheating. Stop at a safe place."
    queued = []

    class _Inline:
        def submit(self, fn, *args):
            queued.append(args[0])

    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "voice-1")
    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    voice.clear_alert_history("brief-plan")
    long_plan = "Hãy nghỉ trước. Nghỉ xong mà thấy tỉnh táo thì lái chậm đến Garage A, cách 1 kilômét. Nếu vẫn mệt, hãy nhờ người đến đón."
    result = {"assessment": {"severity": "critical"}, "plan": {"code": "rest_then_decide", "spoken": long_plan}}
    voice.speak_car_fast("brief-plan", "critical", "vi", "Nước làm mát đã tới 122.0°C, chạm ngưỡng nguy hiểm 120°C.", "Dừng xe.")
    voice.speak_car_result("brief-plan", "critical", "vi", result, "x", ["Dừng xe."])
    assert queued == ["Cảnh báo nguy hiểm. Động cơ quá nhiệt. Dừng xe.", "Hãy nghỉ trước."]
    voice.clear_alert_history("brief-plan")


def test_english_can_be_read_slower_than_vietnamese(monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_API_TOKEN", "t")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "v")
    monkeypatch.delenv("BLAZE_AUDIO_SPEED", raising=False)
    monkeypatch.setenv("BLAZE_AUDIO_SPEED_EN", "1.15")
    assert voice._client_from_env("en").audio_speed == 1.15
    assert voice._client_from_env("vi").audio_speed == 1.5, "Vietnamese keeps the fast default"
    monkeypatch.setenv("BLAZE_AUDIO_SPEED", "1.3")
    assert voice._client_from_env("vi").audio_speed == 1.3
    assert voice._client_from_env("en").audio_speed == 1.15, "the English setting wins for English"
    monkeypatch.setenv("BLAZE_AUDIO_SPEED_EN", "")
    assert voice._client_from_env("en").audio_speed == 1.3, "blank: falls back to the shared speed"
    monkeypatch.setenv("BLAZE_AUDIO_SPEED_EN", "9")
    assert voice._client_from_env("en").audio_speed == 1.5
