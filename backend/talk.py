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
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from driver.agent import unsafe_for_stop
from driver.registry import driver_registry, suggests_garage_trip
from lang import normalize, pick
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
- Không đặt lịch. Nếu tài xế muốn đặt lịch, nói họ xác nhận trên màn hình.
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
    """The open incident and the live camera summary. Empty when neither exists."""
    brief: dict[str, Any] = {"must_stop": False}
    try:
        from store import store

        incident = store.get_open_incident(session_id)
    except Exception:
        log.warning("could not read the open incident", exc_info=True)
        incident = None
    if incident:
        recommendations = [str(item) for item in (incident.get("recommendations") or [])[:3]]
        brief["vehicle"] = {
            "severity": incident.get("severity"),
            "diagnosis": str(incident.get("diagnosis") or "")[:500],
            "recommendations": recommendations,
        }
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
    return brief


def fallback_reply(heard: str, brief: dict[str, Any], lang: str) -> str:
    """A spoken line with no model: the stop, the current diagnosis, or an acknowledgement."""
    lang = normalize(lang)
    if brief.get("must_stop"):
        return _STOP[lang]
    diagnosis = str((brief.get("vehicle") or {}).get("diagnosis") or "").strip()
    quote = " ".join(heard.split())[:80]
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


def guard_reply(text: str, brief: dict[str, Any], lang: str, heard: str) -> str:
    """Drop a reply that tells a stopping driver to go on, or that claims to control the car."""
    lang = normalize(lang)
    cleaned = " ".join(text.split()).strip()[:_REPLY_CHARS]
    if not cleaned or _claims_control(cleaned):
        return fallback_reply(heard, brief, lang)
    if brief.get("must_stop") and (unsafe_for_stop(cleaned) or suggests_garage_trip(cleaned) or not _says_stop(cleaned)):
        return _STOP[lang]
    return cleaned


def answer(session_id: str, heard: str, lang: str, brief: dict[str, Any] | None = None) -> str:
    """The next spoken line. Rules mode, a timeout or a model error uses the fallback."""
    lang = normalize(lang)
    brief = situation(session_id) if brief is None else brief
    if os.getenv("AGENT_MODE", "openai").lower() == "rules":
        return fallback_reply(heard, brief, lang)
    try:
        text = _executor.submit(_model_reply, session_id, lang, brief).result(
            timeout=float(os.getenv("TALK_TIMEOUT_SECONDS", "20"))
        )
    except (FuturesTimeout, Exception):
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
    script = [
        {"role": turn["role"], "text": turn["text"]}
        for turn in load_conversation(session_id)["turns"][-_SCRIPT_TURNS:]
    ]
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


def strip_wake(text: str) -> str:
    """Drop a leading "hey neuron" so the script stores the question."""
    cleaned = " ".join(text.split()).strip()
    match = _WAKE.search(cleaned)
    if not match:
        return cleaned[:_HEARD_CHARS]
    rest = " ".join(cleaned[match.end():].split()).strip().lstrip(".,!?:;-").strip()
    return rest[:_HEARD_CHARS]


def _reply(safe_session: str, text: str, lang: str, source: str) -> dict[str, Any]:
    driver_turn = append_turn(safe_session, role="driver", text=text, source=source)
    brief = situation(safe_session)
    reply = answer(safe_session, text, lang, brief)
    agent_turn = append_turn(safe_session, role="agent", text=reply, source="reply")
    spoken = speak_line(reply, session_id=safe_session, lang=lang)
    return {
        "sessionId": safe_session,
        "text": text,
        "reply": reply,
        "spoken": spoken,
        "turn": driver_turn,
        "answer": agent_turn,
        "conversation": load_conversation(safe_session),
    }


@router.post("/voice/talk", tags=["voice"])
def talk(
    file: UploadFile | None = File(None),
    uttered: str = Form("", alias="text"),
    session_id: str = Form("default", alias="sessionId"),
    lang: str = Form("vi"),
) -> dict[str, Any]:
    """Transcribe one clip, or accept the question that followed "hey neuron", then answer."""
    lang = normalize(lang)
    try:
        safe_session = _safe_session(session_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Session id is not valid.") from error
    if file is not None and file.filename:
        audio, filename, content_type = read_clip(file)
        try:
            text = transcribe(audio, filename=filename, content_type=content_type, language=lang)
        except BlazeSttError as error:
            log.warning("Blaze STT failed: %s", error)
            raise HTTPException(status_code=502, detail="Speech recognition is temporarily unavailable.") from error
        source = "stt"
    else:
        text = strip_wake(uttered)
        source = "wake"
        if not uttered.strip():
            raise HTTPException(status_code=400, detail="Say something or upload an audio clip.")
    if not text:
        return {"sessionId": safe_session, "text": "", "reply": None, "spoken": False, "turn": None, "answer": None}
    return _reply(safe_session, text, lang, source)
