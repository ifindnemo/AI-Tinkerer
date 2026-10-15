"""The agent's output language (text and voice): English next to Vietnamese, the same decisions in both.

Language only chooses the wording. Severity, the mandatory steps and the safety filters must not depend
on it, and the English filters must catch what the Vietnamese ones catch.
"""

import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import agent.orchestrator as orchestrator
import voice
from agent.orchestrator import VehicleAgent, vehicle_agent
from agent.prompt import build_agent_instructions
from agent.safety import evaluate_hard_safety
from analysis.rules import batch_policy, batch_rules_assessment
from driver.agent import INSTRUCTIONS, GUARDIAN_INSTRUCTIONS, localized, states_the_stop, unsafe_for_stop
from driver.guardian import combine
from driver.registry import STOP_FOR_DRIVER, STOP_FOR_DRIVER_EN, stop_for_driver, suggests_garage_trip
from driver.rules import assess
from driver.schemas import DriverBatch, DriverEvent, VehicleSnapshot
from driver.service import DriverService
from lang import normalize, number, pick
from routes import router
from schemas import Severity, TelemetryBatchInput, VehicleAssessment

T0 = datetime(2026, 10, 15, 9, 0, 0, tzinfo=timezone.utc)
VIETNAMESE = re.compile(r"[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]", re.IGNORECASE)


def _iso(second: float) -> str:
    return (T0 + timedelta(seconds=second)).isoformat().replace("+00:00", "Z")


def _event(second: float, state="attentive", closed_ms=0, away_ms=0, direction="forward", **over) -> dict:
    event = {
        "capturedAt": _iso(second),
        "facePresent": state != "no_face",
        "absentMs": 3000 if state == "no_face" else 0,
        "eyes": {"closed": state == "drowsy", "closedMs": closed_ms, "perclos": 0.12 if state == "drowsy" else None, "score": 0.9},
        "head": {"direction": direction, "yawDeg": 1.0, "pitchDeg": 0.5, "awayMs": away_ms},
        "state": state,
        "confidence": 0.9,
    }
    event.update(over)
    return event


def _events(*raw: dict) -> list[DriverEvent]:
    return [DriverEvent.model_validate(item) for item in raw]


def _vehicle(speed=65, coolant=107, source="simulated") -> VehicleSnapshot:
    return VehicleSnapshot.model_validate(
        {"source": source, "capturedAt": _iso(0), "speedKmh": speed, "coolantC": coolant, "engineLoadPct": 72, "drivingMinutes": 128}
    )


def _assert_english(text: str) -> None:
    assert text and not VIETNAMESE.search(text), f"not English: {text!r}"


# ---------------------------------------------------------------- the helpers and the wire format

def test_normalize_and_pick() -> None:
    assert [normalize(v) for v in ("en", "EN", "en-GB", "vi", "vi-VN", "", None, "fr")] == ["en", "en", "en", "vi", "vi", "vi", "vi", "vi"]
    assert pick("en", "xin chào", "hello") == "hello" and pick("vi", "xin chào", "hello") == "xin chào"
    assert number(66.45, "vi") == "66,5" or number(66.45, "vi") == "66,4"  # float rounding, decimal comma
    assert number(66.5, "en") == "66.5"


def test_requests_carry_an_optional_language_and_reject_others() -> None:
    record = {"capturedAt": _iso(0), "rpm": 2400, "map": 60, "tps": 30, "engineLoad": 50, "consumption": 8, "speed": 60,
              "coolant": 90, "intake": 30, "battery": 13.9, "fan": 0, "location": {"lat": 10.8, "lon": 106.7}}
    body = {"schemaVersion": 1, "batchId": "b1", "vehicleId": "bmw-m2", "source": "x", "sampleIntervalMs": 1000, "recordCount": 1, "records": [record]}
    assert TelemetryBatchInput.model_validate(body).lang == "vi"
    english = TelemetryBatchInput.model_validate({**body, "lang": "en"})
    assert english.lang == "en" and english.to_agent_context()["lang"] == "en"
    with pytest.raises(ValidationError):
        TelemetryBatchInput.model_validate({**body, "lang": "fr"})
    driver = {"schemaVersion": 1, "sessionId": "session-abcdef01", "source": "webcam", "events": [_event(0)]}
    assert DriverBatch.model_validate({**driver, "context": {"vehicleMoving": True}}).context.lang == "vi"
    assert DriverBatch.model_validate({**driver, "context": {"vehicleMoving": True, "lang": "en"}}).context.lang == "en"
    with pytest.raises(ValidationError):
        DriverBatch.model_validate({**driver, "context": {"vehicleMoving": True, "lang": "de"}})


# ---------------------------------------------------------------- the prompts

def test_prompts_ask_for_english_only_when_english_is_chosen() -> None:
    vietnamese, english = build_agent_instructions("vi"), build_agent_instructions("en")
    assert vietnamese == build_agent_instructions() and "OUTPUT LANGUAGE" not in vietnamese
    assert "OUTPUT LANGUAGE: ENGLISH" in english and english.rstrip().endswith("</output_language>")
    assert "bằng tiếng Việt." not in english.split("<diagnostic_skill>")[0]  # the Vietnamese-only line is gone
    for instructions in (INSTRUCTIONS, GUARDIAN_INSTRUCTIONS):
        assert localized(instructions, "vi") == instructions
        assert "OUTPUT LANGUAGE: ENGLISH" in localized(instructions, "en") and "bằng tiếng Anh" in localized(instructions, "en")


def test_one_vehicle_agent_per_language() -> None:
    assert vehicle_agent._agent_for("vi") is vehicle_agent.agent
    english = vehicle_agent._agent_for("en")
    assert english is not vehicle_agent.agent and english is vehicle_agent._agent_for("en-GB")
    assert "OUTPUT LANGUAGE: ENGLISH" in english.instructions


# ---------------------------------------------------------------- driver rules: same decision, other words

SITUATIONS = {
    "microsleep_moving": ([_event(0, "attentive"), _event(1, "drowsy", 2600)], True),
    "drowsy_moving": ([_event(0, "attentive"), _event(1, "drowsy", 1500)], True),
    "drowsy_parked": ([_event(0, "attentive"), _event(1, "drowsy", 1500)], False),
    "reopened": ([_event(0, "drowsy", 2600), _event(2, "attentive")], True),
    "look_away_short": ([_event(0, "distracted", away_ms=2200, direction="left")], True),
    "look_away_long": ([_event(0, "distracted", away_ms=4500, direction="down")], True),
    "look_away_parked": ([_event(0, "distracted", away_ms=2200, direction="right")], False),
    "no_face_moving": ([_event(0, "no_face")], True),
    "no_face_parked": ([_event(0, "no_face")], False),
    "uncertain": ([_event(0, "attentive", confidence=0.3)], True),
    "attentive": ([_event(0, "attentive")], True),
}


@pytest.mark.parametrize("name", SITUATIONS)
def test_driver_rules_decide_the_same_in_both_languages(name) -> None:
    raw, moving = SITUATIONS[name]
    vi, en = assess(_events(*raw), moving), assess(_events(*raw), moving, "en")
    assert (en.severity, en.state, en.confidence) == (vi.severity, vi.state, vi.confidence)
    assert len(en.recommendations) == len(vi.recommendations) and len(en.evidence) == len(vi.evidence)
    assert vi.lang == "vi" and en.lang == "en"
    for text in (en.summary, *en.evidence, *en.recommendations):
        _assert_english(text)
    assert vi.summary != en.summary


# ---------------------------------------------------------------- the Guardian

GUARDIAN_CASES = {
    "stop_engine": (dict(speed=65, coolant=122), [_event(0, "attentive")]),
    "stop_nearest_safe": (dict(speed=65, coolant=107), [_event(0, "drowsy", 2600)]),
    "stop_nearest_safe_cool": (dict(speed=65, coolant=90), [_event(0, "drowsy", 2600)]),
    "stay_parked": (dict(speed=0, coolant=107), [_event(0, "drowsy", 2600)]),
    "refocus": (dict(speed=65, coolant=107), [_event(0, "distracted", away_ms=2500, direction="left")]),
    "reduce_load": (dict(speed=65, coolant=107), [_event(0, "attentive")]),
    "reduce_load_unknown": (dict(speed=65, coolant=107), [_event(0, "no_face")]),
    "check_camera": (dict(speed=65, coolant=90), [_event(0, "no_face")]),
    "continue": (dict(speed=65, coolant=90), [_event(0, "attentive")]),
}
MAINTENANCE = {"vehicleId": "bmw-m2", "simulated": True, "records": 3, "coolingRecords": 1, "last": {"date": "2025-08-02", "label": "Cooling system check", "status": "resolved"}, "recent": []}


@pytest.mark.parametrize("name", GUARDIAN_CASES)
@pytest.mark.parametrize("responded", [False, True])
def test_guardian_decision_and_steps_do_not_depend_on_language(name, responded) -> None:
    over, raw = GUARDIAN_CASES[name]
    events = _events(*raw)
    moving = over["speed"] >= 5
    results = {}
    for lang in ("vi", "en"):
        rule = assess(events, moving, lang)
        results[lang] = combine(rule, events, _vehicle(over["speed"], over["coolant"]), responded=responded, unanswered=False,
                                alert_since=T0, maintenance=MAINTENANCE)
    vi, en = results["vi"], results["en"]
    assert en.decision == vi.decision and en.block == vi.block and en.lang == "en"
    assert len(en.recommendations) == len(vi.recommendations) and len(en.evidence) == len(vi.evidence)
    for text in (en.summary, *en.recommendations):
        _assert_english(text)
    for line in en.evidence:
        # The seeded maintenance label is data and stays as written; everything the policy writes is English.
        _assert_english(line.replace(MAINTENANCE["last"]["label"], ""))


def test_seeded_maintenance_labels_read_naturally_in_english() -> None:
    from driver.guardian import _fault_label

    assert _fault_label("Nghiêm trọng - Nghi bỏ máy (Possible Misfire)", "en") == "Severe - Possible Misfire"
    assert _fault_label("Cảnh báo - Hỗn hợp nhiên liệu nghèo (Lean Mixture)", "en") == "Warning - Lean Mixture"
    assert _fault_label("Trung bình - Hỗn hợp nhiên liệu giàu (Rich Mixture)", "en") == "Moderate - Rich Mixture"
    assert _fault_label("Không phát hiện lỗi", "en") == "No fault found"
    assert _fault_label("Something else", "en") == "Something else" and _fault_label(None, "en") == ""
    assert _fault_label("Nghiêm trọng - Nghi bỏ máy (Possible Misfire)", "vi") == "Nghiêm trọng - Nghi bỏ máy (Possible Misfire)"


def test_english_mandatory_stop_says_to_stop_and_switch_off_and_never_to_continue() -> None:
    over, raw = GUARDIAN_CASES["stop_engine"]
    events = _events(*raw)
    result = combine(assess(events, True, "en"), events, _vehicle(65, 122), responded=False, unanswered=False, alert_since=None, maintenance=None)
    assert result.decision.action == "stop_engine" and result.decision.must_stop
    spoken = " ".join([result.summary, *result.recommendations])
    assert states_the_stop(result.recommendations[0], "stop_engine")
    assert not unsafe_for_stop(spoken), "the policy's own English wording must pass the filter it is checked against"
    drowsy, drowsy_raw = GUARDIAN_CASES["stop_nearest_safe"]
    events = _events(*drowsy_raw)
    result = combine(assess(events, True, "en"), events, _vehicle(65, 107), responded=False, unanswered=False, alert_since=T0, maintenance=None)
    assert not unsafe_for_stop(" ".join([result.summary, *result.recommendations]))


# ---------------------------------------------------------------- the safety filters

UNSAFE_EN = [
    "You can continue driving to the garage.",
    "Keep driving, the engine is only a little warm.",
    "Continue your trip but watch the temperature.",
    "You are not drowsy but you should keep going to the next rest stop.",
    "Head to the nearest garage and have it checked.",
    "Drive on to a workshop when you can.",
    "Carry on carefully.",
    "Open the radiator cap to let the steam out.",
    "Proceed to the rest area, then stop.",
    "Take the car to a garage tomorrow.",
    "Press on to the next service area.",
    "You may continue.",
]
SAFE_EN = [
    "Stop at the nearest safe place and switch off the engine.",
    "Do not continue to a garage or rest stop.",
    "Do not continue driving. Pull over now.",
    "Please don't open the radiator cap while the engine is hot.",
    "Instead of driving on, stop somewhere safe and rest.",
    "Pull over at a safe place and rest for 15 minutes.",
    "You should not continue the trip to a distant garage.",
    "Never open the radiator cap on a hot engine.",
    "Stop now, switch off the engine, and do not drive to a workshop.",
    "Your eyes have been closed for 2.5 seconds at 66 km/h. Pull over and rest.",
    "Keep calm, pull over, and switch off the engine.",
]


@pytest.mark.parametrize("text", UNSAFE_EN)
def test_english_wording_that_tells_a_stopped_driver_to_go_on_is_unsafe(text) -> None:
    assert unsafe_for_stop(text)


@pytest.mark.parametrize("text", SAFE_EN)
def test_english_stop_wording_is_not_flagged(text) -> None:
    assert not unsafe_for_stop(text)


def test_vietnamese_filter_is_unchanged() -> None:
    assert unsafe_for_stop("Bạn có thể tiếp tục lái đến garage.")
    assert not unsafe_for_stop("Không nên tiếp tục hành trình đến garage ở xa.")


@pytest.mark.parametrize("text", [
    "Pull over and switch off the engine now.",
    "Stop the car and turn the engine off.",
    "Please stop and shut off the engine.",
    "Stop at a safe place and turn off the engine.",
    "Dừng xe ngay và tắt máy.",
])
def test_a_mandatory_stop_must_say_stop_and_engine_off(text) -> None:
    assert states_the_stop(text, "stop_engine")


@pytest.mark.parametrize("text", ["Pull over and rest.", "Switch off the engine.", "Slow down and watch the temperature.", "Dừng xe nghỉ."])
def test_without_both_parts_the_stop_is_not_stated(text) -> None:
    assert not states_the_stop(text, "stop_engine")
    assert states_the_stop(text, "reduce_load")  # only a mandatory engine stop needs both


def test_garage_trip_steps_are_found_in_both_languages_and_negation_makes_them_safe() -> None:
    assert suggests_garage_trip("Take the car to a garage when convenient.")
    assert suggests_garage_trip("Drive to the nearest workshop.")
    assert suggests_garage_trip("Đưa xe tới garage để kiểm tra khi thuận tiện.")
    assert not suggests_garage_trip("Do not continue to a distant garage.")
    assert not suggests_garage_trip("Stop at the nearest safe place to rest.")
    assert not suggests_garage_trip("Không tiếp tục đến garage ở xa.")
    assert stop_for_driver("en") == STOP_FOR_DRIVER_EN and stop_for_driver("vi") == STOP_FOR_DRIVER
    assert not suggests_garage_trip(STOP_FOR_DRIVER_EN)


# ---------------------------------------------------------------- the blackbox agent's deterministic parts

def _context(coolant: list[float], lang: str, **extra) -> dict:
    records = [{"captured_at": _iso(i), "coolant_temp_c": value, "battery_voltage": 13.9, "fan_percent": 0, "speed": 65} for i, value in enumerate(coolant)]
    return {"vehicle_id": "bmw-m2", "lang": lang, "source": "simulated", "sample_interval_ms": 1000, "records": records, **extra}


@pytest.mark.parametrize("coolant,severity", [
    ([90.0] * 8, Severity.NORMAL),
    ([104, 105.5, 106, 106.5, 107, 107.5, 108, 108.5], Severity.WARNING),
    ([110, 114, 118, 120.5, 121, 122, 122.5, 123], Severity.CRITICAL),
])
def test_batch_rules_answer_the_same_severity_in_english(coolant, severity) -> None:
    vi, en = batch_rules_assessment(_context(coolant, "vi")), batch_rules_assessment(_context(coolant, "en"))
    assert en.severity == vi.severity == severity
    assert len(en.recommendations) == len(vi.recommendations)
    for text in (en.diagnosis, *en.evidence, *en.recommendations, *en.suspected_faults):
        _assert_english(text)
    if severity == Severity.CRITICAL:
        assert states_the_stop(en.recommendations[0], "stop_engine") and not unsafe_for_stop(" ".join(en.recommendations))


def test_hard_safety_reasons_follow_the_language_but_not_the_floor() -> None:
    vi, en = evaluate_hard_safety(_context([121.0], "vi")), evaluate_hard_safety(_context([121.0], "en"))
    assert vi.minimum_severity == en.minimum_severity == Severity.CRITICAL and vi.triggered and en.triggered
    for reason in en.reasons:
        _assert_english(reason)
    assert evaluate_hard_safety(_context([90.0], "en")).reasons == []
    policy = batch_policy(_context([106.0] * 10, "en"))
    assert policy and policy["minimum_severity"] == "warning"
    for reason in policy["reasons"]:
        _assert_english(reason)


def _assessment(severity=Severity.NORMAL, steps=None, diagnosis="All good.") -> VehicleAssessment:
    return VehicleAssessment(severity=severity, diagnosis=diagnosis, evidence=[], confidence=0.8, recommendations=steps or ["Keep monitoring."])


def test_a_critical_result_gets_the_stop_step_first_in_its_language() -> None:
    for lang, expected in (("vi", "Dừng xe ở vị trí an toàn"), ("en", "Stop at a safe place")):
        context = _context([110, 114, 118, 120.5, 121, 122, 122.5, 123], lang)
        assessment, _ = vehicle_agent.finalize(_assessment(Severity.WARNING, ["Check the coolant."]), context, [])
        assert assessment.severity == Severity.CRITICAL and assessment.recommendations[0].startswith(expected)


def test_driver_policy_adds_the_camera_evidence_and_stop_step_in_english() -> None:
    live = {"status": "live", "attention": "low_attention", "state": "drowsy", "severity": "critical", "closed_ms_max_60s": 2600, "responded": False}
    results = {}
    for lang in ("vi", "en"):
        context = _context([106.0] * 8, lang, driver_attention=live)
        raw = _assessment(Severity.NORMAL, ["Take the car to a garage when convenient.", "Check the coolant."], "The engine is a little warm.")
        results[lang], _ = vehicle_agent.finalize(raw, context, [])
    vi, en = results["vi"], results["en"]
    assert en.severity == vi.severity == Severity.CRITICAL
    assert en.recommendations[0] == STOP_FOR_DRIVER_EN
    assert not any(suggests_garage_trip(step) for step in en.recommendations)
    assert en.diagnosis.startswith("The camera shows the driver has signs of drowsiness")
    assert any(line.startswith("Driver camera: signs of drowsiness, longest eye closure 2.6 s") for line in en.evidence)
    assert len(en.recommendations) == len(vi.recommendations)


def test_the_simulated_nominal_profile_answers_in_english() -> None:
    context = _context([90.0, 90.5, 90.2, 90.4, 90.1, 90.3, 90.2, 90.4], "en")
    assessment, _ = vehicle_agent.finalize(_assessment(Severity.WARNING, ["Check something."]), context, [])
    assert assessment.severity == Severity.NORMAL
    for text in (assessment.diagnosis, *assessment.evidence, *assessment.recommendations):
        _assert_english(text)


# ---------------------------------------------------------------- the services, end to end (rules only)

@pytest.fixture
def rules_only(monkeypatch):
    monkeypatch.setenv("AGENT_MODE", "rules")
    monkeypatch.delenv("COOLANT_WARN_C", raising=False)
    monkeypatch.setattr(voice, "announce_alert", lambda *args, **kwargs: None)


def test_the_driver_endpoint_answers_in_the_requested_language(rules_only) -> None:
    def post(lang):
        context = {"vehicleMoving": True, "vehicleId": "bmw-m2", "vehicle": {"source": "simulated", "capturedAt": _iso(1), "speedKmh": 65, "coolantC": 107}}
        if lang:
            context["lang"] = lang
        batch = {"schemaVersion": 1, "sessionId": f"session-lang-{lang or 'none'}", "source": "webcam", "context": context,
                 "events": [_event(0, "attentive"), _event(1, "drowsy", 2600)]}
        return DriverService().process(DriverBatch.model_validate(batch))

    default, vi, en = post(None), post("vi"), post("en")
    assert default["assessment"]["summary"] == vi["assessment"]["summary"]
    assert (en["assessment"]["severity"], en["guardian"]["action"], en["guardian"]["mustStop"]) == (vi["assessment"]["severity"], vi["guardian"]["action"], vi["guardian"]["mustStop"])
    for text in (en["assessment"]["summary"], *en["assessment"]["evidence"], *en["assessment"]["recommendations"]):
        _assert_english(text)


def test_the_blackbox_endpoint_answers_in_the_requested_language(rules_only) -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    client = TestClient(app)

    def post(lang):
        records = [{"capturedAt": _iso(i), "rpm": 2400, "map": 60, "tps": 30, "engineLoad": 50, "consumption": 8, "speed": 65,
                    "coolant": 106 + i * 0.1, "intake": 38, "battery": 13.9, "fan": 0, "location": {"lat": 10.8, "lon": 106.7}} for i in range(8)]
        body = {"schemaVersion": 1, "batchId": f"batch-lang-{lang}", "vehicleId": f"lang-{lang}", "source": "blackbox-simulator",
                "sampleIntervalMs": 1000, "recordCount": len(records), "records": records, "lang": lang}
        response = client.post("/api/telemetry/batch", json=body)
        assert response.status_code == 200, response.text
        return response.json()["assessment"]

    vi, en = post("vi"), post("en")
    assert en["severity"] == vi["severity"] == "warning"
    for text in (en["diagnosis"], *en["evidence"], *en["recommendations"], *en["suspected_faults"]):
        _assert_english(text)


# ---------------------------------------------------------------- the voice

@pytest.fixture
def blaze(monkeypatch, tmp_path):
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "vn-voice")
    monkeypatch.setenv("BLAZE_VOICE_DIR", str(tmp_path))
    monkeypatch.setattr(voice, "_spoken", {})
    monkeypatch.setattr(voice, "_clips", voice.deque(maxlen=50))
    monkeypatch.setattr(voice, "_critical_at", {})
    calls = []

    class _Inline:
        def submit(self, fn, *args):
            calls.append(args)
            return fn(*args)

    monkeypatch.setattr(voice, "_pool", lambda: _Inline())
    return calls


def test_the_spoken_lead_follows_the_language() -> None:
    assert voice.alert_script("Nước làm mát nóng.", "critical").startswith("Cảnh báo nguy hiểm.")
    assert voice.alert_script("Coolant is hot.", "critical", lang="en") == "Critical warning. Coolant is hot."
    assert voice.alert_script("Coolant is hot.", "warning", ["Ease off."], "en") == "Warning. Coolant is hot. Ease off."
    assert voice.alert_script("Warning: coolant is hot.", "warning", lang="en") == "Warning: coolant is hot."


def test_each_language_has_its_own_voice_and_no_voice_means_no_clip(blaze, monkeypatch) -> None:
    assert voice.enabled() and not voice.enabled("en"), "the English voice is set separately"
    voice.announce_alert("Coolant is hot.", severity="warning", dedupe_key="e1", session_id="bmw-m2", lang="en")
    assert blaze == [], "an English sentence is never read by the Vietnamese voice"
    monkeypatch.setenv("BLAZE_SPEAKER_ID_EN", "en-voice")
    monkeypatch.setenv("BLAZE_TTS_LANGUAGE_EN", "en-US")
    assert voice.enabled("en")
    client = voice._client_from_env("en")
    assert (client.speaker_id, client.language) == ("en-voice", "en-US")
    vietnamese = voice._client_from_env("vi")
    assert (vietnamese.speaker_id, vietnamese.language) == ("vn-voice", "vi")
    assert voice._client_from_env("en").model == voice._client_from_env("vi").model
    monkeypatch.setenv("BLAZE_TTS_MODEL_EN", "v3.0")
    assert voice._client_from_env("en").model == "v3.0" and voice._client_from_env("vi").model == "v2.0_flash"


def test_clips_are_listed_in_the_language_the_page_asks_for(blaze, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("BLAZE_SPEAKER_ID_EN", "en-voice")
    monkeypatch.setattr(voice.BlazeTTS, "synthesize", lambda self, text: voice.Speech(text=text, audio=b"ID3fake", content_type="audio/mpeg", job_id=f"job-{self.language}"))
    voice.announce_alert("Nước làm mát nóng.", severity="critical", dedupe_key="v", session_id="bmw-m2")
    voice.announce_alert("Coolant is hot.", severity="critical", dedupe_key="e", session_id="bmw-m2", lang="en")
    assert [c["lang"] for c in voice.clips_for("bmw-m2")] == ["vi", "en"]
    assert [c["text"] for c in voice.clips_for("bmw-m2", lang="en")] == ["Critical warning. Coolant is hot."]
    app = FastAPI()
    app.include_router(voice.router, prefix="/api")
    client = TestClient(app)
    english = client.get("/api/voice/clips?session=bmw-m2&lang=en").json()
    assert english["enabled"] is True and english["lang"] == "en" and [c["lang"] for c in english["clips"]] == ["en"]
    default = client.get("/api/voice/clips?session=bmw-m2").json()
    assert [c["lang"] for c in default["clips"]] == ["vi"]
    monkeypatch.setenv("BLAZE_SPEAKER_ID_EN", "")
    assert client.get("/api/voice/clips?session=bmw-m2&lang=en").json()["enabled"] is False
    assert client.get("/api/voice/clips?session=bmw-m2&lang=fr").status_code == 422
