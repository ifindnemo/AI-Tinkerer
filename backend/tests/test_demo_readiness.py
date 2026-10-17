"""Demo regressions: isolated data and fake providers only."""
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

import pytest

from agent.orchestrator import VehicleAgent
from agent.tools import lookup_cache
from driver.registry import DriverRegistry, driver_registry
from driver.schemas import DriverBatch, DriverNarrative
from driver.service import DriverService
from situation import start_new_epoch
from store import store
import voice


def test_weather_failure_payload_is_not_cached(monkeypatch):
    monkeypatch.setenv("TOOL_CACHE_SECONDS", "600")
    lookup_cache.clear()
    results = iter([{"success": False, "error": {"code": "SOURCE_UNAVAILABLE"}}, {"success": True, "data": {"temperature": 30}}])
    assert lookup_cache.cached(("demo-weather",), lambda: next(results))["success"] is False
    assert lookup_cache.cached(("demo-weather",), lambda: next(results))["success"] is True
    lookup_cache.clear()


def test_openrouter_model_resolves_through_the_installed_sdk_without_a_request(monkeypatch):
    from agents.models.multi_provider import MultiProvider
    import llm_provider

    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-demo-key")
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    provider = MultiProvider(openai_api_key="fake-demo-key", openai_base_url="http://127.0.0.1:9", openai_use_responses=False)
    model = provider.get_model(llm_provider.model_name())
    assert model.model == "deepseek/deepseek-v4.1-flash"


def test_unconfigured_voice_catalogue_never_contacts_blaze(monkeypatch):
    import voice_options

    monkeypatch.setenv("BLAZE_API_TOKEN", "")
    monkeypatch.setattr(voice_options, "_fetch_catalogue", lambda: pytest.fail("Unconfigured voice must stay offline"))
    assert voice_options.list_voices("en")["enabled"] is False


def test_driver_change_during_model_run_drops_the_obsolete_assessment(monkeypatch):
    from fastapi.testclient import TestClient
    from agent.orchestrator import vehicle_agent
    import main
    from schemas import Severity, VehicleAssessment
    from situation import current_situation

    vehicle = "demo-driver-change"
    driver_registry.update(vehicle, {"state": "attentive", "attention": "attentive", "must_stop": False})
    def slow_model(*args):
        driver_registry.update(vehicle, {"state": "drowsy", "attention": "low_attention", "must_stop": True})
        return VehicleAssessment(severity=Severity.NORMAL, diagnosis="Normal", recommendations=["Monitor"], confidence=.8), [], "agent", None
    monkeypatch.setattr(vehicle_agent, "_model_or_rules", slow_model)
    try:
        body = {"schemaVersion": 1, "batchId": "demo-driver-change-batch", "vehicleId": vehicle,
                "source": "blackbox-simulator", "sampleIntervalMs": 1000, "recordCount": 1,
                "records": [{"capturedAt": "2026-10-17T00:00:00Z", "rpm": 2000, "engineLoad": 40,
                             "speed": 60, "coolant": 90, "intake": 30, "battery": 13.8,
                             "location": {"lat": 10.8, "lon": 106.7}}]}
        assert TestClient(main.app).post("/api/telemetry/batch", json=body).status_code == 409
        assert current_situation(vehicle) is None
    finally: driver_registry.clear()


def driver_batch(session="demo-driver-old", attentive=False):
    at = datetime(2026, 10, 17, tzinfo=timezone.utc) + timedelta(seconds=int(attentive))
    return DriverBatch.model_validate({
        "schemaVersion": 1, "sessionId": session, "source": "simulated",
        "context": {"vehicleId": "demo-check-car", "vehicleMoving": True,
                    "vehicle": {"source": "simulated", "capturedAt": at, "speedKmh": 60, "coolantC": 90 if attentive else 106}},
        "events": [{"capturedAt": at, "facePresent": True, "absentMs": 0, "confidence": .9,
                    "state": "attentive" if attentive else "drowsy",
                    "eyes": {"closed": not attentive, "closedMs": 0 if attentive else 2600},
                    "head": {"direction": "forward", "awayMs": 0}}],
    })


@pytest.mark.parametrize("change", ["reset", "new-driver"])
def test_old_driver_wording_and_timer_do_not_speak_after_context_changed(monkeypatch, change):
    import driver.service as module
    pending = Future()
    pending.set_running_or_notify_cancel()
    timers, lines = [], []
    class Timer:
        def __init__(self, timeout, fn, args): timers.append(lambda: fn(*args))
        def start(self): pass
    monkeypatch.setattr(module, "submit", lambda *a: pending)
    monkeypatch.setattr(module.threading, "Timer", Timer)
    monkeypatch.setattr(voice, "announce_alert", lambda *a, **kw: lines.append(a[0]))
    service = DriverService(registry=DriverRegistry())
    service.process(driver_batch())
    if change == "reset": start_new_epoch()
    else: service.process(driver_batch("demo-driver-new", attentive=True))
    pending.set_result((DriverNarrative(summary="Old drowsy instruction.", recommendations=["Stop."]), None))
    for fire in timers: fire()
    assert lines == []


def test_alert_queued_before_reset_does_not_start_synthesis(monkeypatch):
    jobs, syntheses = [], []
    class Pool:
        def submit(self, fn, *args): jobs.append(lambda: fn(*args))
    monkeypatch.setenv("BLAZE_API_TOKEN", "fake-demo-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "fake-demo-voice")
    monkeypatch.setattr(voice, "_pool", Pool)
    monkeypatch.setattr(voice, "_client_from_env", lambda *a: syntheses.append(True))
    voice.announce_alert("Old scenario warning.", severity="warning", session_id="demo-check-car")
    assert len(jobs) == 1
    start_new_epoch()
    jobs[0]()
    assert syntheses == []


def test_audio_finishing_after_reset_is_not_published(monkeypatch, tmp_path):
    from collections import deque
    class Client:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def synthesize(self, text):
            start_new_epoch()
            return voice.Speech(text, b"ID3fixture", "audio/mpeg", "old-job")
    class Pool:
        def submit(self, fn, *args): fn(*args)
    monkeypatch.setenv("BLAZE_API_TOKEN", "fake-demo-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "fake-demo-voice")
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    monkeypatch.setattr(voice, "_pool", Pool)
    monkeypatch.setattr(voice, "_clips", deque(maxlen=50))
    monkeypatch.setattr(voice, "_client_from_env", lambda *a: Client())
    voice.announce_alert("Old scenario warning.", severity="warning", session_id="demo-check-car")
    assert not voice._clips


@pytest.mark.parametrize("blocked", ["closed", "drowsy"])
def test_old_booking_cannot_be_confirmed_after_context_changed(blocked):
    vehicle = f"demo-book-{blocked}"
    incident = store.create_incident(vehicle_id=vehicle, severity="warning", diagnosis="Warm",
        assessment={"severity": "warning"}, reasons=[], recommendations=["Inspect"], tool_trace=[])
    pending = store.create_pending_action(incident["id"], "book_appointment", {
        "garage_id": "Fixture garage", "slot": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()})
    if blocked == "closed": store.close_open_incidents()
    else: driver_registry.update(vehicle, {"attention": "low_attention", "state": "drowsy", "severity": "critical", "must_stop": True})
    try:
        with pytest.raises(ValueError): VehicleAgent.confirm_action(incident["id"], pending["id"])
        assert store.appointment_for_incident(incident["id"]) is None
    finally: driver_registry.clear()


def test_rules_launcher_blanks_blaze_before_loading_dotenv(tmp_path):
    root = Path(__file__).resolve().parents[2]
    shutil.copy(root / "demo.sh", tmp_path / "demo.sh")
    backend = tmp_path / "backend"
    executable = backend / ".venv/bin/python"
    executable.parent.mkdir(parents=True)
    output = tmp_path / "observed.json"
    executable.write_text(f'''#!{sys.executable}
import json, os, sys
from pathlib import Path
if '-c' in sys.argv: print('test-python')
else:
    Path({str(output)!r}).write_text(json.dumps({{k: os.getenv(k) for k in ['BLAZE_API_TOKEN','AGENT_MODE','EXTERNAL_TOOLS']}}))
    raise SystemExit(1)
''')
    executable.chmod(0o755)
    (backend / ".env").write_text("BLAZE_API_TOKEN=fake-file-token\nBLAZE_SPEAKER_ID=fake-speaker\n")
    (tmp_path / "frontend/node_modules").mkdir(parents=True)
    (tmp_path / "frontend/.next").mkdir()
    (tmp_path / "frontend/.next/BUILD_ID").write_text("fixture")
    with socket.socket() as one, socket.socket() as two:
        one.bind(("127.0.0.1", 0)); two.bind(("127.0.0.1", 0))
        ports = one.getsockname()[1], two.getsockname()[1]
    env = {**os.environ, "BLAZE_API_TOKEN": "fake-exported-token", "BACKEND_PORT": str(ports[0]), "FRONTEND_PORT": str(ports[1])}
    result = subprocess.run(["bash", "demo.sh", "--rules", "--prewarm", "--keep"], cwd=tmp_path,
                            env=env, capture_output=True, timeout=10, start_new_session=True)
    assert result.returncode != 0, "stub backend deliberately exits before serving anything"
    assert output.exists(), result.stderr.decode()
    assert json.loads(output.read_text()) == {"BLAZE_API_TOKEN": "", "AGENT_MODE": "rules", "EXTERNAL_TOOLS": "off"}
