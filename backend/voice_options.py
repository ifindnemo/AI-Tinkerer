"""Which Blaze voice reads the agent's alerts, per language, chosen by the person on the page.

Defaults: Vietnamese keeps `BLAZE_SPEAKER_ID` from the environment; English is Helen ("BTV Helen",
`UK-Nu-1-TM`) unless `BLAZE_SPEAKER_ID_EN` names another. The choice is stored in a small JSON file so
it survives a restart, applies to every path that speaks (API batch, camera, OBD device) and can only be
a voice Blaze lists for that language. The catalogue is Blaze's own `GET /v1/tts/options`, cached for an
hour; without the network the defaults are still offered.
"""

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from lang import normalize

log = logging.getLogger("car_neuron.voice")

DEFAULT_SPEAKER_EN = "UK-Nu-1-TM"  # BTV Helen
_FALLBACK = {
    "vi": [{"id": "HN-Nar-Nu-PhuongLy", "name": "Phương Ly", "gender": "Female", "type": "Narration", "category": "blaze"}],
    "en": [{"id": DEFAULT_SPEAKER_EN, "name": "BTV Helen", "gender": "Female", "type": "Narration", "category": "blaze"}],
}
_CACHE_SECONDS = 3600
_PREVIEW_ID = r"^[\w.-]{1,80}$"

_lock = threading.Lock()
_catalogue: dict[str, Any] = {"at": 0.0, "voices": None}


def _base_url() -> str:
    return (os.getenv("BLAZE_BASE_URL", "https://api.blaze.vn").strip() or "https://api.blaze.vn").rstrip("/")


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {os.getenv('BLAZE_API_TOKEN', '').strip()}"}


def env_default(lang: str) -> str:
    if normalize(lang) == "en":
        return os.getenv("BLAZE_SPEAKER_ID_EN", "").strip() or DEFAULT_SPEAKER_EN
    return os.getenv("BLAZE_SPEAKER_ID", "").strip()


def _preference_file() -> Path:
    configured = os.getenv("BLAZE_VOICE_PREFERENCE_FILE", "").strip()
    return Path(configured) if configured else Path(__file__).resolve().parent / "var" / "voice_preference.json"


def _read_preferences() -> dict[str, str]:
    try:
        data = json.loads(_preference_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {key: value for key, value in data.items() if key in ("vi", "en") and isinstance(value, str) and value} if isinstance(data, dict) else {}


def selected(lang: str) -> str:
    """The voice id for `lang`: the person's choice, else the default. Empty when none is configured."""
    return _read_preferences().get(normalize(lang)) or env_default(lang)


def _store(lang: str, voice_id: str | None) -> None:
    preferences = _read_preferences()
    if voice_id is None or voice_id == env_default(lang):
        preferences.pop(normalize(lang), None)  # back to the default: nothing to remember
    else:
        preferences[normalize(lang)] = voice_id
    path = _preference_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(preferences), encoding="utf-8")


def _fetch_catalogue() -> list[dict[str, Any]]:
    response = httpx.get(f"{_base_url()}/v1/tts/options", headers=_headers(), timeout=10)
    response.raise_for_status()
    voices = []
    for item in response.json().get("speakers", []):
        if not isinstance(item, dict) or not item.get("id") or item.get("language") not in ("vi", "en"):
            continue
        voices.append({key: item.get(key) for key in ("id", "name", "language", "gender", "type", "category")})
    return voices


def _all_voices() -> list[dict[str, Any]]:
    if not os.getenv("BLAZE_API_TOKEN", "").strip():
        return [{**voice, "language": lang} for lang, items in _FALLBACK.items() for voice in items]
    with _lock:
        fresh = _catalogue["voices"] is not None and time.monotonic() - _catalogue["at"] < _CACHE_SECONDS
        if fresh:
            return _catalogue["voices"]
    try:
        voices = _fetch_catalogue()
    except Exception:
        log.warning("could not list the Blaze voices; the defaults are offered", exc_info=True)
        return [{**voice, "language": lang} for lang, items in _FALLBACK.items() for voice in items]
    with _lock:
        _catalogue.update(at=time.monotonic(), voices=voices)
    return voices


def voices_for(lang: str) -> list[dict[str, Any]]:
    """Voices to choose from: Blaze's own for the language, English community voices too, and the
    current choice and default even when they are not in that list. The default first, then Blaze voices."""
    lang = normalize(lang)
    wanted = {"blaze", "community"} if lang == "en" else {"blaze"}
    voices = [v for v in _all_voices() if v.get("language") == lang and v.get("category") in wanted]
    known = {v["id"] for v in voices}
    everything = {v["id"]: v for v in _all_voices()}
    for voice_id in (env_default(lang), selected(lang)):
        if voice_id and voice_id not in known:
            voices.append(everything.get(voice_id) or {"id": voice_id, "name": voice_id, "language": lang, "gender": None, "type": None, "category": "configured"})
            known.add(voice_id)
    order = {"blaze": 0, "configured": 1, "community": 2}
    default = env_default(lang)
    return sorted(voices, key=lambda v: (v["id"] != default, order.get(v.get("category"), 3), str(v.get("name"))))


router = APIRouter()
_LANG = r"^(vi|en)$"


class VoiceChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lang: str = Field(pattern=_LANG)
    voice_id: str | None = Field(default=None, pattern=_PREVIEW_ID)  # null: back to the default


@router.get("/voice/voices", tags=["voice"])
def list_voices(lang: str = Query("vi", pattern=_LANG)) -> dict[str, Any]:
    chosen = selected(lang)
    return {
        "lang": lang,
        "selected": chosen,
        "default": env_default(lang),
        "enabled": bool(os.getenv("BLAZE_API_TOKEN", "").strip() and chosen),
        "voices": [{key: v.get(key) for key in ("id", "name", "gender", "type", "category")} for v in voices_for(lang)],
    }


@router.put("/voice/voice", tags=["voice"])
def choose_voice(choice: VoiceChoice) -> dict[str, Any]:
    if choice.voice_id is not None and choice.voice_id not in {v["id"] for v in voices_for(choice.lang)}:
        raise HTTPException(status_code=422, detail="Unknown voice for this language")
    _store(choice.lang, choice.voice_id)
    return list_voices(choice.lang)


@router.get("/voice/voices/{voice_id}/preview", tags=["voice"])
def preview_voice(voice_id: str, lang: str = Query("vi", pattern=_LANG)) -> Response:
    """A few seconds of the voice, so the person can hear it before choosing. Only listed voices."""
    if not os.getenv("BLAZE_API_TOKEN", "").strip():
        raise HTTPException(status_code=404, detail="Voice is not configured")
    if voice_id not in {v["id"] for v in voices_for(lang)}:
        raise HTTPException(status_code=404, detail="Unknown voice")
    try:
        response = httpx.get(f"{_base_url()}/v1/tts/voices/{voice_id}/preview", headers=_headers(), timeout=15, follow_redirects=True)
        response.raise_for_status()
    except Exception as error:
        raise HTTPException(status_code=502, detail="The voice preview is unavailable") from error
    return Response(response.content, media_type=response.headers.get("content-type", "audio/mpeg"), headers={"Cache-Control": "private, max-age=3600"})
