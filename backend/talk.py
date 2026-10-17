"""Spoken conversation with the vehicle agent.

The driver sends one microphone clip. Blaze STT writes the words into the session
JSON (`var/conversations/<session>.json`, the same file spoken alerts already join).
A short agent reply is appended to that file and, when a voice is configured, read
aloud. The file is the script: the next reply sees the earlier turns.

The reply cannot lower a stop that is already in force, and it has no tools, so it
cannot book, clear codes or touch the car. `AGENT_MODE=rules` skips the model and
answers from the open incident and the driver-camera summary.
"""

import logging
import os
import re
import time
import threading
import functools
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from driver.agent import unsafe_for_stop
from driver.registry import driver_registry, suggests_garage_trip
from lang import normalize, pick
from situation import current_situation
from stt import BlazeSttError, _safe_session, append_turn, load_conversation, read_clip, transcribe
from voice import speak_line

log = logging.getLogger("car_neuron.talk")
router = APIRouter()

_SCRIPT_TURNS = 12
_REPLY_CHARS = 280
_HEARD_CHARS = 500
# The browser wake phrase. Only the text field is stripped; a Blaze transcript is kept as heard.
_WAKE = re.compile(r"\b(?:hey|hi|hay|hei)\s+(?:new\s+ron|neurons?)\b", re.IGNORECASE)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="talk")
_agents: dict[str, Any] = {}
_model_slots = threading.BoundedSemaphore(2)
# One live generation per conversation. A newer turn supersedes an older one.
# This does not stop a provider call that has already started; the late result is dropped.
_turns: dict[str, dict[str, Any]] = {}
_TURN_TTL = 180.0
_turn_lock = threading.RLock()

def _atomic(fn):
    @functools.wraps(fn)
    def locked(*args, **kwargs):
        with _turn_lock:
            return fn(*args, **kwargs)
    return locked

_ID = re.compile(r"^[\w-]{1,64}$")

_STOP = {
    "vi": "Hãy dừng ở vị trí an toàn gần nhất và không tiếp tục lái. Tôi không điều khiển xe.",
    "en": "Stop at the nearest safe place and do not keep driving. I do not control the car.",
}

INSTRUCTIONS = """
Bạn là Vehicle Guardian của Car Neuron, đang nói chuyện với tài xế qua loa.

Bạn nhận `script` (các lượt đã nói, lượt cuối của driver là câu vừa nghe) và `situation` (đánh giá xe đang mở, nếu có, và tóm tắt camera). `situation.must_stop` true nghĩa là luật an toàn đã yêu cầu dừng.

Viết `reply` bằng tiếng Việt để đọc to: một hoặc hai câu ngắn, dưới 280 ký tự, nói trực tiếp với tài xế. Không ký hiệu, không markdown, không ngoặc.

Quy tắc:
- Chỉ dùng số liệu có trong `situation` hoặc `script`. Không bịa nhiệt độ, mã lỗi hay tên garage.
- Không đổi mức nguy hiểm đã có. Không bảo tài xế tiếp tục lái, đi garage xa hay mở nắp két khi `must_stop` là true; khi đó câu trả lời phải nói dừng ở vị trí an toàn.
- Không nói bạn sẽ phanh, đánh lái, tắt máy, gọi cứu hộ, xóa mã lỗi, hay rằng hệ thống đã được chứng nhận an toàn ô tô.
- Không đặt lịch. Nếu tài xế muốn đặt lịch, nói họ xác nhận trên màn hình. Không xóa mã lỗi.
- `situation.garages` chỉ gồm tên và khoảng cách đã có. Không có danh sách thì nói chưa có garage trong dữ liệu. Không bịa tên garage.
- `situation.fresh` false hoặc `situation.stale` true: nói chưa có số đo mới, không lấy cảnh báo cũ làm hiện tại.
- Không có đánh giá xe thì nói bạn chưa có số đo mới, và trả lời từ những gì đã nói trong script.
- Đây là tư vấn, không thay kỹ thuật viên và không chẩn đoán y khoa.
""".strip()

_EN_RULE = """
OUTPUT LANGUAGE: ENGLISH. Write `reply` in natural spoken English, one or two short sentences under 280
characters, addressed to the driver, no symbols or markdown. The instructions and some labels are in
Vietnamese: do not copy Vietnamese into the reply. Every safety rule above still applies.
""".strip()


class TalkLine(BaseModel):
    reply: str = Field(min_length=1, max_length=400)


def situation(session_id: str) -> dict[str, Any]:
    """The newest assessment, else the open incident, plus the live camera summary.

    A fresh normal snapshot wins over an older open incident so the car is not
    described by a warning that has already cleared. A stale or missing snapshot
    is said to be stale rather than invented.
    """
    brief: dict[str, Any] = {"must_stop": False, "fresh": False, "stale": False, "garages": []}
    latest = current_situation(session_id)
    incident = None
    if latest is None:
        try:
            from store import store

            incident = store.get_open_incident(session_id)
        except Exception:
            log.warning("could not read the open incident", exc_info=True)
            incident = None
    if latest:
        brief["fresh"] = latest.get("fresh", True)
        brief["stale"] = not brief["fresh"]
        brief["age_seconds"] = latest.get("age_seconds")
        brief["capturedAt"] = latest.get("at")
        brief["garages"] = list(latest.get("garages") or [])
        brief["vehicle"] = {
            "severity": latest.get("severity"),
            "diagnosis": latest.get("diagnosis") or "",
            "recommendations": list(latest.get("recommendations") or []),
            "plan": latest.get("plan"),
        }
        if latest.get("must_stop"):
            brief["must_stop"] = True
    elif incident:
        recommendations = [str(item) for item in (incident.get("recommendations") or [])[:3]]
        brief["vehicle"] = {
            "severity": incident.get("severity"),
            "diagnosis": str(incident.get("diagnosis") or "")[:500],
            "recommendations": recommendations,
        }
        brief["fresh"] = False
        if incident.get("severity") == "critical":
            brief["must_stop"] = True
    driver = driver_registry.get(session_id)
    if driver.get("status") == "live":
        brief["driver"] = {
            "attention": driver.get("attention"),
            "state": driver.get("state"),
            "severity": driver.get("severity"),
            "must_stop": bool(driver.get("must_stop")),
            "responded": bool(driver.get("responded")),
        }
        if driver.get("must_stop"):
            brief["must_stop"] = True
    if not latest and not incident and driver.get("status") != "live":
        brief["stale"] = True
    return brief


def fallback_reply(heard: str, brief: dict[str, Any], lang: str) -> str:
    """A spoken line with no model: the stop, the current diagnosis, or an acknowledgement."""
    lang = normalize(lang)
    garages = brief.get("garages") or []
    nearest = garages[0] if garages else None
    if brief.get("must_stop"):
        if nearest and _asks_garage(heard):
            return pick(
                lang,
                f"Hãy dừng ở nơi an toàn và nghỉ trước. Garage gần nhất trong dữ liệu là {nearest['name']}, khoảng {nearest['distance_km']} km, chỉ để tính sau khi bạn đã tỉnh. Đừng lái tới đó lúc này.",
                f"Stop somewhere safe and rest first. The nearest garage in the data is {nearest['name']}, about {nearest['distance_km']} km away, and only for after you are alert. Do not drive there now.",
            )[:_REPLY_CHARS]
        return _STOP[lang]
    diagnosis = str((brief.get("vehicle") or {}).get("diagnosis") or "").strip()
    severity = str((brief.get("vehicle") or {}).get("severity") or "")
    quote = " ".join(heard.split())[:80]
    if nearest and _asks_garage(heard):
        return pick(
            lang,
            f"Garage gần nhất trong dữ liệu là {nearest['name']}, khoảng {nearest['distance_km']} km. Tôi không đặt lịch; bạn xác nhận trên màn hình nếu muốn.",
            f"The nearest garage in the data is {nearest['name']}, about {nearest['distance_km']} km away. I do not book it; confirm on the screen if you want to.",
        )[:_REPLY_CHARS]
    if brief.get("stale") or (not brief.get("fresh") and not diagnosis):
        return pick(
            lang,
            "Tôi chưa có số đo mới của xe. Tôi chỉ tư vấn và không điều khiển xe.",
            "I do not have a fresh reading from the car. I only advise, and I do not control it.",
        )
    if diagnosis and severity == "normal":
        return pick(
            lang,
            f"Xe đang bình thường. {diagnosis[:180]}",
            f"The car is normal right now. {diagnosis[:180]}",
        )[:_REPLY_CHARS]
    if diagnosis:
        return pick(
            lang,
            f"Tôi nghe: {quote}. Tình trạng xe hiện tại: {diagnosis[:160]}",
            f"I heard: {quote}. The car right now: {diagnosis[:160]}",
        )[:_REPLY_CHARS]
    if quote:
        return pick(
            lang,
            f"Tôi nghe: {quote}. Tôi đang theo dõi xe và chỉ tư vấn, không điều khiển xe.",
            f"I heard: {quote}. I am watching the car. I only advise, and I do not control it.",
        )
    return pick(lang, "Tôi chưa nghe rõ. Bạn nói lại giúp tôi.", "I did not catch that. Please say it again.")


def _asks_garage(heard: str) -> bool:
    lowered = heard.lower()
    return "garage" in lowered or "ga-ra" in lowered or "gara" in lowered


def guard_reply(text: str, brief: dict[str, Any], lang: str, heard: str) -> str:
    """Drop a reply that tells a stopping driver to go on, or that claims to control the car."""
    lang = normalize(lang)
    cleaned = " ".join(text.split()).strip()[:_REPLY_CHARS]
    if brief.get("stale") and not brief.get("must_stop"):
        return fallback_reply(heard, brief, lang)
    if not cleaned or _claims_control(cleaned):
        return fallback_reply(heard, brief, lang)
    if brief.get("must_stop") and (unsafe_for_stop(cleaned) or suggests_garage_trip(cleaned) or not _says_stop(cleaned)):
        return _STOP[lang]
    return cleaned


def spoken_excerpt(reply: str) -> str:
    """What the voice says of a reply: its first sentences. The whole reply stays on screen and in the script.

    A long answer costs seconds to synthesise and was still playing when the next alert arrived. A reply that
    tells the driver to stop is read in full: nothing in a safety instruction is left for the screen.
    TALK_SPOKEN_SENTENCES sets the number (default 2); 0 reads everything."""
    try:
        limit = int(os.getenv("TALK_SPOKEN_SENTENCES", "2"))
    except ValueError:
        limit = 2
    clean = " ".join(reply.split()).strip()
    if limit <= 0 or _says_stop(clean):
        return clean
    sentences = re.split(r"(?<=[.!?])\s+", clean)
    return " ".join(sentences[:limit])


def answer(session_id: str, heard: str, lang: str, brief: dict[str, Any] | None = None) -> str:
    """The next spoken line. Rules mode, a timeout or a model error uses the fallback."""
    lang = normalize(lang)
    brief = situation(session_id) if brief is None else brief
    if os.getenv("AGENT_MODE", "openai").lower() == "rules":
        return fallback_reply(heard, brief, lang)
    if not _model_slots.acquire(blocking=False):
        return fallback_reply(heard, brief, lang)
    future = None
    try:
        snapshot = brief.get("_script")
        if snapshot is None:
            snapshot = [{"role": turn["role"], "text": turn["text"]}
                        for turn in load_conversation(session_id)["turns"][-_SCRIPT_TURNS:]]
        future = _executor.submit(_model_reply, session_id, lang, {**brief, "_script": snapshot})
        future.add_done_callback(lambda _future: _model_slots.release())
        text = future.result(timeout=float(os.getenv("TALK_TIMEOUT_SECONDS", "20")))
    except Exception:
        if future is None:
            _model_slots.release()
        else:
            future.cancel()  # Running providers cannot be stopped; queued work must not start late.
        log.warning("talk reply fell back to the rule line", exc_info=True)
        return fallback_reply(heard, brief, lang)
    return guard_reply(text, brief, lang, heard)


def _model_reply(session_id: str, lang: str, brief: dict[str, Any]) -> str:
    import json

    from agents import Agent, Runner

    import llm_provider

    llm_provider.configure()
    key = normalize(lang)
    if key not in _agents:
        instructions = INSTRUCTIONS if key == "vi" else f"{INSTRUCTIONS.replace('bằng tiếng Việt', 'bằng tiếng Anh (English)')}\n\n{_EN_RULE}"
        _agents[key] = Agent(
            name="Vehicle Guardian",
            instructions=instructions,
            model=llm_provider.model_name(),
            model_settings=llm_provider.model_settings(),
            output_type=TalkLine,
        )
    brief = dict(brief)
    script = brief.pop("_script", None)
    if script is None:
        script = [{"role": turn["role"], "text": turn["text"]}
                  for turn in load_conversation(session_id)["turns"][-_SCRIPT_TURNS:]]
    result = Runner.run_sync(
        _agents[key],
        json.dumps({"situation": brief, "script": script}, ensure_ascii=False),
        max_turns=2,
    )
    if not isinstance(result.final_output, TalkLine):
        raise RuntimeError("talk agent returned an invalid line")
    return result.final_output.reply


def _claims_control(text: str) -> bool:
    lowered = text.lower()
    if "chứng nhận an toàn" in lowered or "safety certification" in lowered or "certified safe" in lowered:
        return True
    controls = ("tôi sẽ phanh", "tôi đã phanh", "tôi sẽ tắt máy", "tôi sẽ tắt động cơ", "tôi sẽ đánh lái", "tôi sẽ gọi cứu hộ", "tôi sẽ xóa mã")
    if any(phrase in lowered for phrase in controls):
        return True
    english = ("i will brake", "i'll brake", "i will steer", "i will shut", "i will turn off the engine", "i will call emergency", "i will clear the code")
    return any(phrase in lowered for phrase in english)


def _says_stop(text: str) -> bool:
    lowered = text.lower()
    return "dừng" in lowered or "stop" in lowered or "pull over" in lowered


def _cleanup_turns(now: float | None = None) -> None:
    clock = now if now is not None else time.monotonic()
    stale = [key for key, item in _turns.items() if clock - float(item.get("at", clock)) > _TURN_TTL]
    for key in stale:
        _turns.pop(key, None)


def _bucket(conversation_id: str) -> dict[str, Any]:
    _cleanup_turns()
    bucket = _turns.get(conversation_id)
    if bucket is None:
        if len(_turns) >= 2048:
            raise HTTPException(status_code=503, detail="Conversation capacity reached. Try later.")
        bucket = {"floor": -1, "generation": -1, "turns": {}, "at": time.monotonic()}
        _turns[conversation_id] = bucket
    bucket["at"] = time.monotonic()
    return bucket


@_atomic
def claim_turn(conversation_id: str, turn_id: str, generation: int, payload: tuple | None = None) -> str:
    """`ok` to run, `duplicate` when this turn already finished, `stale` when a newer one won."""
    bucket = _bucket(conversation_id)
    if generation <= int(bucket["floor"]) or generation < int(bucket["generation"]):
        return "stale"
    existing = bucket["turns"].get(turn_id)
    if existing and (existing["generation"] != generation or existing.get("payload") != payload):
        return "conflict"
    if not existing and generation == int(bucket["generation"]):
        return "conflict"
    if generation > int(bucket["generation"]):
        bucket["generation"] = generation
        for item in bucket["turns"].values():
            if item["status"] == "pending":
                item["status"] = "cancelled"
    existing = bucket["turns"].get(turn_id)
    if existing and existing["status"] == "pending":
        return "busy"
    if existing and existing["status"] == "done":
        return "duplicate"
    if existing and existing["status"] == "cancelled":
        return "stale"
    if len(bucket["turns"]) >= 128:
        bucket["turns"].pop(next(iter(bucket["turns"])))
    bucket["turns"][turn_id] = {"status": "pending", "generation": generation, "result": None, "payload": payload}
    return "ok"


@_atomic
def turn_current(conversation_id: str, turn_id: str, generation: int) -> bool:
    _cleanup_turns()
    bucket = _turns.get(conversation_id)
    if bucket is None:
        return False
    if generation < int(bucket["generation"]) or generation <= int(bucket["floor"]):
        return False
    item = bucket["turns"].get(turn_id)
    return bool(item and item["status"] in {"pending", "done"} and item["generation"] == generation)


@_atomic
def finish_turn(conversation_id: str, turn_id: str, generation: int, result: dict[str, Any]) -> None:
    bucket = _turns.get(conversation_id)
    if bucket is None:
        return
    item = bucket["turns"].get(turn_id)
    if item and item["generation"] == generation and item["status"] == "pending":
        item["status"] = "done"
        item["result"] = result


@_atomic
def stored_turn(conversation_id: str, turn_id: str) -> dict[str, Any] | None:
    bucket = _turns.get(conversation_id)
    if bucket is None:
        return None
    item = bucket["turns"].get(turn_id)
    if item and item["status"] == "done":
        return item.get("result")
    return None


@_atomic
def cancel_through(conversation_id: str, generation: int) -> None:
    """Mark this generation and anything older as cancelled. A newer turn still runs."""
    bucket = _bucket(conversation_id)
    bucket["floor"] = max(int(bucket["floor"]), generation)
    for item in bucket["turns"].values():
        if item["status"] == "pending" and int(item["generation"]) <= generation:
            item["status"] = "cancelled"


@_atomic
def clear_turns() -> None:
    _turns.clear()


_CONTROL = re.compile(
    r"^(?:stop|quiet|silence|be quiet|stop talking|hush|resume|speak again|end|end conversation|goodbye|"
    r"im|im lang|tam im|dung noi|bat lai|noi tiep|ket thuc|ket thuc hoi thoai)$",
    re.IGNORECASE,
)


def control_only(text: str) -> bool:
    """A bare audio command is not a question for the model. The page handles it locally."""
    cleaned = " ".join(text.split()).strip().lower()
    cleaned = unicodedata.normalize("NFD", cleaned.replace("đ", "d"))
    cleaned = re.sub(r"[^a-z0-9\s]", "", cleaned)
    cleaned = " ".join(cleaned.split())
    return bool(cleaned) and _CONTROL.match(cleaned) is not None


def strip_wake(text: str) -> str:
    """Drop a leading "hey neuron" so the script stores the question."""
    cleaned = " ".join(text.split()).strip()
    match = _WAKE.search(cleaned)
    if not match:
        return cleaned[:_HEARD_CHARS]
    rest = " ".join(cleaned[match.end():].split()).strip().lstrip(".,!?:;-").strip()
    return rest[:_HEARD_CHARS]


def _stale(safe_session: str, text: str) -> dict[str, Any]:
    return {"sessionId": safe_session, "text": text, "reply": None, "spoken": False, "turn": None, "answer": None, "stale": True}


def _reply(
    safe_session: str,
    text: str,
    lang: str,
    source: str,
    *,
    conversation_id: str | None = None,
    turn_id: str | None = None,
    generation: int | None = None,
) -> dict[str, Any]:
    tracked = conversation_id is not None and turn_id is not None and generation is not None
    public_conversation_id = conversation_id
    if tracked:
        conversation_id = f"{safe_session}:{conversation_id}"
    if tracked and control_only(text):
        return {"sessionId": safe_session, "text": text, "reply": None, "spoken": False, "turn": None, "answer": None, "control": True}
    if tracked:
        gate = claim_turn(conversation_id, turn_id, generation, (text, lang, source))
        if gate in {"busy", "conflict"}:
            raise HTTPException(status_code=409, detail="Turn is already running or its payload differs.")
        if gate == "stale":
            return _stale(safe_session, text)
        if gate == "duplicate":
            stored = stored_turn(conversation_id, turn_id)
            return stored if stored is not None else _stale(safe_session, text)
    if tracked and not turn_current(conversation_id, turn_id, generation):
        return _stale(safe_session, text)
    context = {"conversation_id": public_conversation_id} if tracked else {}
    driver_turn = append_turn(safe_session, role="driver", text=text, source=source, **context)
    if tracked and not turn_current(conversation_id, turn_id, generation):
        return _stale(safe_session, text)
    brief = situation(safe_session)
    if tracked:
        brief["_script"] = [{"role": turn["role"], "text": turn["text"]}
                            for turn in load_conversation(safe_session, **context)["turns"][-_SCRIPT_TURNS:]]
    reply = answer(safe_session, text, lang, brief)
    # The car may have become a mandatory stop while the model was working.
    fresh = situation(safe_session)
    reply = guard_reply(reply, fresh, lang, text)
    if tracked and not turn_current(conversation_id, turn_id, generation):
        return _stale(safe_session, text)
    agent_turn = append_turn(safe_session, role="agent", text=reply, source="reply", **context)

    def publish_ok() -> bool:
        if tracked and not turn_current(conversation_id, turn_id, generation):
            return False
        # A finished text turn may still be spoken. Only a new mandatory stop can withdraw it.
        fresh = situation(safe_session)
        if fresh.get("must_stop") and guard_reply(reply, fresh, lang, text) != reply:
            return False
        return True

    group = f"talk:{public_conversation_id}:{turn_id}" if tracked else None
    spoken = speak_line(spoken_excerpt(reply), session_id=safe_session, lang=lang, group=group, publish_ok=publish_ok)
    body = {
        "sessionId": safe_session,
        "text": text,
        "reply": reply,
        "spoken": spoken,
        "audioQueued": spoken,
        "turn": driver_turn,
        "answer": agent_turn,
        "conversation": load_conversation(safe_session, **context),
        "stale": False,
    }
    if tracked:
        finish_turn(conversation_id, turn_id, generation, body)
    return body


@router.post("/voice/transcribe", tags=["voice"])
def transcribe_only(
    file: UploadFile = File(...),
    lang: str = Form("vi"),
) -> dict[str, Any]:
    """Speech to text only, so the page can show the driver's question while the agent is still thinking.
    Nothing is stored; the page then sends the text to /voice/talk with `transcribed`."""
    audio, filename, content_type = read_clip(file)
    try:
        return {"text": transcribe(audio, filename=filename, content_type=content_type, language=normalize(lang))}
    except BlazeSttError as error:
        log.warning("Blaze STT failed: %s", error)
        raise HTTPException(status_code=502, detail="Speech recognition is temporarily unavailable.") from error


def _optional_id(value: str, label: str) -> str | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    if _ID.match(cleaned) is None:
        raise HTTPException(status_code=400, detail=f"{label} is not valid.")
    return cleaned


@router.post("/voice/talk/cancel", tags=["voice"])
def cancel_talk(
    conversation_id: str = Form(..., alias="conversationId"),
    generation: int = Form(...),
    session_id: str = Form("default", alias="sessionId"),
) -> dict[str, Any]:
    """Drop a turn that the page has already left. A provider call already running is not billed as stopped."""
    if _ID.match(conversation_id.strip()) is None or generation < 0 or generation > 1_000_000:
        raise HTTPException(status_code=400, detail="Conversation id is not valid.")
    try:
        safe_session = _safe_session(session_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Session id is not valid.") from error
    cancel_through(f"{safe_session}:{conversation_id.strip()}", generation)
    return {"ok": True, "cancelled": True}


@router.post("/voice/talk", tags=["voice"])
def talk(
    file: UploadFile | None = File(None),
    uttered: str = Form("", alias="text"),
    session_id: str = Form("default", alias="sessionId"),
    lang: str = Form("vi"),
    transcribed: bool = Form(False),
    conversation_id: str = Form("", alias="conversationId"),
    turn_id: str = Form("", alias="turnId"),
    generation: str = Form(""),
) -> dict[str, Any]:
    """Transcribe one clip, or accept the question that followed "hey neuron", then answer.

    `conversationId`, `turnId` and `generation` are optional. Older clients that omit them
    keep the previous behaviour. A newer generation supersedes an older one for that conversation only.
    """
    lang = normalize(lang)
    try:
        safe_session = _safe_session(session_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Session id is not valid.") from error
    conversation = _optional_id(conversation_id, "Conversation id")
    turn = _optional_id(turn_id, "Turn id")
    generation_value: int | None = None
    if generation.strip():
        try:
            generation_value = int(generation)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Generation is not valid.") from error
        if generation_value < 0 or generation_value > 1_000_000:
            raise HTTPException(status_code=400, detail="Generation is not valid.")
    tracked = conversation is not None or turn is not None or generation_value is not None
    if tracked and (conversation is None or turn is None or generation_value is None):
        raise HTTPException(status_code=400, detail="Conversation, turn and generation are sent together.")
    if file is not None and file.filename:
        audio, filename, content_type = read_clip(file)
        try:
            text = transcribe(audio, filename=filename, content_type=content_type, language=lang)
        except BlazeSttError as error:
            log.warning("Blaze STT failed: %s", error)
            raise HTTPException(status_code=502, detail="Speech recognition is temporarily unavailable.") from error
        source = "stt"
    elif transcribed:
        text, source = " ".join(uttered.split())[:800], "stt"  # already transcribed by /voice/transcribe
    else:
        text = strip_wake(uttered)
        source = "wake"
        if not uttered.strip():
            raise HTTPException(status_code=400, detail="Say something or upload an audio clip.")
    if not text:
        return {"sessionId": safe_session, "text": "", "reply": None, "spoken": False, "turn": None, "answer": None}
    return _reply(
        safe_session,
        text,
        lang,
        source,
        conversation_id=conversation,
        turn_id=turn,
        generation=generation_value,
    )
