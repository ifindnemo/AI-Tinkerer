"""The person picks which Blaze voice reads the agent, per language."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import voice
import voice_options

OPTIONS = {"speakers": [
    {"id": "HN-Nar-Nu-PhuongLy", "name": "Phương Ly", "language": "vi", "gender": "Female", "type": "Narration", "category": "community"},
    {"id": "HN-Nu-1-TM", "name": "BTV Hương Giang", "language": "vi", "gender": "Female", "type": "Narration", "category": "blaze"},
    {"id": "UK-Nu-1-TM", "name": "BTV Helen", "language": "en", "gender": "Female", "type": "Narration", "category": "blaze"},
    {"id": "UK-Nam-2-TM", "name": "BTV Endy", "language": "en", "gender": "Male", "type": "Narration", "category": "blaze"},
    {"id": "Pod-Male-AdamAdam", "name": "Adam Adam", "language": "en", "gender": "Male", "type": "Podcast", "category": "community"},
    {"id": "ZH-Female-KieuVan", "name": "Kiều Vân", "language": "zh", "gender": "Female", "type": "Narration", "category": "community"},
]}


class _Response:
    def __init__(self, payload=None, content=b"", content_type="application/json"):
        self._payload, self.content, self.headers = payload, content, {"content-type": content_type}

    def raise_for_status(self) -> None:
        pass

    def json(self):
        return self._payload


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("BLAZE_API_TOKEN", "test-token")
    monkeypatch.setenv("BLAZE_SPEAKER_ID", "HN-Nar-Nu-PhuongLy")
    monkeypatch.delenv("BLAZE_SPEAKER_ID_EN", raising=False)
    monkeypatch.setenv("BLAZE_VOICE_PREFERENCE_FILE", str(tmp_path / "preference.json"))
    monkeypatch.setattr(voice_options, "_catalogue", {"at": 0.0, "voices": None})
    asked = []

    def fake_get(url, **_):
        asked.append(url)
        return _Response(content=b"ID3audio", content_type="audio/mpeg") if url.endswith("/preview") else _Response(OPTIONS)

    monkeypatch.setattr(voice_options.httpx, "get", fake_get)
    app = FastAPI()
    app.include_router(voice_options.router, prefix="/api")
    test_client = TestClient(app)
    test_client.asked = asked
    return test_client


def test_english_defaults_to_helen_and_vietnamese_to_the_configured_voice(client) -> None:
    english = client.get("/api/voice/voices?lang=en").json()
    assert english["selected"] == english["default"] == "UK-Nu-1-TM" and english["enabled"] is True
    assert [v["id"] for v in english["voices"]] == ["UK-Nu-1-TM", "UK-Nam-2-TM", "Pod-Male-AdamAdam"]  # Blaze voices first, other languages never
    vietnamese = client.get("/api/voice/voices?lang=vi").json()
    assert vietnamese["selected"] == "HN-Nar-Nu-PhuongLy"
    assert "HN-Nar-Nu-PhuongLy" in [v["id"] for v in vietnamese["voices"]], "the configured voice is always offered"


def test_a_choice_is_used_by_the_speaker_and_survives_until_reset(client) -> None:
    assert client.put("/api/voice/voice", json={"lang": "en", "voice_id": "UK-Nam-2-TM"}).json()["selected"] == "UK-Nam-2-TM"
    assert voice.selected("en") == "UK-Nam-2-TM" and voice._client_from_env("en").speaker_id == "UK-Nam-2-TM"
    assert voice.selected("vi") == "HN-Nar-Nu-PhuongLy", "the other language is untouched"
    assert client.put("/api/voice/voice", json={"lang": "vi", "voice_id": "HN-Nu-1-TM"}).json()["selected"] == "HN-Nu-1-TM"
    assert voice._client_from_env("vi").speaker_id == "HN-Nu-1-TM"
    reset = client.put("/api/voice/voice", json={"lang": "en", "voice_id": None}).json()
    assert reset["selected"] == "UK-Nu-1-TM" and voice.selected("vi") == "HN-Nu-1-TM"


def test_only_a_voice_blaze_lists_for_that_language_can_be_chosen(client) -> None:
    for body in ({"lang": "en", "voice_id": "HN-Nu-1-TM"},  # a Vietnamese voice for English
                 {"lang": "en", "voice_id": "../../etc/passwd"},
                 {"lang": "fr", "voice_id": "UK-Nu-1-TM"},
                 {"lang": "en", "voice_id": "UK-Nu-1-TM", "extra": 1}):
        assert client.put("/api/voice/voice", json=body).status_code == 422, body
    assert client.put("/api/voice/voice", json={"lang": "en", "voice_id": "ZH-Female-KieuVan"}).status_code == 422
    assert voice.selected("en") == "UK-Nu-1-TM"


def test_the_preview_is_only_for_listed_voices(client) -> None:
    ok = client.get("/api/voice/voices/UK-Nu-1-TM/preview?lang=en")
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/mpeg" and ok.content == b"ID3audio"
    assert client.get("/api/voice/voices/HN-Nu-1-TM/preview?lang=en").status_code == 404
    assert not any("HN-Nu-1-TM" in url and url.endswith("/preview") for url in client.asked)


def test_without_blaze_the_defaults_are_still_offered_and_nothing_is_enabled(client, monkeypatch) -> None:
    def down(*_, **__):
        raise OSError("offline")

    monkeypatch.setattr(voice_options.httpx, "get", down)
    english = client.get("/api/voice/voices?lang=en").json()
    assert [v["id"] for v in english["voices"]] == ["UK-Nu-1-TM"]
    monkeypatch.setenv("BLAZE_API_TOKEN", "")
    assert client.get("/api/voice/voices?lang=en").json()["enabled"] is False
    assert client.get("/api/voice/voices/UK-Nu-1-TM/preview?lang=en").status_code == 404
