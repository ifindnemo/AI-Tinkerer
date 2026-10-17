"""Spoken conversation: Blaze transcript in, one reply, both turns in the session JSON. No live network."""

import json
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient

from driver.registry import driver_registry
from situation import clear_situations, remember_vehicle_situation
from talk import answer, cancel_through, claim_turn, clear_turns, fallback_reply, guard_reply, router, strip_wake, turn_current


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
    response = _post(_app(), session="talk-rules-vi")

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Xe đang sao rồi?"
    assert body["spoken"] is False
    assert "chỉ tư vấn" in body["reply"]
    assert called["model"] is False
    document = json.loads((tmp_path / "talk-rules-vi.json").read_text(encoding="utf-8"))
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
    response = _post(_app(), lang="en", session="talk-rules-en")
    assert response.status_code == 200
    assert seen["language"] == "en"
    assert "fresh reading" in response.json()["reply"]


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


def test_transcribe_first_then_talk_with_the_text_stores_one_stt_turn(tmp_path, monkeypatch) -> None:
    """The page shows the question as soon as it is transcribed, then asks for the answer."""
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    seen = []
    monkeypatch.setattr("talk.transcribe", lambda audio, filename, content_type, language=None: seen.append(language) or "Hey neuron là gì?")
    client = _app()
    heard = client.post("/api/voice/transcribe", data={"lang": "en"}, files={"file": ("speech.webm", b"RIFFaudio", "audio/webm")})
    assert heard.status_code == 200 and heard.json() == {"text": "Hey neuron là gì?"} and seen == ["en"]
    assert not list(tmp_path.glob("*.json")), "transcribing alone stores nothing"
    reply = client.post("/api/voice/talk", data={"sessionId": "talk-two-step", "lang": "vi", "text": "Hey neuron là gì?", "transcribed": "true"})
    assert reply.status_code == 200 and reply.json()["text"] == "Hey neuron là gì?", "a transcript is not stripped like a wake phrase"
    document = json.loads((tmp_path / "talk-two-step.json").read_text(encoding="utf-8"))
    assert [(turn["role"], turn["source"]) for turn in document["turns"]] == [("driver", "stt"), ("agent", "reply")]


def test_a_newer_turn_drops_the_older_reply(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "openai")
    clear_turns()
    clear_situations()
    remember_vehicle_situation("order-car", {"severity": "warning", "diagnosis": "The coolant is high."}, [], None)
    started = threading.Event()
    release = threading.Event()
    spoken: list[str] = []

    def model(session_id, lang, brief):
        if not started.is_set():
            started.set()
            assert release.wait(3)
            return "Keep driving to the garage now."
        return "The coolant is high. Ease off and watch it."

    monkeypatch.setattr("talk._model_reply", model)
    monkeypatch.setattr("talk.speak_line", lambda text, **kwargs: spoken.append(text) or False)
    client = _app()

    def older() -> None:
        client.post(
            "/api/voice/talk",
            data={
                "sessionId": "order-car",
                "lang": "en",
                "text": "Can I keep driving?",
                "transcribed": "true",
                "conversationId": "conv-order",
                "turnId": "turn-old",
                "generation": "1",
            },
        )

    worker = threading.Thread(target=older)
    worker.start()
    assert started.wait(2)
    newer = client.post(
        "/api/voice/talk",
        data={
            "sessionId": "order-car",
            "lang": "en",
            "text": "What is wrong?",
            "transcribed": "true",
            "conversationId": "conv-order",
            "turnId": "turn-new",
            "generation": "2",
        },
    )
    release.set()
    worker.join(3)
    assert newer.status_code == 200
    assert "Ease off" in newer.json()["reply"]
    document = json.loads((tmp_path / "order-car.json").read_text(encoding="utf-8"))
    blob = " ".join(turn["text"] for turn in document["turns"])
    assert "Keep driving" not in blob
    assert not any("Keep driving" in line for line in spoken)
    clear_turns()


def test_cancel_before_the_reply_stores_no_assistant_line(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "openai")
    clear_turns()
    started = threading.Event()
    release = threading.Event()

    def model(*_args):
        started.set()
        assert release.wait(3)
        return "You can keep driving."

    monkeypatch.setattr("talk._model_reply", model)
    monkeypatch.setattr("talk.speak_line", lambda text, **kwargs: False)
    client = _app()

    def pending() -> None:
        client.post(
            "/api/voice/talk",
            data={
                "sessionId": "cancel-car",
                "lang": "en",
                "text": "Can I keep driving?",
                "transcribed": "true",
                "conversationId": "conv-cancel",
                "turnId": "turn-1",
                "generation": "4",
            },
        )

    worker = threading.Thread(target=pending)
    worker.start()
    assert started.wait(2)
    cancelled = client.post("/api/voice/talk/cancel", data={"sessionId": "cancel-car", "conversationId": "conv-cancel", "generation": "4"})
    assert cancelled.status_code == 200
    release.set()
    worker.join(3)
    document = json.loads((tmp_path / "cancel-car.json").read_text(encoding="utf-8"))
    assert [turn["role"] for turn in document["turns"]] == ["driver"]
    assert turn_current("conv-cancel", "turn-1", 4) is False
    clear_turns()


def test_the_same_turn_is_not_appended_twice(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    client = _app()
    payload = {
        "sessionId": "dedupe-car",
        "lang": "en",
        "text": "How is the car?",
        "transcribed": "true",
        "conversationId": "conv-dedupe",
        "turnId": "turn-9",
        "generation": "3",
    }
    first = client.post("/api/voice/talk", data=payload)
    second = client.post("/api/voice/talk", data=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["reply"] == second.json()["reply"]
    document = json.loads((tmp_path / "dedupe-car.json").read_text(encoding="utf-8"))
    assert [turn["role"] for turn in document["turns"]] == ["driver", "agent"]
    clear_turns()


def test_a_normal_snapshot_is_not_described_as_missing(monkeypatch) -> None:
    clear_situations()
    remember_vehicle_situation(
        "normal-car",
        {"severity": "normal", "diagnosis": "Coolant is 90 C and the engine is steady.", "recommendations": []},
        [{"tool": "search_nearby_garages", "result": {"options": [{"name": "Garage A", "distance_km": 1.2, "osm_url": "https://example.invalid/secret"}]}}],
        None,
    )
    reply = fallback_reply("How is the car now?", __import__("talk").situation("normal-car"), "en")
    assert "normal" in reply.lower()
    assert "90" in reply
    assert "fresh reading" not in reply.lower()
    garage = fallback_reply("Which garage is nearby?", __import__("talk").situation("normal-car"), "en")
    assert "Garage A" in garage and "1.2" in garage and "secret" not in garage
    clear_situations()


class _QueuedVoice:
    def __init__(self) -> None:
        self.jobs: list[tuple] = []

    def submit(self, fn, *args, **kwargs):
        self.jobs.append((fn, args, kwargs))

        class _Pending:
            def result(self, timeout=None):
                return None

        return _Pending()

    def drain(self) -> None:
        jobs = self.jobs
        self.jobs = []
        for fn, args, kwargs in jobs:
            fn(*args, **kwargs)


class _FakeTTS:
    def __init__(self, started=None, release=None) -> None:
        self.started = started
        self.release = release
        self.calls: list[str] = []

    def synthesize(self, text: str):
        from voice import Speech

        self.calls.append(text)
        if self.started is not None:
            self.started.set()
            assert self.release.wait(3)
        return Speech(text=text, audio=b"ID3fake-audio", content_type="audio/mpeg", job_id="job")

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None


def _install_voice(monkeypatch, tmp_path, client: _FakeTTS, pool: _QueuedVoice) -> None:
    import voice

    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path / "voice"))
    monkeypatch.setattr(voice, "_configured", lambda lang="vi": True)
    monkeypatch.setattr(voice, "_client_from_env", lambda lang="vi": client)
    monkeypatch.setattr(voice, "_talk_pool", lambda: pool)
    voice._clips.clear()


def _talk(client, **extra):
    data = {
        "sessionId": "voice-car",
        "lang": "en",
        "text": "Why are you warning me about the coolant temperature right now?",
        "transcribed": "true",
        "conversationId": "conv-voice",
        "turnId": "turn-voice",
        "generation": "1",
    }
    data.update(extra)
    return client.post("/api/voice/talk", data=data)


def test_a_queued_voice_is_published_after_the_http_reply_is_finished(tmp_path, monkeypatch) -> None:
    import voice
    from voice import clips_for

    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    pool = _QueuedVoice()
    fake = _FakeTTS()
    _install_voice(monkeypatch, tmp_path, fake, pool)
    response = _talk(_app())
    assert response.status_code == 200
    assert response.json()["audioQueued"] is True
    assert clips_for("voice-car") == []
    assert pool.jobs
    pool.drain()
    clips = clips_for("voice-car")
    assert len(clips) == 1
    assert clips[0]["group"] == "talk:conv-voice:turn-voice"
    assert fake.calls
    voice._clips.clear()
    clear_turns()


def test_cancel_before_the_voice_worker_runs_publishes_nothing(tmp_path, monkeypatch) -> None:
    import voice
    from talk import cancel_through
    from voice import clips_for

    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    pool = _QueuedVoice()
    fake = _FakeTTS()
    _install_voice(monkeypatch, tmp_path, fake, pool)
    assert _talk(_app()).status_code == 200
    cancel_through("voice-car:conv-voice", 1)
    pool.drain()
    assert clips_for("voice-car") == []
    assert fake.calls == []
    voice._clips.clear()
    clear_turns()


def test_cancel_during_synthesis_drops_the_clip(tmp_path, monkeypatch) -> None:
    import voice
    from talk import cancel_through
    from voice import clips_for

    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    started, release = threading.Event(), threading.Event()
    pool = _QueuedVoice()
    fake = _FakeTTS(started, release)
    _install_voice(monkeypatch, tmp_path, fake, pool)
    assert _talk(_app()).status_code == 200
    worker = threading.Thread(target=pool.drain)
    worker.start()
    assert started.wait(2)
    cancel_through("voice-car:conv-voice", 1)
    release.set()
    worker.join(3)
    assert clips_for("voice-car") == []
    voice._clips.clear()
    clear_turns()


def test_a_second_turn_drops_the_first_voice_job(tmp_path, monkeypatch) -> None:
    import voice
    from voice import clips_for

    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    pool = _QueuedVoice()
    _install_voice(monkeypatch, tmp_path, _FakeTTS(), pool)
    client = _app()
    assert _talk(client, text="First question about the coolant please").status_code == 200
    assert _talk(client, text="Second question about the battery please", turnId="turn-next", generation="2").status_code == 200
    pool.drain()
    groups = [clip["group"] for clip in clips_for("voice-car")]
    assert groups == ["talk:conv-voice:turn-next"]
    voice._clips.clear()
    clear_turns()


def test_retrying_a_finished_turn_does_not_queue_voice_again(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    pool = _QueuedVoice()
    _install_voice(monkeypatch, tmp_path, _FakeTTS(), pool)
    client = _app()
    first = _talk(client)
    second = _talk(client)
    assert first.status_code == second.status_code == 200
    assert first.json()["reply"] == second.json()["reply"]
    assert len(pool.jobs) == 1
    clear_turns()


def test_a_long_reply_publishes_every_part_in_order(tmp_path, monkeypatch) -> None:
    import voice
    from voice import clips_for

    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    monkeypatch.setenv("TALK_SPOKEN_SENTENCES", "0")  # this test is about several parts, so the reply is read in full
    clear_turns()
    long_reply = ("The coolant is above the warning line and the car should ease off now. " * 4).strip()
    monkeypatch.setattr("talk.fallback_reply", lambda heard, brief, lang: long_reply)
    pool = _QueuedVoice()
    _install_voice(monkeypatch, tmp_path, _FakeTTS(), pool)
    assert _talk(_app(), text="Tell me the full coolant warning and the next step in detail.").status_code == 200
    pool.drain()
    clips = clips_for("voice-car")
    assert len(clips) >= 2
    assert [clip["part_index"] for clip in clips] == list(range(len(clips)))
    assert clips[0]["part_count"] == len(clips)
    voice._clips.clear()
    clear_turns()


def test_two_sessions_do_not_share_a_conversation_id(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    monkeypatch.setattr("talk.speak_line", lambda *args, **kwargs: False)
    client = _app()
    shared = {"conversationId": "same-conv", "turnId": "same-turn", "generation": "1", "transcribed": "true", "lang": "en"}
    first = client.post("/api/voice/talk", data={"sessionId": "car-a", "text": "How is car A?", **shared})
    second = client.post("/api/voice/talk", data={"sessionId": "car-b", "text": "How is car B?", **shared})
    assert first.status_code == second.status_code == 200
    assert "car A" in first.json()["text"] and "car B" in second.json()["text"]
    assert first.json()["reply"] != second.json()["reply"] or first.json()["text"] != second.json()["text"]
    cancelled = client.post("/api/voice/talk/cancel", data={"sessionId": "car-a", "conversationId": "same-conv", "generation": "1"})
    assert cancelled.status_code == 200
    again = client.post("/api/voice/talk", data={"sessionId": "car-b", "text": "How is car B?", **shared})
    assert again.status_code == 200 and again.json()["stale"] is not True
    clear_turns()


def test_a_concurrent_retry_runs_the_model_once(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "openai")
    clear_turns()
    monkeypatch.setattr("talk.speak_line", lambda *args, **kwargs: False)
    started, release = threading.Event(), threading.Event()
    calls = {"n": 0}

    def model(*_args, **_kwargs):
        calls["n"] += 1
        started.set()
        assert release.wait(3)
        return "The coolant is high. Ease off."

    monkeypatch.setattr("talk._model_reply", model)
    client = _app()
    results: list[int] = []

    def post() -> None:
        response = _talk(client, sessionId="once-car", text="What is wrong with the coolant?")
        results.append(response.status_code)

    first = threading.Thread(target=post)
    first.start()
    assert started.wait(2)
    second = threading.Thread(target=post)
    second.start()
    second.join(2)
    release.set()
    first.join(3)
    assert sorted(results) == [200, 409]
    assert calls["n"] == 1
    clear_turns()


def test_an_old_cancel_does_not_drop_a_newer_generation(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "rules")
    clear_turns()
    monkeypatch.setattr("talk.speak_line", lambda *args, **kwargs: False)
    client = _app()
    assert _talk(client, sessionId="order-voice", text="First coolant question for the record.").status_code == 200
    assert _talk(client, sessionId="order-voice", text="Second coolant question for the record.", turnId="turn-2", generation="2").status_code == 200
    cancelled = client.post("/api/voice/talk/cancel", data={"sessionId": "order-voice", "conversationId": "conv-voice", "generation": "1"})
    assert cancelled.status_code == 200
    from talk import turn_current

    assert turn_current("order-voice:conv-voice", "turn-2", 2) is True
    clear_turns()


def test_must_stop_survives_a_keep_driving_question() -> None:
    brief = {"must_stop": True, "fresh": True, "garages": [{"name": "Garage A", "distance_km": 2.0}]}
    reply = guard_reply("Yes, keep driving to the garage.", brief, "en", "Can I keep driving?")
    assert "do not keep driving" in reply.lower() or "stop" in reply.lower()
    asked = fallback_reply("Can I drive to that garage now?", brief, "en")
    assert "do not drive there now" in asked.lower()
    assert claim_turn("unused", "t", 1) == "ok"
    cancel_through("unused", 1)
    assert claim_turn("unused", "t2", 1) == "stale"
    clear_turns()


def test_the_voice_reads_the_first_two_sentences_and_the_screen_keeps_all(monkeypatch) -> None:
    import talk

    monkeypatch.delenv("TALK_SPOKEN_SENTENCES", raising=False)
    reply = "Xe đang bình thường. Nước làm mát 90 độ. Tôi sẽ theo dõi tiếp. Bạn cứ hỏi nhé."
    assert talk.spoken_excerpt(reply) == "Xe đang bình thường. Nước làm mát 90 độ."
    assert talk.spoken_excerpt("Một câu duy nhất.") == "Một câu duy nhất."
    monkeypatch.setenv("TALK_SPOKEN_SENTENCES", "1")
    assert talk.spoken_excerpt(reply) == "Xe đang bình thường."
    monkeypatch.setenv("TALK_SPOKEN_SENTENCES", "0")
    assert talk.spoken_excerpt(reply) == reply
    monkeypatch.setenv("TALK_SPOKEN_SENTENCES", "abc")
    assert talk.spoken_excerpt(reply) == "Xe đang bình thường. Nước làm mát 90 độ.", "a bad value falls back to the default"


def test_a_stop_instruction_is_read_in_full(monkeypatch) -> None:
    import talk

    monkeypatch.delenv("TALK_SPOKEN_SENTENCES", raising=False)
    reply = "Nước làm mát rất cao. Garage gần nhất cách 1 km. Hãy dừng xe ở nơi an toàn ngay bây giờ. Tôi không điều khiển xe."
    assert talk.spoken_excerpt(reply) == reply
    english = "The engine is hot. A garage is near. Please stop somewhere safe now."
    assert talk.spoken_excerpt(english) == english


def test_only_the_spoken_part_is_shortened_not_the_stored_reply(monkeypatch) -> None:
    import talk

    sent = []
    monkeypatch.delenv("TALK_SPOKEN_SENTENCES", raising=False)
    monkeypatch.setattr(talk, "speak_line", lambda text, **kwargs: sent.append(text) or True)
    monkeypatch.setattr(talk, "answer", lambda *args, **kwargs: "Câu một. Câu hai. Câu ba.")
    monkeypatch.setattr(talk, "guard_reply", lambda text, *args, **kwargs: text)
    body = talk._reply("excerpt-car", "xe thế nào", "vi", "text")
    assert body["reply"] == "Câu một. Câu hai. Câu ba." and sent == ["Câu một. Câu hai."]
    assert "Câu ba." in body["answer"]["text"]
