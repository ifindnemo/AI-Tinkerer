"""Persistent voice reuse; all audio and clients are fixtures."""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest
import voice


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    monkeypatch.setenv("BLAZE_VOICE_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("BLAZE_VOICE_CACHE", "1")
    monkeypatch.setattr(voice, "_clips", deque(maxlen=50))
    monkeypatch.setattr(voice, "_cache_active", {})
    settings = dict(speaker_id="v1", language="vi", model="v2.0_pro", audio_speed=1.5, audio_format="mp3")
    calls = []
    class Client:
        def __init__(self): self.__dict__.update(settings)
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def synthesize(self, text):
            calls.append(text)
            return voice.Speech(text, b"ID3" + b"x" * 700, "audio/mpeg", f"job-{len(calls)}")
    monkeypatch.setattr(voice, "_client_from_env", lambda _: Client())
    def speak(text="A short line.", lang="vi"):
        voice._speak(text, "normal", "test-cache", "cache-car", lang, False)
    return tmp_path, settings, calls, speak, Client


def test_repeat_uses_same_persistent_file_without_provider_call(cache):
    root, _, calls, speak, _ = cache
    speak(); speak()
    assert len(calls) == 1
    assert len(list((root / "cache").glob("*.audio"))) == 1
    assert voice._clips[-1]["_path"] == voice._clips[-2]["_path"]
    assert voice._clips[-1]["_path"].read_bytes().startswith(b"ID3")


@pytest.mark.parametrize("field,value", [("speaker_id", "v2"), ("language", "en"), ("model", "other"), ("audio_speed", 1.0), ("audio_format", "wav")])
def test_every_voice_setting_is_part_of_identity(cache, field, value):
    _, settings, calls, speak, _ = cache
    speak(); settings[field] = value; speak()
    assert len(calls) == 2


def test_corrupt_cache_is_replaced_not_replayed(cache):
    _, _, calls, speak, _ = cache
    speak()
    path = voice._clips[-1]["_path"]
    voice._clips.clear()
    path.write_bytes(b"broken")
    speak()
    assert len(calls) == 2 and path.read_bytes().startswith(b"ID3")


def test_in_use_files_are_never_evicted_and_budget_can_skip_new_entry(cache, monkeypatch):
    root, _, _, speak, _ = cache
    monkeypatch.setenv("BLAZE_VOICE_CACHE_MAX_FILES", "1")
    speak("First."); first = voice._clips[-1]["_path"]
    speak("Second.")
    assert first.exists() and voice._clips[-1]["_path"].exists()
    assert len(list((root / "cache").glob("*.audio"))) == 1
    voice._clips.clear()
    speak("Third.")
    assert not first.exists()
    assert len(list((root / "cache").glob("*.audio"))) == 1


def test_kill_switch_skips_reads_and_writes(cache, monkeypatch):
    root, _, calls, speak, _ = cache
    monkeypatch.setenv("BLAZE_VOICE_CACHE", "0")
    speak(); speak()
    assert len(calls) == 2 and not (root / "cache").exists()


@pytest.mark.parametrize("data,mime", [(b"ID3tiny", "audio/mpeg"), (b"html" * 200, "audio/mpeg"), (b"ID3" + b"x" * 700, "application/json")])
def test_invalid_or_tiny_audio_is_not_cached(cache, monkeypatch, data, mime):
    root, _, calls, speak, Client = cache
    def synthesize(self, text):
        calls.append(text)
        return voice.Speech(text, data, mime, "invalid-fixture")
    monkeypatch.setattr(Client, "synthesize", synthesize)
    speak(); speak()
    assert len(calls) == 2 and not list((root / "cache").glob("*.audio"))


def test_cache_disk_failure_still_publishes_uncached_audio(cache, monkeypatch):
    _, _, calls, speak, _ = cache
    def fail(*args): raise OSError("fixture")
    monkeypatch.setattr(voice, "_atomic_bytes", fail)
    speak()
    assert len(calls) == 1 and voice._clips[-1]["_path"].exists()


def test_download_keeps_file_alive_until_response_finishes(cache, monkeypatch):
    import asyncio
    _, _, _, speak, _ = cache
    monkeypatch.setenv("BLAZE_VOICE_CACHE_MAX_FILES", "1")
    speak("First.")
    first = voice._clips[-1]
    response = voice.clip_audio(first["id"])
    voice._clips.clear()
    speak("Second.")
    assert first["_path"].exists()
    async def send(_message): pass
    async def receive(): return {"type": "http.request", "body": b""}
    asyncio.run(response({"type": "http", "method": "GET", "headers": []}, receive, send))
    assert first["_path"] not in voice._cache_active
    voice._clips.clear()
    speak("Third.")
    assert not first["_path"].exists()


def test_parallel_identical_requests_are_single_flight(cache):
    _, _, calls, _, Client = cache
    barrier = threading.Barrier(2)
    def prepare():
        barrier.wait(timeout=2)
        audio = voice._prepare_audio(Client(), "Same words.", "normal")
        try: return audio.path
        finally: audio.release()
    with ThreadPoolExecutor(2) as pool:
        jobs = [pool.submit(prepare) for _ in range(2)]
        assert jobs[0].result(timeout=3) == jobs[1].result(timeout=3)
    assert len(calls) == 1 and not voice._cache_active


def test_prewarm_dry_run_lists_rule_lines_without_synthesis(cache, monkeypatch, capsys):
    from scripts.prewarm_voice import main, demo_lines
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "v1")
    monkeypatch.setenv("COOLANT_WARN_C", "105")
    assert main(["--dry-run"]) == 0
    output = capsys.readouterr().out
    assert "vi warm: cache=miss" in output and "en drowsy: cache=miss" in output
    assert not cache[2]
    assert {lang for lang, _, _ in demo_lines()} == {"vi", "en"}
    monkeypatch.delenv("CAR_NEURON_ALLOW_PAID_TTS", raising=False)
    assert main([]) == 2


def test_fast_line_refactor_keeps_announce_arguments(monkeypatch):
    calls = []
    monkeypatch.setattr(voice, "_claimed", lambda _: False)
    monkeypatch.setattr(voice, "announce_alert", lambda text, **kw: calls.append((text, kw)))
    diagnosis = "Theo các luật kiểm tra: nước làm mát 106.0°C, vượt ngưỡng cảnh báo 105°C. More detail."
    voice.speak_car_fast("fixture-car", "warning", "vi", diagnosis, "Giảm tải.")
    assert calls[0][0] == voice.fast_alert_line(diagnosis) == "Động cơ đang nóng."
    assert calls[0][1]["recommendations"] == ["Giảm tải."]


def test_the_cache_survives_demo_sh_clearing_the_voice_folder(tmp_path, monkeypatch):
    """./demo.sh runs rm -rf backend/var/voice at every start; the default cache folder must sit beside it."""
    import shutil
    monkeypatch.delenv("BLAZE_VOICE_CACHE_DIR", raising=False)
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path / "voice"))
    assert voice._cache_dir() == tmp_path / "voice-cache"
    monkeypatch.setenv("BLAZE_VOICE_CACHE_DIR", str(tmp_path / "elsewhere"))
    assert voice._cache_dir() == tmp_path / "elsewhere"


@pytest.mark.parametrize("head", [b"ID3", b"\xff\xfb", b"\xff\xfa", b"\xff\xf3", b"\xff\xf2", b"\xff\xe3", b"RIFF", b"OggS", b"fLaC"])
def test_every_mp3_frame_sync_and_container_is_cacheable(head):
    assert voice._valid_cache_audio(head + b"x" * 700, "audio/mpeg")


def test_an_unknown_header_is_refused_with_a_log_line_not_silently(caplog):
    with caplog.at_level("INFO", logger="car_neuron.voice"):
        assert not voice._valid_cache_audio(b"\x00\x01\x02\x03" + b"x" * 700, "audio/mpeg")
    assert "voice cache skipped" in caplog.text and "00010203" in caplog.text
