"""Speak an agent warning with Blaze Voice AI.

Blaze batch TTS (https://api.blaze.vn, documented June 2026):

    POST /v1/tts
    Authorization: Bearer $BLAZE_API_TOKEN
    {"query", "language", "speaker_id", "model", "audio_format"}
    -> 202 and a job id

    GET /v1/tts/{id}            poll until the job finishes
    GET /v1/tts/{id}/download   audio bytes

`announce_alert` is what the vehicle agent and the driver agent call after a
warning or critical assessment. It returns immediately. Separate alert and talk
workers synthesize ordered parts concurrently; a failure never changes the assessment.

The alert is spoken in the language it is written in ("vi" or "en"). Each language has
its own Blaze voice: BLAZE_SPEAKER_ID (Vietnamese) and BLAZE_SPEAKER_ID_EN (English, default Helen,
with BLAZE_TTS_LANGUAGE_EN, default "en"); the person can pick another on the page (voice_options.py).
A language without a voice is not spoken at all: an English sentence is never read by a Vietnamese voice.
"""

import hashlib
import itertools
import json
import logging
import math
import os
import re
import threading
import tempfile
import time
from collections import deque
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from weakref import WeakValueDictionary
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

import http_pool
from lang import normalize
from voice_options import selected

log = logging.getLogger("car_neuron.voice")

BLAZE_BASE_URL = "https://api.blaze.vn"
ALERT_SEVERITIES = frozenset({"warning", "critical"})
DONE_STATES = frozenset({"completed", "complete", "succeeded", "success", "done", "finished"})
FAILED_STATES = frozenset({"failed", "error", "cancelled", "canceled"})
_ID_KEYS = ("id", "job_id", "request_id", "task_id")
_STATUS_KEYS = ("status", "state")
_URL_KEYS = ("audio_url", "download_url", "file_url", "audio_link", "url")
_CRITICAL_HOLD_SECONDS = 90.0  # a warning that arrives within this long after a critical one is outdated
_DEFAULT_REPEAT_SECONDS = 45.0
_SIMILAR = 0.7  # word overlap (Jaccard) from which two alerts count as the same one
_MAX_CHARS = 500
_FIRST_PART_CHARS = 200  # Start speaking the diagnosis while later garage details are still synthesizing.
_SPOKEN_CHARS = 140  # brief mode: the level, one short line and one step; the rest stays on screen
_BODY_WITH_OPTIONS = 100
_SPOKEN_CHARS_FULL = 260  # full mode (default): the first sentences of the diagnosis, then the whole step
_BODY_WITH_OPTIONS_FULL = 160

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
_job_clock = threading.local()
_ALERT_WORKERS = 2
_TALK_WORKERS = 2
_PART_WORKERS = 3
_talk_executor: ThreadPoolExecutor | None = None
_part_executors: dict[bool, ThreadPoolExecutor] = {}
_requests = threading.BoundedSemaphore(4)
_cache_lock = threading.RLock()
_cache_keys: WeakValueDictionary = WeakValueDictionary()
_cache_active: dict[Path, int] = {}


class BlazeError(RuntimeError):
    """Blaze rejected the request or the job failed."""


@dataclass(frozen=True)
class Speech:
    text: str
    audio: bytes
    content_type: str
    job_id: str


@dataclass
class _Audio:
    speech: Speech
    path: Path
    hit: bool
    synth_ms: float
    pinned: bool = False

    def release(self) -> None:
        with _cache_lock:
            if not self.pinned:
                return
            self.pinned = False
            left = _cache_active[self.path] - 1
            if left:
                _cache_active[self.path] = left
            else:
                _cache_active.pop(self.path)


class _PinnedFileResponse(FileResponse):
    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            with _cache_lock:
                path = Path(self.path)
                left = _cache_active.get(path, 1) - 1
                if left:
                    _cache_active[path] = left
                else:
                    _cache_active.pop(path, None)


def _voice_dir() -> Path:
    return Path(os.getenv("BLAZE_VOICE_DIR", Path(__file__).resolve().parent / "var" / "voice"))


def _cache_dir() -> Path:
    """Next to the voice folder, not inside it: ./demo.sh clears `var/voice` at every start and the cache must
    survive that (BLAZE_VOICE_CACHE_DIR overrides)."""
    configured = os.getenv("BLAZE_VOICE_CACHE_DIR", "").strip()
    if configured:
        return Path(configured)
    voice = _voice_dir()
    return voice.with_name(f"{voice.name}-cache")


def _cache_key(client, text: str) -> str | None:
    fields = ("speaker_id", "model", "language", "audio_speed", "audio_format")
    if os.getenv("BLAZE_VOICE_CACHE", "1") == "0" or not all(hasattr(client, field) for field in fields):
        return None
    body = [text, *(getattr(client, field) for field in fields)]
    return hashlib.sha256(json.dumps(body, ensure_ascii=False).encode()).hexdigest()


def _cache_limits() -> tuple[int, int]:
    def positive(name, default):
        try:
            return max(0, int(os.getenv(name, str(default))))
        except ValueError:
            return default
    return positive("BLAZE_VOICE_CACHE_MAX_FILES", 200), positive("BLAZE_VOICE_CACHE_MAX_MB", 100) * 1024 * 1024


def _has_audio_magic(data: bytes) -> bool:
    """A container header, or an MP3 frame sync (0xFF then three set bits: MPEG 1, 2 and 2.5, with or without CRC)."""
    return data.startswith((b"ID3", b"RIFF", b"OggS", b"fLaC")) or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0)


def _valid_cache_audio(data: bytes, content_type: str) -> bool:
    if len(data) < 512:
        return False
    magic = _has_audio_magic(data)
    if not (magic and content_type.lower().startswith(("audio/", "application/octet-stream"))):
        # Never silent: a cache that quietly never stores would look like it works until the demo.
        log.info("voice cache skipped: %s, %d bytes, starts %s", content_type or "no content type", len(data), data[:4].hex())
        return False
    return True


def _prune_cache(directory: Path, reserve_files=0, reserve_bytes=0) -> bool:
    """Called under cache lock. Registered and in-flight clips always win over the configured bound."""
    maximum, budget = _cache_limits()
    with _lock:
        pinned = {Path(clip["_path"]) for clip in _clips} | set(_cache_active)
    for orphan in directory.glob("*.audio"):
        if orphan not in pinned and not orphan.with_suffix(".json").exists():
            orphan.unlink(missing_ok=True)
    entries = []
    for meta in directory.glob("*.json"):
        path = meta.with_suffix(".audio")
        try:
            entries.append((path.stat().st_mtime_ns, path, meta, path.stat().st_size + meta.stat().st_size))
        except FileNotFoundError:
            meta.unlink(missing_ok=True)
    size = sum(row[3] for row in entries) + reserve_bytes
    count = len(entries) + reserve_files
    for _, path, meta, length in sorted(entries):
        if count <= maximum and size <= budget:
            break
        if path in pinned:
            continue
        path.unlink(missing_ok=True)
        meta.unlink(missing_ok=True)
        count -= 1
        size -= length
    return count <= maximum and size <= budget


def _atomic_bytes(path: Path, data: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".tts-", delete=False) as file:
        temp = Path(file.name)
        try:
            file.write(data)
            file.flush()
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def _prepare_audio(client, text: str, severity: str, publish_ok=None) -> _Audio:
    key = _cache_key(client, text)
    if key is None:
        speech, elapsed = _synthesize(client, text, publish_ok)
        return _Audio(speech, _write(speech, severity), False, elapsed)
    with _cache_lock:
        key_lock = _cache_keys.setdefault(key, threading.Lock())
    # Per-key single flight; network work never holds the shared file-index lock.
    with key_lock:
        directory = _cache_dir()
        path, meta = directory / f"{key}.audio", directory / f"{key}.json"
        with _cache_lock:
            try:
                info = json.loads(meta.read_text())
                data = path.read_bytes()
                if not _valid_cache_audio(data, info["content_type"]) or hashlib.sha256(data).hexdigest() != info["sha256"]:
                    raise ValueError("invalid cached audio")
                os.utime(path, None)
                _cache_active[path] = _cache_active.get(path, 0) + 1
                return _Audio(Speech(text, data, info["content_type"], "cache"), path, True, 0, True)
            except (OSError, ValueError, KeyError, TypeError):
                pass
        speech, elapsed = _synthesize(client, text, publish_ok)
        if _valid_cache_audio(speech.audio, speech.content_type):
            try:
                with _cache_lock:
                    directory.mkdir(parents=True, exist_ok=True)
                    # A corrupt entry may be replaced only when no registered clip is using it.
                    with _lock:
                        pinned = path in _cache_active or any(Path(c["_path"]) == path for c in _clips)
                    if not pinned:
                        path.unlink(missing_ok=True)
                        meta.unlink(missing_ok=True)
                        info = json.dumps({"content_type": speech.content_type, "sha256": hashlib.sha256(speech.audio).hexdigest()}).encode()
                        if _prune_cache(directory, 1, len(speech.audio) + len(info)):
                            _atomic_bytes(path, speech.audio)
                            _atomic_bytes(meta, info)  # Commit marker, after complete audio.
                            _cache_active[path] = _cache_active.get(path, 0) + 1
                            return _Audio(speech, path, False, elapsed, True)
            except OSError:
                log.warning("voice cache write unavailable; using an uncached clip")
        return _Audio(speech, _write(speech, severity), False, elapsed)


def detail_full() -> bool:
    """ALERT_VOICE_DETAIL=brief reads the level, one figure-free line and one step (cacheable, short). Anything else
    (the default) reads the diagnosis sentences with their figures, the whole step and the garage options; repeats
    are kept out by the time window and the similarity check instead (`announce_alert`)."""
    return os.getenv("ALERT_VOICE_DETAIL", "full").strip().lower() != "brief"


def repeat_seconds() -> float:
    """ALERT_REPEAT_SECONDS (default 45): an alert that was just spoken is not spoken again before this long; if it is
    still there after it, it is spoken again. 0: once per episode, as before."""
    try:
        return max(0.0, float(os.getenv("ALERT_REPEAT_SECONDS", str(_DEFAULT_REPEAT_SECONDS))))
    except ValueError:
        return _DEFAULT_REPEAT_SECONDS


def _already_said(step: str, spoken: str) -> bool:
    """Whether most of the step's words are already in the line, so reading it again would only repeat the sentence.
    Only in full mode, where the diagnosis can end with the very advice the plan carries."""
    if not detail_full():
        return False
    words = _WORDS.findall(step.lower())
    if len(words) < 4:
        return False
    heard = set(_WORDS.findall(spoken.lower()))
    return sum(word in heard for word in words) / len(words) >= 0.75


def alert_script(
    text: str,
    severity: str,
    recommendations: Sequence[str] | None = None,
    lang: str = "vi",
    options: str | None = None,
) -> str:
    """Short line for the driver, in `lang`. The lead states the severity once.

    `options` is a sentence built only from tool results (nearby garages, their
    distances, a familiar garage). It is spoken after the safety step.
    """
    choice = " ".join((options or "").split()).strip()
    full = detail_full()
    body = _brief(text, lang, (_BODY_WITH_OPTIONS_FULL if full else _BODY_WITH_OPTIONS) if choice else (_SPOKEN_CHARS_FULL if full else _SPOKEN_CHARS))
    step_line = _brief_step(recommendations[0]) if recommendations else ""
    if not body and not step_line:
        if not " ".join(str(text or "").split()):
            raise ValueError("alert text is empty")
        # Everything was a figure: still speak, never stay silent on a warning.
        body = "See the screen for details." if normalize(lang) == "en" else "Xem chi tiết trên màn hình."
    if normalize(lang) == "en":
        lead = "Critical warning." if severity == "critical" else "Warning."
        existing = re.match(r"^(?:critical warning|warning|alert|caution)\b[^\w]*", body, re.IGNORECASE)
        correct = "critical warning" if severity == "critical" else "warning"
        spoken = body if existing and existing.group().lower().startswith(correct) else f"{lead} {body[existing.end():] if existing else body}"
    else:
        lead = "Cảnh báo nguy hiểm." if severity == "critical" else "Cảnh báo."
        existing = re.match(r"^cảnh báo(?: nguy hiểm)?\b[^\w]*", body, re.IGNORECASE)
        correct = "cảnh báo nguy hiểm" if severity == "critical" else "cảnh báo."
        spoken = body if existing and body.lower().startswith(correct) else f"{lead} {body[existing.end():] if existing else body}"
    if step_line and step_line.lower() not in spoken.lower() and not _already_said(step_line, spoken):
        spoken = f"{spoken.rstrip('. ')}. {step_line}."
    if choice and choice.lower() not in spoken.lower():
        spoken = f"{spoken.rstrip('. ')}. {choice}"
    return spoken.strip()


def tool_options_line(trace: Sequence[dict] | None, lang: str = "vi", *, hold: bool = False, rest: bool = False) -> str:
    """Spoken choices taken only from tool results. Empty when no garage list came back.

    `hold` means the driver must stop first. `rest` also requires rest and alertness.
    Both list garages only as choices for after the stop.
    """
    lang = normalize(lang)
    found = _nearby_garages(trace)
    if not found:
        return ""
    spoken = found[:3]
    listed = _join_names(
        [
            pick_phrase(
                lang,
                f"{item['name']} cách {_km(item['km'], lang)}",
                f"{item['name']}, {_km(item['km'], lang)} away",
            )
            for item in spoken
        ],
        lang,
    )
    average = _km(sum(item["km"] for item in spoken) / len(spoken), lang)
    if lang == "en":
        count = f"{len(spoken)} nearest" if len(found) > len(spoken) else str(len(spoken))
        noun = "garage" if len(spoken) == 1 and len(found) == 1 else "garages"
        head = f"Around you, the {count} {noun} are {listed}." if len(found) > len(spoken) else f"Around you there {'is' if len(spoken) == 1 else 'are'} {len(spoken)} {noun}: {listed}."
        average_line = f"Their average distance is about {average}."
        familiar = _familiar_garage(trace)
        if rest:
            choice = f"These are choices only after you have stopped, rested and feel alert{f', including your usual garage, {familiar}' if familiar else ''}."
        elif hold:
            choice = f"These are choices for after you have stopped{f', including your usual garage, {familiar}' if familiar else ''}."
        elif familiar:
            choice = f"You can choose one of these, or your usual garage, {familiar}."
        else:
            choice = "You can choose one of these."
    else:
        if len(found) > len(spoken):
            head = f"Quanh bạn có {len(found)} garage. Ba garage gần nhất là {listed}."
        else:
            head = f"Quanh bạn có {len(spoken)} garage: {listed}."
        average_line = f"Khoảng cách trung bình của các garage vừa nêu là khoảng {average}."
        familiar = _familiar_garage(trace)
        if rest:
            choice = "Đây là các lựa chọn chỉ sau khi bạn đã dừng, nghỉ và tỉnh táo" + (f", gồm garage quen thuộc {familiar}." if familiar else ".")
        elif hold:
            choice = "Đây là các lựa chọn sau khi bạn đã dừng" + (f", gồm garage quen thuộc {familiar}." if familiar else ".")
        elif familiar:
            choice = f"Bạn muốn chọn một garage trong số này, hay garage quen thuộc {familiar}?"
        else:
            choice = "Bạn muốn chọn garage nào trong số này?"
    return f"{head} {average_line} {choice}"


def pick_phrase(lang: str, vi: str, en: str) -> str:
    return en if lang == "en" else vi


def _nearby_garages(trace: Sequence[dict] | None) -> list[dict[str, Any]]:
    for item in reversed(list(trace or [])):
        if item.get("tool") != "search_nearby_garages":
            continue
        result = item.get("result") or {}
        if not isinstance(result, dict) or result.get("error"):
            return []
        found: list[dict[str, Any]] = []
        for option in result.get("options") or []:
            if not isinstance(option, dict):
                continue
            name = " ".join(str(option.get("name") or "").split())
            distance = option.get("distance_km")
            if not name or not isinstance(distance, (int, float)) or not math.isfinite(distance) or distance < 0:
                continue
            found.append({"name": name, "km": float(distance)})
        found.sort(key=lambda garage: garage["km"])
        return found
    return []


def _familiar_garage(trace: Sequence[dict] | None) -> str | None:
    """The garage the history marks as familiar, otherwise the one used most often."""
    for item in reversed(list(trace or [])):
        if item.get("tool") != "get_maintenance_history":
            continue
        result = item.get("result") or {}
        records = result.get("records") if isinstance(result, dict) else None
        names = [
            " ".join(str(record.get("garage") or "").split())
            for record in records or []
            if isinstance(record, dict) and str(record.get("garage") or "").strip()
        ]
        if not names:
            return None
        marked = next((name for name in names if "quen" in name.lower()), None)
        if marked:
            return marked
        best = max(names.count(name) for name in names)
        for name in reversed(names):
            if names.count(name) == best:
                return name
    return None


def _km(value: float, lang: str) -> str:
    from lang import number

    amount = number(round(value, 1), lang, 1)
    return f"{amount} kilometres" if lang == "en" else f"{amount} kilômét"


def _join_names(parts: list[str], lang: str) -> str:
    if len(parts) == 1:
        return parts[0]
    conjunction = " and " if lang == "en" else " và "
    return ", ".join(parts[:-1]) + conjunction + parts[-1]


_CELSIUS = re.compile(r"\s*[°º˚]\s*C\b|\s*℃")


_ASIDE = re.compile(r"\s*\([^)]*\)")  # "(đối tác quen)": a label from the data, read aloud in the wrong language
_JARGON = {
    "vi": [
        (re.compile(r"\bECT\s*/\s*EOT\b"), "nhiệt độ nước làm mát và dầu"),
        (re.compile(r"\bECT\b"), "nhiệt độ nước làm mát"),
        (re.compile(r"\bEOT\b"), "nhiệt độ dầu"),
        (re.compile(r"hard_safety_guardrail"), "giới hạn an toàn bắt buộc"),
        (re.compile(r"\bbatch(?:es)?\b", re.IGNORECASE), "đợt dữ liệu"),
        (re.compile(r"\bcritical\b", re.IGNORECASE), "nguy hiểm"),
        (re.compile(r"\bRPM\b"), "vòng tua"),
    ],
    "en": [
        (re.compile(r"\bECT\s*/\s*EOT\b"), "coolant and oil temperature"),
        (re.compile(r"\bECT\b"), "coolant temperature"),
        (re.compile(r"\bEOT\b"), "oil temperature"),
        (re.compile(r"hard_safety_guardrail"), "the safety limit"),
        (re.compile(r"\bRPM\b"), "engine speed"),
    ],
}


def spoken_form(text: str, lang: str = "vi") -> str:
    """The text as it should be read. The degree sign is read badly, so a temperature becomes
    "108 độ C" (vi) or "108 degrees Celsius" (en); sensor codes and field names the model sometimes lets
    through ("ECT", "batch", "hard_safety_guardrail") become words of the same language, so the voice
    never switches language mid-sentence; a bracketed label is dropped. The words shown on screen keep all of it."""
    lang = normalize(lang)
    if lang == "vi":
        text = re.sub(r"(?<=\d)\.(?=\d)", ",", text)  # "109.7" is read as a Vietnamese decimal: "109,7"
    text = _CELSIUS.sub(" degrees Celsius" if lang == "en" else " độ C", text)
    for pattern, words in _JARGON[lang]:
        text = pattern.sub(words, text)
    return _ASIDE.sub("", text)


def follow_up_for(result: dict[str, Any], lang: str = "vi") -> str:
    """One short sentence after the alert: the booking the agent proposes, which the driver must confirm on
    screen. Nothing for a critical alert (stopping safely comes first) or without a proposal; the nearby
    garages are on screen, and the plan names the nearest one."""
    try:
        if (result.get("assessment") or {}).get("severity") != "warning":
            return ""
        pending = result.get("pending_action") or {}
        garage = str((pending.get("payload") or {}).get("garage_id") or "").strip()
        if garage and pending.get("status") == "pending_confirmation":
            garage = garage[:70]
            if normalize(lang) == "en":
                return f"I suggest booking at {garage}. Please confirm on the screen."
            return f"Tôi đề xuất đặt lịch tại {garage}. Bạn xác nhận trên màn hình nhé."
    except Exception:
        log.warning("could not build the spoken follow-up", exc_info=True)
    return ""


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
    return out


_DIGIT = re.compile(r"\d")
_RULE_PREFIX = re.compile(r"^(Theo các luật kiểm tra|According to the rules)[:,]\s*", re.IGNORECASE)
# A figure ("106.5°C", "65 km/h") changes on every batch, so a line that carries one is never the same twice:
# it cannot be cached and it is longer to say. The voice names the situation; the numbers stay on screen.
_HEADLINES = (
    (re.compile(r"ngưỡng nguy hiểm|quá nhiệt nghiêm trọng|critical threshold|severe engine overheating", re.IGNORECASE),
     "Động cơ quá nhiệt.", "Engine overheating."),
    (re.compile(r"mất tỉnh táo|buồn ngủ|low alertness|drows", re.IGNORECASE),
     "Bạn có dấu hiệu mất tỉnh táo.", "You show signs of low alertness."),
    (re.compile(r"vượt ngưỡng cảnh báo|mức cảnh báo|nhiệt độ (?:động cơ )?đang tăng|above the warning threshold|warning level|temperature is rising", re.IGNORECASE),
     "Động cơ đang nóng.", "The engine is running hot."),
)


def _without_figures(sentence: str) -> str:
    """The clauses of one sentence before its first number, for text no headline recognises. Clauses after
    a number are dropped too: "..., so check it soon" read alone is a fragment."""
    kept = []
    for clause in re.split(r"(?<=[,;:])\s+|\s+[-–—]\s+", _ASIDE.sub("", sentence)):
        if _DIGIT.search(clause):
            break
        kept.append(clause)
    return " ".join(kept).strip(" ,;:")


def _brief(text: str, lang: str, limit: int) -> str:
    """What the voice says of a diagnosis: whole sentences up to `limit`, and no figures.

    Text without a number is already stable and is only cut at a sentence end. Text with a number becomes a
    fixed headline when it is one of our rule sentences, else its number-free clauses (maybe nothing, and
    then the level and the step are the whole alert)."""
    clean = _RULE_PREFIX.sub("", " ".join(str(text or "").split())).strip()
    if _DIGIT.search(clean) and not detail_full():
        for pattern, vi, en in _HEADLINES:
            if pattern.search(clean):
                return en if normalize(lang) == "en" else vi
        kept = (_without_figures(sentence) for sentence in re.split(r"(?<=[.!?])\s+", clean))
        clean = " ".join(sentence if sentence[-1:] in ".!?" else f"{sentence}." for sentence in kept if sentence)
    return _first_sentences(clean[:1].upper() + clean[1:], limit)


def _brief_step(step: str) -> str:
    """One step, up to its first semicolon: the "if it keeps rising..." part stays on screen."""
    one = " ".join(str(step or "").split())
    if detail_full():
        return one.rstrip(". ")
    return re.split(r";\s+|(?<=[.!?])\s+", one, maxsplit=1)[0].strip().rstrip(".")


def _tts_parts(script: str) -> list[str]:
    """Keep each Blaze request short without losing a garage or the final choice."""
    parts: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?])\s+", script):
        limit = _FIRST_PART_CHARS if not parts else _MAX_CHARS
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > limit:
            parts.append(current)
            current = ""
        limit = _FIRST_PART_CHARS if not parts else _MAX_CHARS
        if len(sentence) <= limit:
            current = f"{current} {sentence}".strip()
            continue
        # A single exceptionally long sentence still needs a safe word boundary.
        for word in sentence.split():
            candidate = f"{current} {word}".strip()
            limit = _FIRST_PART_CHARS if not parts else _MAX_CHARS
            if len(candidate) > limit and current:
                parts.append(current)
                current = word
            else:
                current = candidate
    if current:
        parts.append(current)
    return parts


def announce_alert(
    text: str,
    *,
    severity: str,
    recommendations: Sequence[str] | None = None,
    dedupe_key: str | None = None,
    session_id: str | None = None,
    lang: str = "vi",
    options: str | None = None,
    follow_up: str = "",
    once: bool = False,
    publish_ok=None,
) -> None:
    """Queue TTS for a warning or critical alert. No-op for any other severity, and for a language
    that has no voice configured. The same key is quiet for `repeat_seconds()` (45 s) and so is any alert with nearly the
    same words; if the alert is still there afterwards it is spoken again. With ALERT_REPEAT_SECONDS=0 a `once` alert
    is spoken one time for the whole episode (until `clear_alert_history`).

    Never raises: a voice failure must not change the assessment that triggered it.
    """
    try:
        lang = normalize(lang)
        if severity not in ALERT_SEVERITIES or not _configured(lang):
            return
        if publish_ok is not None and not publish_ok():
            return
        if severity == "warning" and session_id and _recently_critical(session_id):
            return
        script = alert_script(text, severity, recommendations, lang, options)
        if follow_up:
            script = f"{script.rstrip()} {follow_up.strip()}"
        key = dedupe_key or f"{severity}:{script}"
        if not _claim(key, once):
            return
        if _is_repeat(session_id, lang, severity, script):
            return
        if severity == "critical" and session_id:
            with _lock:
                _critical_at[session_id] = time.monotonic()
        _queue_alert(script, severity, key, session_id, lang, publish_ok)
    except Exception:
        log.warning("could not queue Blaze TTS", exc_info=True)


def _first_sentence(text: str) -> str:
    """Only the first sentence (whole, at most ~170 characters): the rest stays on screen."""
    clean = " ".join(str(text or "").split()).strip()
    return _first_sentences(re.split(r"(?<=[.!?])\s+", clean, maxsplit=1)[0], 170) if clean else ""


def fast_alert_line(diagnosis: str, lang: str = "vi") -> str:
    """Pure rule diagnosis body, first sentence and no figures; announce_alert adds the severity lead and step."""
    first = re.split(r"(?<=[.!?])\s+", _RULE_PREFIX.sub("", " ".join(str(diagnosis or "").split())).strip(), maxsplit=1)[0]
    return _brief(first, lang, _SPOKEN_CHARS_FULL if detail_full() else _SPOKEN_CHARS)


def speak_car_fast(session_id: str, severity: str, lang: str, diagnosis: str, step: str | None) -> None:
    """Rules first: as soon as a batch arrives and the rules see a warning or critical car, a short line
    (level, what is wrong, the mandatory step) is spoken without waiting for the LLM. Once per episode."""
    if severity not in ALERT_SEVERITIES or _claimed(f"{session_id}:{severity}:{normalize(lang)}:lead"):
        return  # the agent already announced this level (it can be faster than the rules)
    announce_alert(fast_alert_line(diagnosis, lang), severity=severity, recommendations=[step] if step else None,
                   dedupe_key=f"{session_id}:{severity}:{normalize(lang)}:fast", once=True, session_id=session_id, lang=lang)


def speak_car_result(session_id: str, severity: str, lang: str, result: dict[str, Any], diagnosis: str, recommendations: Sequence[str]) -> None:
    """After the agent: what to do now (the plan) and the booking question. The level is announced once per
    episode (by the fast rule line or here, with one sentence of the diagnosis); after that only a changed plan
    is spoken (a driver who becomes drowsy hears "rest first") or a new booking question. The full text stays
    on screen."""
    lang = normalize(lang)
    plan = result.get("plan") or {}
    follow_up = follow_up_for(result, lang)
    # Only the first sentence of the plan ("Hãy nghỉ trước.", "Garage gần nhất là ..."): a longer plan was
    # still being read when the next alert arrived. The whole plan, with every garage, stays on screen.
    if detail_full():
        # The plan's safety steps, then the garages read from the tool results (their names and distances).
        line = plan.get("spoken") or ""
        choices = tool_options_line(
            result.get("tool_trace"), lang,
            hold=severity == "critical" or plan.get("code") in ("stop_and_get_help", "stop_rest_and_get_help"),
            rest=plan.get("code") in ("rest_then_decide", "stop_rest_and_get_help"),
        )
        if choices:
            steps = plan.get("steps") or list(recommendations)[:1]
            line = " ".join([*(str(step).strip() for step in steps if step), choices])
    else:
        line = _first_sentence(plan.get("spoken") or "")
    if plan.get("code") == "garage_when_convenient" and follow_up:
        line = ""  # the booking sentence already names the garage
    base = f"{session_id}:{severity}:{lang}"
    key = f"{base}:plan:{plan.get('code') or '-'}" + (":booking" if follow_up else "")
    if _claimed(f"{base}:fast") or _claimed(f"{base}:lead"):
        script = " ".join(part for part in (line, follow_up) if part).strip()
        if script:
            _say_once(script, severity, key, session_id, lang)
        return
    _claim(f"{base}:lead", True)
    announce_alert(_first_sentence(diagnosis) if not detail_full() else _first_sentences(" ".join(str(diagnosis).split()), _SPOKEN_CHARS_FULL),
                   severity=severity, recommendations=None if line else list(recommendations)[:1],
                   dedupe_key=key, once=True, session_id=session_id, lang=lang, options=line or None, follow_up=follow_up)


def _claimed(key: str) -> bool:
    with _lock:
        return time.monotonic() < _spoken.get(key, 0)


def _say_once(script: str, severity: str, key: str, session_id: str, lang: str) -> None:
    """A line that is not an alert lead (no "Cảnh báo." in front), spoken once per episode."""
    try:
        if not _configured(lang) or not _claim(key, True):
            return
        if _is_repeat(session_id, lang, severity, script):
            return
        _queue_alert(script, severity, key, session_id, lang)
    except Exception:
        log.warning("could not queue Blaze TTS", exc_info=True)


def alert_dedupe_key(session_id: str, severity: str, lang: str, options: str) -> str:
    """A changed garage result is a new useful warning; identical batches stay quiet. The distances are left out:
    they drift by a few hundred metres from one batch to the next and must not make the same alert speak again."""
    choice_id = hashlib.sha256(re.sub(r"[\d.,]+", "", options).encode("utf-8")).hexdigest()[:12]
    return f"{session_id}:{severity}:{normalize(lang)}:{choice_id}"


def clear_alert_history(session_id: str) -> None:
    """A normal assessment ends the spoken alert episode for this vehicle."""
    with _lock:
        for key in [key for key in _spoken if key.startswith(f"{session_id}:")]:
            _spoken.pop(key, None)
        _critical_at.pop(session_id, None)
        for key in [key for key in _recent if key[0] == session_id]:
            _recent.pop(key, None)


def clear_all_alert_history() -> None:
    """A new demo run: no alert of an earlier run counts as already spoken."""
    with _lock:
        _spoken.clear()
        _critical_at.clear()
        _recent.clear()


class BlazeTTS:
    """One-shot client for POST /v1/tts plus the documented download poll."""

    def __init__(
        self,
        *,
        token: str,
        speaker_id: str,
        model: str = "v2.0_pro",
        language: str = "vi",
        audio_format: str = "mp3",
        audio_speed: float | None = None,
        base_url: str = BLAZE_BASE_URL,
        timeout: float = 20.0,
        poll_interval: float = 0.15,  # Blaze finishes a short line in ~1.5 s: check often
        client: httpx.Client | None = None,
    ) -> None:
        self.speaker_id = speaker_id
        self.model = model
        self.language = language
        self.audio_format = audio_format
        self.audio_speed = audio_speed
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval
        self.creation_retries = 1
        self._owns_client = client is None
        self._client = client or http_pool.shared("blaze-tts")  # one keep-alive connection pool, see http_pool.py
        self._request_timeout = min(15.0, timeout)
        self._headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def close(self) -> None:
        pass  # the client is shared (or the caller's): it outlives one speech

    def __enter__(self) -> "BlazeTTS":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def synthesize(self, text: str) -> Speech:
        for attempt in range(self.creation_retries + 1):
            try:
                response = self._client.post(
                    f"{self.base_url}/v1/tts",
                    headers=self._headers,
                    timeout=self._request_timeout,
                    json={
                        "query": text,
                        "language": self.language,
                        "speaker_id": self.speaker_id,
                        "model": self.model,
                        "audio_format": self.audio_format,
                        **({"audio_speed": self.audio_speed} if self.audio_speed is not None else {}),
                    },
                )
            except (httpx.ConnectTimeout, httpx.ConnectError):  # a read timeout may already have created the job
                if attempt >= self.creation_retries:
                    raise
            else:
                payload = _json_or_none(response) or {}
                # Even an unusual error response with a job ID must never create a second job.
                if response.status_code not in (429, 502, 503, 504) or _find(payload, _ID_KEYS) or attempt >= self.creation_retries:
                    break
            time.sleep(0.4)
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
        return self._client.get(absolute, headers=headers, timeout=self._request_timeout)


def speak_line(text: str, *, session_id: str, lang: str = "vi", group: str | None = None, publish_ok=None) -> bool:
    """Queue one conversational line in the driver's language. The caller stores the script.

    Returns whether a clip was queued. A missing voice is text-only, same as alerts.
    `publish_ok` is checked before synthesis and again before the clip is published, so a
    superseded turn does not become a clip. It cannot stop a provider call already in flight.
    """
    lang = normalize(lang)
    script = " ".join(text.split()).strip()
    if not script or not _configured(lang):
        return False
    if publish_ok is not None and not publish_ok():
        return False
    # A fresh key every time: the driver may ask the same thing twice and should hear it twice.
    key = group or f"talk:{session_id}:{time.monotonic_ns()}"
    _talk_pool().submit(_queued_speak, script[:_MAX_CHARS], "normal", key, time.monotonic(), session_id, lang, False, publish_ok)
    return True


def _queue_alert(script: str, severity: str, key: str, session_id: str | None, lang: str, publish_ok=None) -> None:
    from situation import epoch

    requested_epoch = epoch()
    _pool().submit(_queued_speak, script, severity, key, time.monotonic(), session_id, lang,
                   True, lambda: epoch() == requested_epoch and (publish_ok is None or publish_ok()))


def _queued_speak(script: str, severity: str, key: str, queued_at: float, *args) -> None:
    _job_clock.queued_at = queued_at
    try:
        _speak(script, severity, key, *args)
    finally:
        del _job_clock.queued_at


class _SpeechCancelled(Exception):
    pass


def _synthesize(client, text: str, publish_ok=None) -> tuple[Speech, float]:
    while True:
        if publish_ok is not None and not publish_ok():
            raise _SpeechCancelled()
        if _requests.acquire(timeout=0.05):
            break
    try:
        if publish_ok is not None and not publish_ok():
            raise _SpeechCancelled()
        started = time.monotonic()
        speech = client.synthesize(text)
        return speech, (time.monotonic() - started) * 1000
    finally:
        _requests.release()


def _speak(script: str, severity: str, key: str, session_id: str | None = None, lang: str = "vi", remember: bool = True, publish_ok=None) -> None:
    started = time.monotonic()
    queue_ms = max(0, (started - getattr(_job_clock, "queued_at", started)) * 1000)
    synth_ms, cache_hits = [], []
    parts = _tts_parts(script)
    futures = []
    manager = None
    cancelled = threading.Event()
    try:
        if publish_ok is not None and not publish_ok():
            return
        manager = _client_from_env(lang)
        client = manager.__enter__()
        pool = _part_pool(severity == "normal")

        def valid():
            return not cancelled.is_set() and (publish_ok is None or publish_ok())

        def prepare(index):
            if not valid():
                return None
            audio = _prepare_audio(client, spoken_form(parts[index], lang), severity, valid)
            if not valid():
                audio.release()
                return None
            return audio

        for index in range(min(_PART_WORKERS, len(parts))):
            futures.append(pool.submit(prepare, index))
        for index, part in enumerate(parts):
            audio = futures[index].result()
            if audio is None:
                return
            try:
                synth_ms.append(round(audio.synth_ms, 1))
                cache_hits.append(audio.hit)
                if publish_ok is not None and not publish_ok():
                    return
                _register(session_id, severity, part, audio.path, audio.speech.content_type, lang,
                          group=key, part_index=index, part_count=len(parts),
                          timings={"queue_wait_ms": queue_ms, "synth_ms": audio.synth_ms})
            finally:
                audio.release()
            next_index = index + _PART_WORKERS
            if next_index < len(parts):
                futures.append(pool.submit(prepare, next_index))
    except _SpeechCancelled:
        return
    except Exception as error:
        log.warning("Blaze TTS failed for a %s alert (%s)", severity, type(error).__name__)
        _release(key)
        return
    finally:
        cancelled.set()
        # Do not close a shared HTTP client while an obsolete part is still using it.
        # Its last future closes it; every unused result releases its temporary cache lease.
        def discard(future):
            if not future.cancelled() and future.exception() is None:
                audio = future.result()
                if audio is not None:
                    audio.release()
        remaining = [len(futures)]
        closing = threading.Lock()
        def close(future=None):
            with closing:
                remaining[0] -= 1
                if remaining[0] <= 0 and manager is not None:
                    try:
                        manager.__exit__(None, None, None)
                    except Exception:
                        log.warning("could not close TTS client")
        for future in futures:
            future.cancel()
            future.add_done_callback(discard)
            future.add_done_callback(close)
        if not futures:
            close()
        log.info("voice job key=%s lang=%s parts=%s queue_wait_ms=%.1f synth_ms=%s total_ms=%.1f cache=%s",
                 hashlib.sha256(key.encode()).hexdigest()[:8], normalize(lang), len(parts), queue_ms, synth_ms,
                 queue_ms + (time.monotonic() - started) * 1000, "hit" if cache_hits and all(cache_hits) else "mixed" if any(cache_hits) else "miss")
    if not remember or not session_id:
        return
    try:
        from stt import append_turn
        append_turn(session_id, role="agent", text=script, source="tts", severity=severity)
    except Exception:
        log.warning("could not store the spoken turn", exc_info=True)


def _client_from_env(lang: str = "vi") -> BlazeTTS:
    english = normalize(lang) == "en"
    model = os.getenv("BLAZE_TTS_MODEL", "v2.0_pro").strip() or "v2.0_pro"
    return BlazeTTS(
        token=os.environ["BLAZE_API_TOKEN"].strip(),
        speaker_id=selected(lang),  # the person's choice on the page, else the default (voice_options.py)
        model=(os.getenv("BLAZE_TTS_MODEL_EN", "").strip() or model) if english else model,
        language=(os.getenv("BLAZE_TTS_LANGUAGE_EN", "en").strip() or "en") if english else (os.getenv("BLAZE_TTS_LANGUAGE", "vi").strip() or "vi"),
        audio_format=os.getenv("BLAZE_AUDIO_FORMAT", "mp3").strip() or "mp3",
        audio_speed=_audio_speed(english),
        base_url=os.getenv("BLAZE_BASE_URL", BLAZE_BASE_URL).strip() or BLAZE_BASE_URL,
        timeout=float(os.getenv("BLAZE_TTS_TIMEOUT_SECONDS", "20")),
    )


def _audio_speed(english: bool = False) -> float:
    """Playback speed Blaze renders at (its range is 0.5-1.5). Vietnamese alerts are read fast, the maximum;
    BLAZE_AUDIO_SPEED_EN sets English on its own (an English voice at the maximum sounded strained), falling back to
    BLAZE_AUDIO_SPEED. A value that is not a number is ignored."""
    for name in (("BLAZE_AUDIO_SPEED_EN",) if english else ()) + ("BLAZE_AUDIO_SPEED",):
        raw = os.getenv(name, "").strip()
        if not raw:
            continue
        try:
            return min(1.5, max(0.5, float(raw)))
        except ValueError:
            return 1.5
    return 1.5


def _write(speech: Speech, severity: str) -> Path:
    directory = _voice_dir()
    directory.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%S")
    job = "".join(ch for ch in speech.job_id if ch.isalnum() or ch in "-_")[:40] or "audio"
    path = directory / f"{severity}-{stamp}-{time.monotonic_ns()}-{job}.{_extension(speech.content_type)}"
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
        return time.monotonic() - _critical_at.get(session_id, float("-inf")) < _CRITICAL_HOLD_SECONDS


def _claim(key: str, once: bool = False) -> bool:
    """True when `key` may be spoken now. It is then quiet for `repeat_seconds()` (45 s), and spoken again after that if
    the alert is still there. With ALERT_REPEAT_SECONDS=0, `once` keys stay quiet for the whole episode."""
    now = time.monotonic()
    repeat = repeat_seconds()
    with _lock:
        if now < _spoken.get(key, 0):
            return False
        _spoken[key] = now + repeat if repeat > 0 else (math.inf if once else now + _CRITICAL_HOLD_SECONDS)
    return True


# What was just queued per session and language: (severity, words, when). A new alert that says nearly the same as one
# spoken less than `repeat_seconds()` ago is not spoken: a figure that changed by a tenth, or the same advice in the
# rule's words and then the agent's, is not news.
_recent: dict[tuple[str, str], deque] = {}
_WORDS = re.compile(r"[^\W\d_]{3,}")


def _signature(script: str) -> frozenset:
    return frozenset(_WORDS.findall(script.lower()))  # letters only: the numbers never count


def _is_repeat(session_id: str | None, lang: str, severity: str, script: str) -> bool:
    """Whether `script` repeats an alert spoken within the window. Records it when it does not."""
    repeat = repeat_seconds()
    if not session_id or repeat <= 0:
        return False
    words, now = _signature(script), time.monotonic()
    with _lock:
        recent = _recent.setdefault((session_id, normalize(lang)), deque(maxlen=12))
        while recent and now - recent[0][2] >= repeat:
            recent.popleft()
        for seen_severity, seen_words, _ in recent:
            union = words | seen_words
            if seen_severity == severity and union and len(words & seen_words) / len(union) >= _SIMILAR:
                return True
        recent.append((severity, words, now))
    return False


def _release(key: str) -> None:
    with _lock:
        _spoken.pop(key, None)


def _pool() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=_ALERT_WORKERS, thread_name_prefix="blaze-alert")
        return _executor


def _talk_pool() -> ThreadPoolExecutor:
    global _talk_executor
    with _lock:
        if _talk_executor is None:
            _talk_executor = ThreadPoolExecutor(max_workers=_TALK_WORKERS, thread_name_prefix="blaze-talk")
        return _talk_executor


def _part_pool(talk: bool) -> ThreadPoolExecutor:
    with _lock:
        if talk not in _part_executors:
            # Three talk synthesis workers leave capacity for an alert even during a long reply.
            _part_executors[talk] = ThreadPoolExecutor(max_workers=_PART_WORKERS, thread_name_prefix="tts-talk-part" if talk else "tts-alert-part")
        return _part_executors[talk]


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
    return _has_audio_magic(response.content[:12])


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
    return bool(os.getenv("BLAZE_API_TOKEN", "").strip() and selected(lang))


def _register(session_id: str | None, severity: str, text: str, path: Path, content_type: str, lang: str = "vi", *, group: str | None = None, part_index: int = 0, part_count: int = 1, timings: dict[str, float] | None = None) -> dict[str, Any]:
    clip = {
        "id": f"clip_{next(_clip_seq)}",
        "session": session_id or "",
        "lang": normalize(lang),
        "severity": severity,
        "text": text,
        "group": group,
        "part_index": part_index,
        "part_count": part_count,
        "content_type": content_type,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "_path": path,
    }
    clip["seq"] = int(clip["id"].split("_")[1])
    clip.update({f"_{key}": round(value, 1) for key, value in (timings or {}).items()})
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
    with _cache_lock:
        with _lock:
            clip = next((c for c in _clips if c["id"] == clip_id), None)
        if clip is None or not Path(clip["_path"]).is_file():
            raise HTTPException(status_code=404, detail="Clip not found")
        path = Path(clip["_path"])
        _cache_active[path] = _cache_active.get(path, 0) + 1
        return _PinnedFileResponse(path, media_type=clip["content_type"])
