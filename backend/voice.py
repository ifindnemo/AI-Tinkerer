"""Speak an agent warning with Blaze Voice AI.

Blaze batch TTS (https://api.blaze.vn, documented June 2026):

    POST /v1/tts
    Authorization: Bearer $BLAZE_API_TOKEN
    {"query", "language", "speaker_id", "model", "audio_format"}
    -> 202 and a job id

    GET /v1/tts/{id}            poll until the job finishes
    GET /v1/tts/{id}/download   audio bytes

`announce_alert` is what the vehicle agent and the driver agent call after a
warning or critical assessment. It returns immediately. Synthesis runs on one
background worker, and a failure never changes the assessment.

The alert is spoken in the language it is written in ("vi" or "en"). Each language has
its own Blaze voice: BLAZE_SPEAKER_ID (Vietnamese) and BLAZE_SPEAKER_ID_EN (English, with
BLAZE_TTS_LANGUAGE_EN, default "en"). A language without a voice is not spoken at all:
an English sentence is never read by a Vietnamese voice.
"""

import itertools
import logging
import os
import re
import threading
import time
from collections import deque
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from lang import normalize

log = logging.getLogger("car_neuron.voice")

BLAZE_BASE_URL = "https://api.blaze.vn"
ALERT_SEVERITIES = frozenset({"warning", "critical"})
DONE_STATES = frozenset({"completed", "complete", "succeeded", "success", "done", "finished"})
FAILED_STATES = frozenset({"failed", "error", "cancelled", "canceled"})
_ID_KEYS = ("id", "job_id", "request_id", "task_id")
_STATUS_KEYS = ("status", "state")
_URL_KEYS = ("audio_url", "download_url", "file_url", "audio_link", "url")
_REPEAT_SECONDS = 90.0
_MAX_CHARS = 500

_SPOKEN_CHARS = 260  # a spoken alert stays short: the first sentences, then one step

_lock = threading.Lock()
_spoken: dict[str, float] = {}
# Finished clips the browser can play (newest last). In memory: a restart forgets them.
_clips: deque[dict[str, Any]] = deque(maxlen=50)
# When each session last had a critical alert queued: a warning that arrives later (its wording
# was slower) is outdated and must not be spoken after the critical one.
_critical_at: dict[str, float] = {}
_clip_seq = itertools.count(1)
_missing_logged = False
_missing_logged_en = False
_executor: ThreadPoolExecutor | None = None


class BlazeError(RuntimeError):
    """Blaze rejected the request or the job failed."""


@dataclass(frozen=True)
class Speech:
    text: str
    audio: bytes
    content_type: str
    job_id: str


def alert_script(text: str, severity: str, recommendations: Sequence[str] | None = None, lang: str = "vi") -> str:
    """Short line for the driver, in `lang`. The lead states the severity once."""
    body = _first_sentences(" ".join(text.split()).strip(), _SPOKEN_CHARS)
    if not body:
        raise ValueError("alert text is empty")
    if normalize(lang) == "en":
        lead = "Critical warning." if severity == "critical" else "Warning."
        spoken = body if body.lower().startswith(("warning", "critical", "alert", "caution")) else f"{lead} {body}"
    else:
        lead = "Cảnh báo nguy hiểm." if severity == "critical" else "Cảnh báo."
        spoken = body if body.lower().startswith("cảnh báo") else f"{lead} {body}"
    if recommendations:
        step = " ".join(str(recommendations[0]).split()).strip().rstrip(".")
        if step and step.lower() not in spoken.lower():
            spoken = f"{spoken.rstrip('. ')}. {step}."
    return spoken[:_MAX_CHARS]


def _first_sentences(text: str, limit: int) -> str:
    """Whole sentences up to `limit` characters, so speech never stops mid-word."""
    if len(text) <= limit:
        return text
    out = ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if out and len(out) + 1 + len(sentence) > limit:
            break
        out = f"{out} {sentence}".strip()
        if len(out) >= limit:
            break
    return out[:limit]


def announce_alert(
    text: str,
    *,
    severity: str,
    recommendations: Sequence[str] | None = None,
    dedupe_key: str | None = None,
    session_id: str | None = None,
    lang: str = "vi",
) -> None:
    """Queue TTS for a warning or critical alert. No-op for any other severity, and for a language
    that has no voice configured.

    Never raises: a voice failure must not change the assessment that triggered it.
    """
    try:
        lang = normalize(lang)
        if severity not in ALERT_SEVERITIES or not _configured(lang):
            return
        if severity == "warning" and session_id and _recently_critical(session_id):
            return
        script = alert_script(text, severity, recommendations, lang)
        key = dedupe_key or f"{severity}:{script}"
        if not _claim(key):
            return
        if severity == "critical" and session_id:
            with _lock:
                _critical_at[session_id] = time.monotonic()
        _pool().submit(_speak, script, severity, key, session_id, lang)
    except Exception:
        log.warning("could not queue Blaze TTS", exc_info=True)


class BlazeTTS:
    """One-shot client for POST /v1/tts plus the documented download poll."""

    def __init__(
        self,
        *,
        token: str,
        speaker_id: str,
        model: str = "v2.0_flash",
        language: str = "vi",
        audio_format: str = "mp3",
        base_url: str = BLAZE_BASE_URL,
        timeout: float = 20.0,
        poll_interval: float = 0.4,
        client: httpx.Client | None = None,
    ) -> None:
        self.speaker_id = speaker_id
        self.model = model
        self.language = language
        self.audio_format = audio_format
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=min(15.0, timeout))
        self._headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "BlazeTTS":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def synthesize(self, text: str) -> Speech:
        response = self._client.post(
            f"{self.base_url}/v1/tts",
            headers=self._headers,
            json={
                "query": text,
                "language": self.language,
                "speaker_id": self.speaker_id,
                "model": self.model,
                "audio_format": self.audio_format,
            },
        )
        _raise_for_status(response)
        payload = _json_or_none(response) or {}
        job_id = _find(payload, _ID_KEYS) or ""
        ready = self._take_audio(response) or self._follow_url(payload)
        if ready is None:
            if not job_id:
                raise BlazeError("Blaze TTS did not return a job id")
            ready = self._wait(job_id)
        audio, content_type = ready
        return Speech(text=text, audio=audio, content_type=content_type, job_id=job_id)

    def _wait(self, job_id: str) -> tuple[bytes, str]:
        deadline = time.monotonic() + self.timeout
        status_url = f"{self.base_url}/v1/tts/{job_id}"
        download_url = f"{status_url}/download"
        while True:
            response = self._optional_get(status_url)
            if response is None or (_json_or_none(response) is None and not _looks_like_audio(response)):
                response = self._optional_get(download_url)
            if response is not None:
                payload = _json_or_none(response)
                state = _state(payload) if payload else None
                if state in FAILED_STATES:
                    raise BlazeError(_error_message(payload, job_id))
                if payload is None or state in DONE_STATES or state is None:
                    ready = self._take_audio(response) or self._follow_url(payload)
                    if ready is not None:
                        return ready
                if state in DONE_STATES:
                    downloaded = self._optional_get(download_url)
                    if downloaded is not None:
                        ready = self._take_audio(downloaded)
                        if ready is not None:
                            return ready
            if time.monotonic() >= deadline:
                raise BlazeError(f"Blaze TTS job {job_id} was not ready within {self.timeout:.0f}s")
            time.sleep(self.poll_interval)

    def _optional_get(self, url: str) -> httpx.Response | None:
        """None means not ready yet: 404, 425 Too Early (what Blaze's /download answers while the
        audio is still processing, observed 2026-10-11) or a transient 429/5xx. Other errors raise."""
        response = self._get(url)
        if response.status_code in (404, 425, 429) or response.status_code >= 500:
            return None
        _raise_for_status(response)
        return response

    def _follow_url(self, payload: dict[str, Any] | None) -> tuple[bytes, str] | None:
        if not payload:
            return None
        state = _state(payload)
        linked = _audio_url(payload)
        if not linked or (state not in DONE_STATES and state is not None):
            return None
        downloaded = self._optional_get(linked)
        if downloaded is None:
            return None
        return self._take_audio(downloaded)

    def _take_audio(self, response: httpx.Response) -> tuple[bytes, str] | None:
        if _json_or_none(response) is None and response.content and _looks_like_audio(response):
            content_type = response.headers.get("content-type", _content_type(self.audio_format)).split(";")[0]
            return response.content, content_type
        return None

    def _get(self, url: str) -> httpx.Response:
        absolute = url if url.startswith("http") else urljoin(self.base_url + "/", url.lstrip("/"))
        headers = self._headers if absolute.startswith(self.base_url) else {}
        return self._client.get(absolute, headers=headers)


def _speak(script: str, severity: str, key: str, session_id: str | None = None, lang: str = "vi") -> None:
    try:
        with _client_from_env(lang) as client:
            speech = client.synthesize(script)
        path = _write(speech, severity)
        _register(session_id, severity, script, path, speech.content_type, lang)
        log.info("spoke %s alert (%s bytes) %s", severity, len(speech.audio), path)
    except Exception:
        log.warning("Blaze TTS failed for a %s alert", severity, exc_info=True)
        _release(key)
        return
    if not session_id:
        return
    try:
        from stt import append_turn

        append_turn(session_id, role="agent", text=script, source="tts", severity=severity)
    except Exception:
        log.warning("could not store the spoken turn", exc_info=True)


def _client_from_env(lang: str = "vi") -> BlazeTTS:
    english = normalize(lang) == "en"
    model = os.getenv("BLAZE_TTS_MODEL", "v2.0_flash").strip() or "v2.0_flash"
    return BlazeTTS(
        token=os.environ["BLAZE_API_TOKEN"].strip(),
        speaker_id=os.environ["BLAZE_SPEAKER_ID_EN" if english else "BLAZE_SPEAKER_ID"].strip(),
        model=(os.getenv("BLAZE_TTS_MODEL_EN", "").strip() or model) if english else model,
        language=(os.getenv("BLAZE_TTS_LANGUAGE_EN", "en").strip() or "en") if english else (os.getenv("BLAZE_TTS_LANGUAGE", "vi").strip() or "vi"),
        audio_format=os.getenv("BLAZE_AUDIO_FORMAT", "mp3").strip() or "mp3",
        base_url=os.getenv("BLAZE_BASE_URL", BLAZE_BASE_URL).strip() or BLAZE_BASE_URL,
        timeout=float(os.getenv("BLAZE_TTS_TIMEOUT_SECONDS", "20")),
    )


def _write(speech: Speech, severity: str) -> Path:
    directory = Path(os.getenv("BLAZE_VOICE_DIR", Path(__file__).resolve().parent / "var" / "voice"))
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%S")
    job = "".join(ch for ch in speech.job_id if ch.isalnum() or ch in "-_")[:40] or "audio"
    path = directory / f"{severity}-{stamp}-{job}.{_extension(speech.content_type)}"
    path.write_bytes(speech.audio)
    return path


def _speaker_variable(lang: str) -> str:
    return "BLAZE_SPEAKER_ID_EN" if normalize(lang) == "en" else "BLAZE_SPEAKER_ID"


def _configured(lang: str = "vi") -> bool:
    global _missing_logged, _missing_logged_en
    if enabled(lang):
        return True
    english = normalize(lang) == "en"
    if not (_missing_logged_en if english else _missing_logged):
        log.info("Blaze TTS (%s) is off until BLAZE_API_TOKEN and %s are set", "en" if english else "vi", _speaker_variable(lang))
        if english:
            _missing_logged_en = True
        else:
            _missing_logged = True
    return False


def _recently_critical(session_id: str) -> bool:
    with _lock:
        return time.monotonic() - _critical_at.get(session_id, float("-inf")) < _REPEAT_SECONDS


def _claim(key: str) -> bool:
    now = time.monotonic()
    with _lock:
        if now < _spoken.get(key, 0):
            return False
        _spoken[key] = now + _REPEAT_SECONDS
    return True


def _release(key: str) -> None:
    with _lock:
        _spoken.pop(key, None)


def _pool() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="blaze-tts")
        return _executor


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code == 429 or response.status_code >= 500:
        raise BlazeError(f"Blaze TTS is unavailable ({response.status_code})")
    if response.status_code >= 400:
        payload = _json_or_none(response)
        message = _error_message(payload, "") if payload else ""
        raise BlazeError(message or f"Blaze TTS rejected the request ({response.status_code})")


def _json_or_none(response: httpx.Response) -> dict[str, Any] | None:
    content_type = response.headers.get("content-type", "")
    if "json" not in content_type and not response.content.lstrip().startswith(b"{"):
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _find(payload: dict[str, Any], keys: tuple[str, ...], depth: int = 0) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            if key == "url" and not value.startswith("http") and not value.startswith("/"):
                continue
            return value.strip()
    if depth >= 3:
        return None
    for value in payload.values():
        if isinstance(value, dict):
            found = _find(value, keys, depth + 1)
            if found:
                return found
    return None


def _state(payload: dict[str, Any]) -> str | None:
    found = _find(payload, _STATUS_KEYS)
    return found.lower() if found else None


def _audio_url(payload: dict[str, Any]) -> str | None:
    return _find(payload, _URL_KEYS)


def _error_message(payload: dict[str, Any] | None, job_id: str) -> str:
    if not payload:
        return f"Blaze TTS job {job_id} failed" if job_id else "Blaze TTS request failed"
    raw = payload.get("message") or payload.get("error") or payload.get("detail")
    if isinstance(raw, dict):
        raw = raw.get("message") or raw.get("detail")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:200]
    if job_id:
        return f"Blaze TTS job {job_id} failed"
    return "Blaze TTS request failed"


def _looks_like_audio(response: httpx.Response) -> bool:
    content_type = response.headers.get("content-type", "")
    if content_type.startswith("audio/") or content_type.startswith("application/octet-stream"):
        return True
    data = response.content[:12]
    return data.startswith((b"ID3", b"RIFF", b"OggS", b"fLaC")) or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")


def _content_type(audio_format: str) -> str:
    if audio_format == "wav":
        return "audio/wav"
    if audio_format == "mp3":
        return "audio/mpeg"
    return "application/octet-stream"


def _extension(content_type: str) -> str:
    if "wav" in content_type:
        return "wav"
    if "mpeg" in content_type or "mp3" in content_type:
        return "mp3"
    return "bin"


def enabled(lang: str = "vi") -> bool:
    """Whether alerts can be spoken in `lang` (a token and that language's voice are set)."""
    return bool(os.getenv("BLAZE_API_TOKEN", "").strip() and os.getenv(_speaker_variable(lang), "").strip())


def _register(session_id: str | None, severity: str, text: str, path: Path, content_type: str, lang: str = "vi") -> dict[str, Any]:
    clip = {
        "id": f"clip_{next(_clip_seq)}",
        "session": session_id or "",
        "lang": normalize(lang),
        "severity": severity,
        "text": text,
        "content_type": content_type,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "_path": path,
    }
    clip["seq"] = int(clip["id"].split("_")[1])
    with _lock:
        _clips.append(clip)
    return clip


def clips_for(session_id: str, after: int = 0, lang: str | None = None) -> list[dict[str, Any]]:
    """Clips of a session newer than `after`; with `lang`, only those spoken in that language."""
    with _lock:
        return [
            {k: v for k, v in c.items() if not k.startswith("_")}
            for c in _clips
            if c["session"] == session_id and c["seq"] > after and (lang is None or c.get("lang", "vi") == lang)
        ]


router = APIRouter()
_SESSION = r"^[\w-]{1,64}$"


@router.get("/voice/clips", tags=["voice"])
def list_clips(session: str = Query(pattern=_SESSION), after: int = Query(0, ge=0), lang: str = Query("vi", pattern=r"^(vi|en)$")) -> dict[str, Any]:
    """Spoken alerts for a session (a vehicle id on the garage page), newer than `after`, in `lang`.
    `enabled` says whether that language has a voice: the page tells the person when it does not."""
    with _lock:
        latest = max((c["seq"] for c in _clips), default=0)
    return {"enabled": enabled(lang), "lang": lang, "latest": latest, "clips": clips_for(session, after, lang)}


@router.get("/voice/clips/{clip_id}/audio", tags=["voice"])
def clip_audio(clip_id: str) -> FileResponse:
    with _lock:
        clip = next((c for c in _clips if c["id"] == clip_id), None)
    if clip is None or not Path(clip["_path"]).is_file():
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(clip["_path"], media_type=clip["content_type"])
