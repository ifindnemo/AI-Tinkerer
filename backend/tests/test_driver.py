import copy
import os
import time
from concurrent.futures import Future
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import driver.agent as agent_module
import driver.service as service_module
from driver.routes import get_driver_service, router
from driver.rules import assess
from driver.schemas import DriverBatch, DriverNarrative
from driver.service import DriverService

T0 = datetime(2026, 10, 11, 2, 0, 0, tzinfo=timezone.utc)


def _event(second: int, state="attentive", **over) -> dict:
    event = {
        "capturedAt": (T0 + timedelta(seconds=second)).isoformat().replace("+00:00", "Z"),
        "facePresent": state != "no_face",
        "absentMs": 3000 if state == "no_face" else 0,
        "eyes": {"closed": state == "drowsy", "closedMs": 0, "perclos": None, "score": 0.1},
        "head": {"direction": "forward", "yawDeg": 1.0, "pitchDeg": 0.5, "awayMs": 0},
        "state": state,
        "confidence": 0.9,
    }
    event.update(over)
    return event


def _batch(events: list[dict], moving=True, session="session-abcdef01") -> dict:
    return {"schemaVersion": 1, "sessionId": session, "source": "webcam", "context": {"vehicleMoving": moving}, "events": events}


def _drowsy(second: int, closed_ms: int) -> dict:
    event = _event(second, "drowsy")
    event["eyes"] = {"closed": True, "closedMs": closed_ms, "perclos": 0.12, "score": 0.9}
    return event


def _distracted(second: int, away_ms: int, direction="left") -> dict:
    event = _event(second, "distracted")
    event["head"] = {"direction": direction, "yawDeg": 38.0, "pitchDeg": 1.0, "awayMs": away_ms}
    return event


@pytest.fixture(autouse=True)
def rules_only(monkeypatch):
    monkeypatch.setenv("AGENT_MODE", "rules")


def _client(service: DriverService) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_driver_service] = lambda: service
    return TestClient(app)


# ---- schema: structured values only -------------------------------------------------------------
def test_schema_accepts_the_documented_event() -> None:
    batch = DriverBatch.model_validate(_batch([_event(0), _event(1)]))
    assert batch.events[0].captured_at.tzinfo == timezone.utc
    assert batch.context.vehicle_moving is True


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["events"][0].update({"image": "data:image/jpeg;base64,AAAA"}),
        lambda b: b["events"][0].update({"landmarks": [[0.1, 0.2, 0.3]]}),
        lambda b: b["events"][0]["eyes"].update({"frame": "x"}),
        lambda b: b["events"][0]["head"].update({"yawDeg": 400}),
        lambda b: b["events"][0].update({"state": "sleeping"}),
        lambda b: b["events"][0].update({"confidence": 1.5}),
        lambda b: b["events"][0].update({"capturedAt": "2026-10-11T02:00:00"}),
        lambda b: b.update({"video": "blob:x"}),
        lambda b: b.update({"sessionId": "x"}),
        lambda b: b.update({"events": []}),
        lambda b: b.update({"events": [_event(i) for i in range(61)]}),
        lambda b: b.update({"schemaVersion": 2}),
    ],
    ids=["image", "landmarks", "eyes-frame", "yaw-range", "state", "confidence", "naive-time", "video", "session", "empty", "too-many", "version"],
)
def test_schema_rejects_anything_that_is_not_a_structured_event(mutate) -> None:
    payload = _batch([_event(0)])
    mutate(payload)
    with pytest.raises(ValidationError):
        DriverBatch.model_validate(payload)


# ---- rules ------------------------------------------------------------------------------------------
def _assess(events: list[dict], moving=True):
    return assess(DriverBatch.model_validate(_batch(events)).events, moving)


def test_attentive_driver_is_normal() -> None:
    result = _assess([_event(0), _event(1)])
    assert (result.severity, result.state) == ("normal", "attentive")


def test_drowsy_is_warning_and_a_long_closure_is_critical() -> None:
    assert _assess([_drowsy(0, 1600)]).severity == "warning"
    critical = _assess([_drowsy(0, 1600), _drowsy(1, 2600)])
    assert critical.severity == "critical"
    assert "2,6 giây (vừa xong)" in critical.evidence[0]
    assert critical.recommendations[0].startswith("Tấp xe")
    assert _assess([_drowsy(0, 2600), _drowsy(1, 300)]).severity == "critical"  # the worst of the last minute counts


def test_drowsiness_holds_after_the_eyes_reopen() -> None:
    # A microsleep keeps the alert critical for 60 s; any drowsy reading keeps a warning for 20 s.
    held = _assess([_drowsy(0, 3100), _event(12)])
    assert (held.severity, held.state) == ("critical", "drowsy")
    assert "Mắt đã mở lại" in held.summary and "cách đây 12 giây" in held.evidence[0]
    assert _assess([_drowsy(0, 3100), _event(61)]).severity == "normal"
    assert _assess([_drowsy(0, 1600), _event(15)]).severity == "warning"
    assert _assess([_drowsy(0, 1600), _event(21)]).severity == "normal"
    assert _assess([_drowsy(0, 3100), _event(20, "no_face")]).severity == "critical"  # the worse alert wins


def test_distraction_depends_on_the_vehicle_moving() -> None:
    assert _assess([_distracted(0, 2200)]).severity == "warning"
    assert _assess([_distracted(0, 4500)]).severity == "critical"
    parked = _assess([_distracted(0, 4500)], moving=False)
    assert parked.severity == "normal" and "đứng yên" in parked.summary
    assert "sang trái" in _assess([_distracted(0, 2200, "left")]).evidence[0]
    assert "sang phải" in _assess([_distracted(0, 2200, "right")]).evidence[0]


def test_no_face_and_uncertain() -> None:
    assert _assess([_event(0, "no_face")]).severity == "warning"
    assert _assess([_event(0, "no_face")], moving=False).severity == "normal"
    uncertain = _assess([_event(0, "uncertain", confidence=0.3)])
    assert uncertain.severity == "normal" and "chưa đủ tin cậy" in uncertain.summary.lower()


# ---- service and endpoint -----------------------------------------------------------------------
def test_endpoint_returns_a_camelcase_assessment_and_states_no_video_was_received() -> None:
    client = _client(DriverService())
    response = client.post("/api/driver/events", json=_batch([_drowsy(0, 1700)]))
    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] == 1 and body["state"] == "drowsy"
    assert body["privacy"] == {"rawVideoReceived": False}
    assessment = body["assessment"]
    assert assessment["severity"] == "warning" and assessment["engine"] == "rules"
    assert assessment["fallbackReason"] == "rules_mode"
    assert set(assessment) == {"severity", "summary", "evidence", "recommendations", "confidence", "engine", "fallbackReason", "state", "at"}


def test_endpoint_rejects_a_frame_smuggled_into_an_event() -> None:
    client = _client(DriverService())
    payload = _batch([_event(0)])
    payload["events"][0]["image"] = "data:image/png;base64,AAAA"
    assert client.post("/api/driver/events", json=payload).status_code == 422


def test_sessions_are_isolated_deduplicated_and_capped() -> None:
    service = DriverService()
    service.process(DriverBatch.model_validate(_batch([_event(0), _event(1)], session="session-aaaaaaa1")))
    service.process(DriverBatch.model_validate(_batch([_event(1), _event(2)], session="session-aaaaaaa1")))
    assert len(service._sessions["session-aaaaaaa1"].events) == 3
    for i in range(60):
        service.process(DriverBatch.model_validate(_batch([_event(0)], session=f"session-{i:08d}")))
    assert service.session_count() == service_module.MAX_SESSIONS


def test_nothing_is_written_to_disk_or_the_database() -> None:
    before = sorted(os.listdir(os.path.dirname(os.environ["DATABASE_PATH"])))
    DriverService().process(DriverBatch.model_validate(_batch([_drowsy(0, 2600)])))
    assert sorted(os.listdir(os.path.dirname(os.environ["DATABASE_PATH"]))) == before


# ---- the agent only rewords, in the background ---------------------------------------------------
def _batch_obj(events: list[dict], moving=True) -> DriverBatch:
    return DriverBatch.model_validate(_batch(events, moving))


def _settle(service: DriverService, session="session-abcdef01", timeout=2.0) -> None:
    future = service._sessions[session].future
    if future is not None:
        future.result(timeout=timeout)


def test_alerts_come_from_the_rules_at_once_and_the_wording_arrives_later(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    calls = []

    def fake(rule, events, moving):
        calls.append(rule.severity)
        return DriverNarrative(summary="Bạn có dấu hiệu buồn ngủ, hãy dừng xe.", recommendations=["Dừng xe an toàn."])

    monkeypatch.setattr(agent_module, "_narrate", fake)
    service = DriverService()
    first = service.process(_batch_obj([_drowsy(0, 2600)]))["assessment"]
    assert first["engine"] == "rules" and first["fallbackReason"] == "pending"
    assert first["severity"] == "critical" and "buồn ngủ" in first["summary"]
    _settle(service)
    later = service.process(_batch_obj([_drowsy(1, 2700)]))["assessment"]
    assert calls == ["critical"]
    assert later["engine"] == "agent" and later["fallbackReason"] is None
    assert later["summary"] == "Bạn có dấu hiệu buồn ngủ, hãy dừng xe."
    assert later["severity"] == "critical"
    assert later["evidence"][0].startswith("Lần nhắm mắt lâu nhất")  # numbers come from the rules


def test_escalation_is_not_delayed_by_a_slow_agent(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")

    def slow(rule, events, moving):
        time.sleep(1.0)
        return DriverNarrative(summary="late", recommendations=["late"])

    monkeypatch.setattr(agent_module, "_narrate", slow)
    service = DriverService()
    started = time.monotonic()
    warning = service.process(_batch_obj([_drowsy(0, 1600)]))["assessment"]
    critical = service.process(_batch_obj([_drowsy(1, 2600)]))["assessment"]
    assert time.monotonic() - started < 0.5
    assert (warning["severity"], critical["severity"]) == ("warning", "critical")
    assert critical["engine"] == "rules"
    _settle(service)


@pytest.mark.parametrize("failure, reason", [(RuntimeError("401"), "error"), ("slow", "timeout")])
def test_agent_failure_or_timeout_falls_back_to_the_rules_text(monkeypatch, failure, reason) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setenv("DRIVER_AGENT_TIMEOUT_SECONDS", "0.1")

    def fake(rule, events, moving):
        if failure == "slow":
            time.sleep(0.5)
            return DriverNarrative(summary="late", recommendations=["late"])
        raise failure

    monkeypatch.setattr(agent_module, "_narrate", fake)
    service = DriverService()
    service.process(_batch_obj([_drowsy(0, 2600)]))
    time.sleep(0.25)
    assessment = service.process(_batch_obj([_drowsy(1, 2700)]))["assessment"]
    assert assessment["engine"] == "rules" and assessment["fallbackReason"] == reason
    assert assessment["severity"] == "critical" and "buồn ngủ" in assessment["summary"]
    time.sleep(0.4)  # the late reply, if any, is ignored
    assert service.process(_batch_obj([_drowsy(2, 2800)]))["assessment"]["summary"] != "late"


def test_rules_mode_never_starts_the_agent(monkeypatch) -> None:
    monkeypatch.setattr(agent_module, "_narrate", lambda *a: (_ for _ in ()).throw(AssertionError("LLM called")))
    assessment = DriverService().process(_batch_obj([_drowsy(0, 2600)]))["assessment"]
    assert assessment["engine"] == "rules" and assessment["fallbackReason"] == "rules_mode"


def test_agent_is_asked_once_per_episode_and_not_at_all_when_normal(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODE", "openai")
    calls = []
    clock = [0.0]

    def fake(rule, events, moving):
        calls.append(rule.episode_key)
        return DriverNarrative(summary="ok", recommendations=["ok"])

    monkeypatch.setattr(agent_module, "_narrate", fake)
    service = DriverService(clock=lambda: clock[0])

    def send(event):
        result = service.process(_batch_obj([event]))["assessment"]
        _settle(service)
        return result

    send(_event(0))
    assert calls == []  # attentive: no LLM cost
    send(_drowsy(2, 1700))
    send(_drowsy(3, 1800))
    assert calls == ["drowsy:warning"]  # same episode: reuse the wording
    again = send(_drowsy(4, 1900))
    assert again["engine"] == "agent" and again["summary"] == "ok"
    clock[0] = 25.0
    send(_drowsy(5, 2000))
    assert calls == ["drowsy:warning", "drowsy:warning"]  # refreshed after 20 s
    send(_drowsy(6, 2700))
    assert calls[-1] == "drowsy:critical"  # escalation is a new episode
    send(_event(90))  # past both holds: normal again
    send(_drowsy(91, 1700))
    assert calls[-1] == "drowsy:warning" and len(calls) == 4  # a new episode after recovering


def test_an_old_closure_does_not_escalate_a_new_episode() -> None:
    # Regression: windows are measured in event time, not in number of events.
    assert _assess([_drowsy(0, 2700), _event(70), _drowsy(71, 1700)]).severity == "warning"
    assert _assess([_drowsy(17, 2700), _drowsy(21, 1700)]).severity == "critical"


@pytest.mark.parametrize("over", [{"confidence": 0.2}, {"state": "uncertain"}, {"facePresent": False}])
def test_unreliable_closure_cannot_create_or_extend_a_drowsy_alert(over) -> None:
    unreliable = _drowsy(70, 5000)
    unreliable.update(over)
    result = _assess([_drowsy(0, 3000), unreliable])
    assert result.severity == "normal"
    assert result.state == "uncertain"


def test_missing_face_during_a_held_alert_is_not_reported_as_reopened_eyes() -> None:
    result = _assess([_drowsy(0, 3000), _event(10, "no_face")])
    assert result.severity == "critical"
    assert "Mắt đã mở lại" not in result.summary


def test_duplicate_events_in_one_batch_are_only_stored_once() -> None:
    service = DriverService()
    service.process(_batch_obj([_event(0), _event(0), _event(1)]))
    assert len(service._sessions["session-abcdef01"].events) == 2


@pytest.mark.parametrize("change", ["reopened", "parked", "direction"])
def test_pending_narrative_cannot_cross_an_observation_or_context_change(monkeypatch, change) -> None:
    pending = []

    def submit(*args):
        future = Future()
        future.set_running_or_notify_cancel()  # a running request may not be cancellable
        pending.append(future)
        return future

    monkeypatch.setattr(service_module, "submit", submit)
    clock = [0.0]
    service = DriverService(clock=lambda: clock[0])
    first = _distracted(0, 4500) if change == "direction" else _drowsy(0, 3000)
    service.process(_batch_obj([first]))
    second = _event(1) if change == "reopened" else _distracted(1, 5000, "right") if change == "direction" else _drowsy(1, 3100)
    result = service.process(_batch_obj([second], moving=change != "parked"))["assessment"]
    assert result["severity"] == "critical" and result["engine"] == "rules"
    assert len(pending) == 1  # discard obsolete wording without an LLM call on every blink
    pending[0].set_result((DriverNarrative(summary="stale", recommendations=["stale"]), None))
    assert service.process(_batch_obj([second], moving=change != "parked"))["assessment"]["summary"] != "stale"
    clock[0] = 21.0
    service.process(_batch_obj([second], moving=change != "parked"))
    assert len(pending) == 2
    pending[1].set_result((DriverNarrative(summary="fresh", recommendations=["Ignore the alert"]), None))
    fresh = service.process(_batch_obj([second], moving=change != "parked"))["assessment"]
    assert fresh["summary"] == "fresh"
    assert fresh["recommendations"] == _assess([first, second], moving=change != "parked").recommendations


def test_parked_drowsy_driver_is_not_told_to_pull_over_again() -> None:
    result = _assess([_drowsy(0, 3000)], moving=False)
    assert result.severity == "critical"
    assert result.recommendations[0].startswith("Giữ xe")


def test_failed_future_does_not_break_event_ingestion(monkeypatch) -> None:
    failed = Future()
    failed.set_exception(RuntimeError("worker failed"))
    monkeypatch.setattr(service_module, "submit", lambda *args: failed)
    service = DriverService()
    service.process(_batch_obj([_drowsy(0, 3000)]))
    result = service.process(_batch_obj([_drowsy(1, 3100)]))["assessment"]
    assert result["severity"] == "critical" and result["fallbackReason"] == "error"
