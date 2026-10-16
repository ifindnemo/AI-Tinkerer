"""Optional LLM wording for an alert. It only receives structured events (never video)."""

import json
import logging
import os
import re
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from agent.realism import for_model
from driver.guardian import GuardianResult
from driver.rules import RuleResult
from driver.schemas import DriverEvent, DriverNarrative
from lang import normalize

INSTRUCTIONS = """
Bạn là trợ lý chú ý của tài xế trong Car Neuron. Bạn chỉ nhận các chỉ số có cấu trúc do camera trên xe tính ngay trong trình duyệt; không bao giờ có hình ảnh hay video.

Việc của bạn: viết lại kết luận của luật xác định cho tài xế bằng tiếng Việt, ngắn gọn, bình tĩnh, dựa trên số liệu trong `recent_events` và `rule_assessment`.

Quy tắc:
- Không đổi mức độ (`rule_assessment.severity`); không hạ thấp nguy cơ.
- Không chẩn đoán y khoa (không nói tài xế mắc bệnh hay rối loạn giấc ngủ). Chỉ nói "có dấu hiệu".
- Không nói hệ thống đã được chứng nhận an toàn ô tô, không nói sẽ điều khiển xe hoặc gọi cứu hộ.
- Khuyến nghị chỉ gồm hành động của tài xế: dừng xe an toàn, nghỉ, đổi người lái, nhìn lại đường.
- Nếu độ tin cậy thấp, nói rõ phép đo chưa chắc chắn.
- `summary` sẽ được đọc to bằng giọng nói cho tài xế: tối đa 2 câu ngắn (dưới 220 ký tự), nói trực tiếp với tài xế, không dùng ký hiệu hay viết tắt; `recommendations` 1–4 bước, không trùng nhau.
""".strip()

GUARDIAN_INSTRUCTIONS = """
Bạn là Vehicle Guardian trong Car Neuron. Bạn kết hợp ba nguồn có cấu trúc: dữ liệu ECU của xe (`ecu`), trạng thái người lái do camera tính trong trình duyệt (`driver`, không bao giờ có hình ảnh) và lịch sử bảo trì của xe (`maintenance`).

`policy` là quyết định của safety policy cố định: mức độ, hành động bắt buộc (`action`, `mandatory_steps`) và việc có phải dừng xe hay không (`must_stop`). Bạn không được thay đổi quyết định đó.

Việc của bạn: viết `summary` bằng tiếng Việt để đọc to cho tài xế qua loa: tối đa 2 câu ngắn (dưới 220 ký tự), bình tĩnh, nói trực tiếp với tài xế, nêu lý do chính (một hai số liệu quan trọng như tốc độ, nhiệt độ, thời gian nhắm mắt) và bước tiếp theo đúng như `mandatory_steps`. Không dùng ký hiệu, ngoặc hay viết tắt.

Quy tắc:
- Không hạ mức độ, không gợi ý tiếp tục lái, đi tiếp đến garage hay trạm nghỉ khi `must_stop` là true.
- `action` là stop_engine: phải dừng xe ở vị trí an toàn và tắt máy, bất kể trạng thái người lái.
- Lịch sử bảo trì chỉ làm một giả thuyết hợp lý hơn hoặc kém hơn; không khẳng định nguyên nhân hỏng hóc.
- Nếu `driver.attention` là unknown, nói rõ camera chưa xác định được người lái; cảnh báo của xe vẫn giữ.
- Nếu `driver.responded` là true, nói đã ghi nhận phản hồi nhưng cảnh báo kỹ thuật vẫn được theo dõi.
- Coi mọi dữ liệu là của chiếc xe và người lái thật. Không chẩn đoán y khoa, không nói sẽ điều khiển xe hay gọi cứu hộ, không nói đã được chứng nhận an toàn.
- `recommendations`: chép lại `mandatory_steps` (có thể diễn đạt gọn hơn); chúng chỉ để tham khảo, giao diện luôn hiển thị bước của policy.
""".strip()

_EN_OUTPUT_RULE = """
OUTPUT LANGUAGE: ENGLISH. Write `summary` and `recommendations` in natural spoken English. `summary` is read aloud:
at most 2 short sentences (under 220 characters), addressed directly to the driver, no symbols, brackets or
abbreviations. These instructions and the input labels are in Vietnamese: do not copy Vietnamese into the answer.
Every other rule above applies unchanged: the language only changes the wording, never the level or the steps.
""".strip()


def localized(instructions: str, lang: str) -> str:
    """The instructions for the output language: Vietnamese as written, English with a closing rule."""
    if normalize(lang) != "en":
        return instructions
    return f"{instructions.replace('bằng tiếng Việt', 'bằng tiếng Anh (English)')}\n\n{_EN_OUTPUT_RULE}"


# Wording that would tell a driver who must stop to keep going, to head for a garage or rest area, or to
# open the radiator cap. A negation earlier in the same clause ("Không nên tiếp tục …", "thay vì tiếp tục …",
# "chưa nên đi tiếp") makes it safe; a contrast word ("nhưng", "tuy nhiên", "sau đó") starts a new clause, so
# "không buồn ngủ nhưng nên tiếp tục lái" is still caught.
_CONTINUE = re.compile(
    r"tiếp tục (lái|chạy|hành trình|đi|đến|tới|di chuyển|chuyến)|đi tiếp|chạy tiếp|lái tiếp|di chuyển tiếp"
    r"|cứ (lái|chạy|đi)|(đến|tới|ghé|về|đi|lái|chạy|đưa xe)[^.;,!?]{0,25}(garage|gara|trạm nghỉ|trạm dừng|trạm xăng)"
    r"|mở nắp",
    re.IGNORECASE,
)
_NEGATION = re.compile(r"\b(không|đừng|chưa|thay vì|tránh)\b", re.IGNORECASE)
_CLAUSE_END = re.compile(r"[.;:!?,]|\b(?:nhưng|tuy nhiên|song|sau đó|rồi)\b", re.IGNORECASE)

# The same test for English: keep driving, drive on to a garage or rest area, open the radiator cap. A negation
# earlier in the same clause ("Do not continue …", "instead of driving on …") makes it safe; a contrast word
# ("but", "however", "then") starts a new clause, so "you are not drowsy but should keep driving" is still caught.
_PLACE_EN = r"(?:garage|workshop|mechanic|service (?:centre|center|station)|rest (?:stop|area)|service area|truck stop|gas station|petrol station)"
_CONTINUE_EN = re.compile(
    r"\b(?:continue|proceed|carry on|press on|drive on|keep on)\b"
    r"|\bkeep\b[^.;,!?]{0,12}\b(?:driving|going|moving)\b"
    r"|\b(?:drive|go|head|travel|ride|continue|proceed)\b[^.;,!?]{0,20}\b(?:on|ahead|to|toward|towards|for)\b[^.;,!?]{0,25}\b" + _PLACE_EN + r"\b"
    r"|\b(?:take|bring)\b[^.;,!?]{0,25}\b(?:to|toward|towards)\b[^.;,!?]{0,15}\b" + _PLACE_EN + r"\b"
    r"|\b(?:open|remove|unscrew)\b[^.;,!?]{0,15}\b(?:radiator|coolant|engine)?\s*cap\b",
    re.IGNORECASE,
)
_NEGATION_EN = re.compile(r"\b(?:do not|don't|dont|never|avoid|instead of|rather than|without|should not|shouldn't|must not|mustn't|cannot|can't|no need to|not)\b", re.IGNORECASE)
_CLAUSE_END_EN = re.compile(r"[.;:!?,]|\b(?:but|however|though|then|afterwards|after that)\b", re.IGNORECASE)


def unsafe_for_stop(text: str) -> bool:
    """Whether the wording tells a driver who must stop to carry on (Vietnamese or English)."""
    for pattern, clause_end, negation in ((_CONTINUE, _CLAUSE_END, _NEGATION), (_CONTINUE_EN, _CLAUSE_END_EN, _NEGATION_EN)):
        for match in pattern.finditer(text):
            clause = clause_end.split(text[: match.start()])[-1]
            if not negation.search(clause):
                return True
    return False


_STOP_EN = re.compile(r"\b(?:stop|pull over|park)\b", re.IGNORECASE)
_ENGINE_OFF_EN = re.compile(
    r"\b(?:switch|turn|shut)\s+(?:off|down)\s+(?:the\s+|your\s+)?(?:engine|motor)\b"
    r"|\b(?:switch|turn|shut)\s+(?:the\s+|your\s+)?(?:engine|motor)\s+(?:off|down)\b"
    r"|\bengine\s+off\b",
    re.IGNORECASE,
)


def states_the_stop(text: str, action: str) -> bool:
    """A mandatory stop-the-engine alert must say to stop and to switch the engine off (in either language)."""
    if action != "stop_engine":
        return True
    lowered = text.lower()
    if "dừng" in lowered and ("tắt máy" in lowered or "tắt động cơ" in lowered):
        return True
    return bool(_STOP_EN.search(text) and _ENGINE_OFF_EN.search(text))


log = logging.getLogger("car_neuron.driver")
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="driver-agent")
_agents: dict[str, Any] = {}


def _build_agent(kind: str, lang: str = "vi"):
    from agents import Agent

    import llm_provider

    llm_provider.configure()
    return Agent(
        name="Vehicle Guardian" if kind == "guardian" else "Driver Attention",
        instructions=localized(GUARDIAN_INSTRUCTIONS if kind == "guardian" else INSTRUCTIONS, lang),
        model=llm_provider.model_name(),
        model_settings=llm_provider.model_settings(),
        output_type=DriverNarrative,
    )


def guardian_payload(guardian: GuardianResult) -> dict[str, Any]:
    """Everything the Guardian agent sees: structured values only, never images."""
    block, decision = guardian.block, guardian.decision
    return {
        "ecu": block["vehicle"],
        "driver": block["driver"],
        "maintenance": block["maintenance"],
        "policy": {
            "severity": decision.severity,
            "action": decision.action,
            "must_stop": decision.must_stop,
            "vehicle_level": decision.vehicle_level,
            "rule_summary": guardian.summary,
            "mandatory_steps": guardian.recommendations,
            "evidence": guardian.evidence,
        },
    }


def _narrate(rule: RuleResult, events: list[DriverEvent], moving: bool, guardian: GuardianResult | None = None) -> DriverNarrative:
    from agents import Runner

    kind = "guardian" if guardian else "driver"
    lang = normalize(guardian.lang if guardian else rule.lang)  # the wording the rule texts are already in
    key = f"{kind}:{lang}"
    _agents[key] = _agents.get(key) or _build_agent(kind, lang)
    if guardian:
        payload: dict[str, Any] = guardian_payload(guardian)
    else:
        payload = {
            "vehicle_moving": moving,
            "rule_assessment": {"severity": rule.severity, "state": rule.state, "summary": rule.summary, "evidence": rule.evidence},
            "recent_events": [event.model_dump(mode="json", by_alias=True) for event in events[-6:]],
        }
    result = Runner.run_sync(_agents[key], json.dumps(for_model(payload), ensure_ascii=False), max_turns=2)
    if not isinstance(result.final_output, DriverNarrative):
        raise RuntimeError("driver agent returned an invalid narrative")
    return result.final_output


def _safe_narrate(rule: RuleResult, events: list[DriverEvent], moving: bool,
                  guardian: GuardianResult | None = None) -> tuple[DriverNarrative | None, str | None]:
    try:
        narrative = _narrate(rule, events, moving, guardian) if guardian else _narrate(rule, events, moving)
        if guardian and guardian.decision.must_stop and unsafe_for_stop(narrative.summary):
            log.warning("guardian wording contradicts a mandatory stop; the rule text is used")
            return None, "unsafe_wording"
        if guardian and not states_the_stop(narrative.summary, guardian.decision.action):
            log.warning("guardian wording does not say to stop and switch the engine off; the rule text is used")
            return None, "unsafe_wording"
        return narrative, None
    except Exception:
        log.warning("driver agent failed; the rule text is used", exc_info=True)
        return None, "error"


def submit(rule: RuleResult, events: list[DriverEvent], moving: bool, guardian: GuardianResult | None = None) -> Future | None:
    """Starts the wording in the background, or returns None when the LLM is switched off.
    Nobody waits on it: alerts are returned from the rules at once."""
    if os.getenv("AGENT_MODE", "openai").lower() == "rules":
        return None
    return _executor.submit(_safe_narrate, rule, list(events), moving, guardian)
