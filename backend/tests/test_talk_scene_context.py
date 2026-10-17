"""Conversation context and demo policy, without provider calls or persistent data."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import talk
from driver.registry import driver_registry
from situation import clear_situations, remember_vehicle_situation
from stt import append_turn, load_conversation


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BLAZE_CONVERSATION_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setattr(talk, "speak_line", lambda *args, **kwargs: False)
    talk.clear_turns()
    clear_situations()
    driver_registry.clear()
    app = FastAPI()
    app.include_router(talk.router, prefix="/api")
    yield TestClient(app)
    talk.clear_turns()
    clear_situations()
    driver_registry.clear()


def post(client, conversation, text, generation=1, **extra):
    return client.post("/api/voice/talk", data={
        "sessionId": "scene-car", "lang": "en", "text": text,
        "conversationId": conversation, "turnId": f"turn-{generation}",
        "generation": generation, **extra,
    })


def test_new_scene_excludes_old_model_history_and_keeps_its_own_followups(client, monkeypatch):
    scripts = []
    def model(_session, _lang, brief):
        scripts.append(brief["_script"])
        return "Fixture answer."
    monkeypatch.setattr(talk, "_model_reply", model)
    monkeypatch.setattr(talk, "situation", lambda _: {"fresh": True, "must_stop": False})
    append_turn("scene-car", role="agent", text="Legacy alert from an earlier scene", source="tts")
    assert post(client, "warning-scene", "Warning question").status_code == 200
    assert [t["text"] for t in scripts[-1]] == ["Warning question"]
    first_normal = post(client, "normal-scene", "Normal question")
    assert first_normal.status_code == 200
    assert [t["text"] for t in scripts[-1]] == ["Normal question"]
    assert [t["text"] for t in first_normal.json()["conversation"]["turns"]] == ["Normal question", "Fixture answer."]
    assert post(client, "normal-scene", "Follow-up", 2).status_code == 200
    assert [t["text"] for t in scripts[-1]] == ["Normal question", "Fixture answer.", "Follow-up"]
    # Changing context never deletes the vehicle's rehearsal log.
    assert "Warning question" in [t["text"] for t in load_conversation("scene-car")["turns"]]


@pytest.mark.parametrize("lang", ["vi", "en"])
def test_actual_three_scene_rules_and_guard(client, monkeypatch, lang):
    monkeypatch.setenv("AGENT_MODE", "rules")
    def ask(scene):
        result = post(client, scene, "Xe bây giờ thế nào?" if lang == "vi" else "How is the car now?", lang=lang)
        assert result.status_code == 200
        return result.json()["reply"]
    remember_vehicle_situation("scene-car", {"severity": "warning", "diagnosis": "Coolant is above the warning line."}, [], {"code": "garage_when_convenient"})
    driver_registry.update("scene-car", {"attention": "attentive", "must_stop": False})
    warning = ask("warning")
    assert "Coolant" in warning
    assert not talk.situation("scene-car")["must_stop"]
    driver_registry.update("scene-car", {"attention": "drowsy", "severity": "critical", "must_stop": True})
    drowsy = ask("drowsy")
    assert drowsy == talk._STOP[lang]
    # Even an unsafe model suggestion cannot override the drowsy stop.
    monkeypatch.setenv("AGENT_MODE", "openai")
    monkeypatch.setattr(talk, "_model_reply", lambda *a: "Cứ lái tới garage." if lang == "vi" else "Keep driving to the garage.")
    assert ask("drowsy-model") == talk._STOP[lang]
    monkeypatch.setenv("AGENT_MODE", "rules")
    driver_registry.update("scene-car", {"attention": "attentive", "severity": "normal", "must_stop": False})
    remember_vehicle_situation("scene-car", {"severity": "normal", "diagnosis": "Coolant is 90 C and stable."}, [], None)
    normal = ask("normal")
    assert ("bình thường" if lang == "vi" else "normal") in normal
    assert "90" in normal and normal != drowsy and "warning line" not in normal
