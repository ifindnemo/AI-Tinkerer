"""Listen to audio, transcribe it with Blaze, and keep a temporary conversation file.

Blaze speech-to-text (https://api.blaze.vn, documented June 2026):

    POST /v1/stt/execute?language=vi&model=stt-async-1.5
    Authorization: Bearer $BLAZE_API_TOKEN
    multipart field audio_file
    -> {"result": {"data": {"transcription": "..."}}}

Each final transcript is appended to var/conversations/<session>.json. That file
is the short-term conversation: driver turns come from this module, and the
spoken agent warning is appended by voice.py after TTS succeeds. The file is
capped and is not the vehicle database.
"""

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

log = logging.getLogger("car_neuron.stt")

BLAZE_BASE_URL = "https://api.blaze.vn"
DEFAULT_MODEL = "stt-async-1.5"
MAX_AUDIO_BYTES = 15 * 1024 * 1024
MAX_TURNS = 100
MAX_TURN_CHARS = 4000
_AUDIO_TYPES = frozenset({
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "video/webm",
    "application/octet-stream",
})
DONE_STATES = frozenset({"completed", "complete", "succeeded", "success", "done", "finished"})
FAILED_STATES = frozenset({"failed", "error", "cancelled", "canceled"})
_ID_KEYS = ("id", "job_id", "request_id", "task_id")
_STATUS_KEYS = ("status", "state")

_lock = threading.Lock()
router = APIRouter()


class BlazeSttError(RuntimeError):
    """Blaze rejected the audio or the transcription job failed."""


def transcribe(audio: bytes, *, filename: str, content_type: str) -> str:
    """Send one audio clip to Blaze and return the transcript. Empty when the clip has no speech."""
    token = os.getenv("BLAZE_API_TOKEN", "").strip()
    if not token:
        raise BlazeSttError("BLAZE_API_TOKEN is not configured")
    if not audio:
        raise BlazeSttError("audio is empty")
    with BlazeSTT(
        token=token,
        model=os.getenv("BLAZE_STT_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        language=_language(),
        base_url=os.getenv("BLAZE_BASE_URL", BLAZE_BASE_URL).strip() or BLAZE_BASE_URL,
        timeout=float(os.getenv("BLAZE_STT_TIMEOUT_SECONDS", "30")),
    ) as client:
        return client.transcribe(audio, filename=filename, content_type=content_type)


def append_turn(session_id: str, *, role: str, text: str, source: str, severity: str | None = None) -> dict[str, Any]:
    """Append one turn to the session JSON file and return the stored turn."""
    if role not in ("driver", "agent"):
        raise ValueError("role must be driver or agent")
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        raise ValueError("turn text is empty")
    turn: dict[str, Any] = {
        "id": f"turn_{uuid4().hex[:12]}",
        "role": role,
        "text": cleaned[:MAX_TURN_CHARS],
        "at": datetime.now(timezone.utc).isoformat(),
        "source": source,
    }
    if severity in ("warning", "critical"):
        turn["severity"] = severity
    path = _conversation_path(session_id)
    with _lock:
        document = _read(path, _safe_session(session_id))
        document["turns"].append(turn)
        document["turns"] = document["turns"][-MAX_TURNS:]
        document["updatedAt"] = turn["at"]
        _write(path, document)
    return turn


def load_conversation(session_id: str) -> dict[str, Any]:
    """Read the temporary conversation. A new session is an empty turn list."""
    safe = _safe_session(session_id)
    path = _conversation_dir() / f"{safe}.json"
    with _lock:
        if not path.exists():
            return {"sessionId": safe, "updatedAt": None, "turns": []}
        return _read(path, safe)


class BlazeSTT:
    """Client for POST /v1/stt/execute. Polls when Blaze returns a job instead of text."""

    def __init__(
        self,
        *,
        token: str,
        model: str = DEFAULT_MODEL,
        language: str = "vi",
        base_url: str = BLAZE_BASE_URL,
        timeout: float = 30.0,
        poll_interval: float = 0.4,
        client: httpx.Client | None = None,
    ) -> None:
        self.model = model
        self.language = language
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=min(30.0, timeout))
        self._headers = {"Authorization": f"Bearer {token}"}

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "BlazeSTT":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def transcribe(self, audio: bytes, *, filename: str, content_type: str) -> str:
        response = self._client.post(
            f"{self.base_url}/v1/stt/execute",
            headers=self._headers,
            params={"language": self.language, "model": self.model},
            files={"audio_file": (filename or "audio.wav", audio, content_type or "application/octet-stream")},
        )
        _raise_for_status(response)
        payload = _json(response)
        text = _transcription(payload)
        state = _state(payload)
        if text and (state is None or state in DONE_STATES):
            return text
        if state in FAILED_STATES:
            raise BlazeSttError(_error_message(payload))
        job_id = _find(payload, _ID_KEYS)
        if text and not job_id:
            return text
        if not job_id:
            raise BlazeSttError("Blaze STT did not return a transcription")
        if state in DONE_STATES:
            return text or ""
        return self._wait(job_id)

    def _wait(self, job_id: str) -> str:
        deadline = time.monotonic() + self.timeout
        urls = (f"{self.base_url}/v1/stt/{job_id}", f"{self.base_url}/v1/stt/execute/{job_id}")
        while True:
            pending = False
            for url in urls:
                response = self._client.get(url, headers=self._headers)
                if response.status_code == 404:
                    continue
                if response.status_code in (429,) or response.status_code >= 500:
                    pending = True
                    continue
                _raise_for_status(response)
                payload = _json(response)
                state = _state(payload)
                if state in FAILED_STATES:
                    raise BlazeSttError(_error_message(payload))
                text = _transcription(payload)
                if text and (state is None or state in DONE_STATES):
                    return text
                if state in DONE_STATES:
                    return text or ""
                pending = True
            if not pending and time.monotonic() >= deadline:
                raise BlazeSttError(f"Blaze STT job {job_id} was not found")
            if time.monotonic() >= deadline:
                raise BlazeSttError(f"Blaze STT job {job_id} was not ready within {self.timeout:.0f}s")
            time.sleep(self.poll_interval)


@router.post("/voice/listen", tags=["voice"])
def listen(
    file: UploadFile = File(...),
    session_id: str = Form("default", alias="sessionId"),
) -> dict[str, Any]:
    """Transcribe one uploaded clip and append the driver turn to the session JSON file."""
    content_type = (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if content_type not in _AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Upload an audio file.")
    audio = file.file.read(MAX_AUDIO_BYTES + 1)
    if not audio:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file is too large.")
    if not os.getenv("BLAZE_API_TOKEN", "").strip():
        raise HTTPException(status_code=503, detail="Speech recognition is not configured.")
    try:
        text = transcribe(audio, filename=file.filename or "audio.wav", content_type=content_type)
        turn = append_turn(session_id, role="driver", text=text, source="stt") if text else None
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Session id is not valid.") from error
    except BlazeSttError as error:
        log.warning("Blaze STT failed: %s", error)
        raise HTTPException(status_code=502, detail="Speech recognition is temporarily unavailable.") from error
    return {"sessionId": _safe_session(session_id), "text": text, "turn": turn}


@router.get("/voice/conversation/{session_id}", tags=["voice"])
def read_conversation(session_id: str) -> dict[str, Any]:
    try:
        return load_conversation(session_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Session id is not valid.") from error


def _language() -> str:
    return os.getenv("BLAZE_STT_LANGUAGE", "").strip() or os.getenv("BLAZE_TTS_LANGUAGE", "vi").strip() or "vi"


def _conversation_dir() -> Path:
    return Path(os.getenv("BLAZE_CONVERSATION_DIR", Path(__file__).resolve().parent / "var" / "conversations"))


def _safe_session(session_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", session_id).strip("_")[:80]
    if not cleaned:
        raise ValueError("session id is empty")
    return cleaned


def _conversation_path(session_id: str) -> Path:
    return _conversation_dir() / f"{_safe_session(session_id)}.json"


def _read(path: Path, session_id: str) -> dict[str, Any]:
    if not path.exists():
        return {"sessionId": session_id, "updatedAt": None, "turns": []}
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BlazeSttError(f"conversation file is unreadable: {path.name}") from error
    if not isinstance(document, dict) or not isinstance(document.get("turns"), list):
        raise BlazeSttError(f"conversation file is invalid: {path.name}")
    document["sessionId"] = session_id
    return document


def _write(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    if response.status_code == 429 or response.status_code >= 500:
        raise BlazeSttError(f"Blaze STT is unavailable ({response.status_code})")
    payload = _json(response)
    raise BlazeSttError(_error_message(payload) if payload else f"Blaze STT rejected the audio ({response.status_code})")


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _transcription(payload: dict[str, Any]) -> str:
    result = payload.get("result")
    if isinstance(result, dict):
        data = result.get("data")
        if isinstance(data, dict):
            text = data.get("transcription")
            if isinstance(text, str) and text.strip():
                return " ".join(text.split())
        text = result.get("transcription")
        if isinstance(text, str) and text.strip():
            return " ".join(text.split())
    for key in ("transcription", "transcript", "text"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return ""


def _state(payload: dict[str, Any]) -> str | None:
    found = _find(payload, _STATUS_KEYS)
    return found.lower() if found else None


def _find(payload: dict[str, Any], keys: tuple[str, ...], depth: int = 0) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if depth >= 3:
        return None
    for value in payload.values():
        if isinstance(value, dict):
            found = _find(value, keys, depth + 1)
            if found:
                return found
    return None


def _error_message(payload: dict[str, Any]) -> str:
    raw = payload.get("message") or payload.get("error") or payload.get("detail")
    if isinstance(raw, dict):
        raw = raw.get("message") or raw.get("detail")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:200]
    return "Blaze STT request failed"
