"""Optional LLM wording for an alert. It only receives structured events (never video)."""

import json
import logging
import os
import re
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from driver.guardian import GuardianResult
from driver.rules import RuleResult
from driver.schemas import DriverEvent, DriverNarrative

INSTRUCTIONS = """
Bạn là trợ lý chú ý của tài xế trong Car Neuron. Bạn chỉ nhận các chỉ số có cấu trúc do camera trên xe tính ngay trong trình duyệt; không bao giờ có hình ảnh hay video.

Việc của bạn: viết lại kết luận của luật xác định cho tài xế bằng tiếng Việt, ngắn gọn, bình tĩnh, dựa trên số liệu trong `recent_events` và `rule_assessment`.

Quy tắc:
- Không đổi mức độ (`rule_assessment.severity`); không hạ thấp nguy cơ.
- Không chẩn đoán y khoa (không nói tài xế mắc bệnh hay rối loạn giấc ngủ). Chỉ nói "có dấu hiệu".
- Không nói hệ thống đã được chứng nhận an toàn ô tô, không nói sẽ điều khiển xe hoặc gọi cứu hộ.
- Khuyến nghị chỉ gồm hành động của tài xế: dừng xe an toàn, nghỉ, đổi người lái, nhìn lại đường.
- Nếu độ tin cậy thấp, nói rõ phép đo chưa chắc chắn.
- `summary` tối đa 2 câu; `recommendations` 1–4 bước, không trùng nhau.
""".strip()

GUARDIAN_INSTRUCTIONS = """
Bạn là Vehicle Guardian trong Car Neuron. Bạn kết hợp ba nguồn có cấu trúc: dữ liệu ECU của xe (`ecu`, hiện là dữ liệu mô phỏng), trạng thái người lái do camera tính trong trình duyệt (`driver`, không bao giờ có hình ảnh) và lịch sử bảo trì (`maintenance`, dữ liệu mô phỏng).

`policy` là quyết định của safety policy cố định: mức độ, hành động bắt buộc (`action`, `mandatory_steps`) và việc có phải dừng xe hay không (`must_stop`). Bạn không được thay đổi quyết định đó.

Việc của bạn: viết `summary` tối đa 3 câu tiếng Việt, bình tĩnh, giải thích vì sao có hành động này, trích số liệu cụ thể (tốc độ, nhiệt độ, thời gian nhắm mắt, thời gian lái) và nêu bước tiếp theo đúng như `mandatory_steps`.

Quy tắc:
- Không hạ mức độ, không gợi ý tiếp tục lái, đi tiếp đến garage hay trạm nghỉ khi `must_stop` là true.
- `action` là stop_engine: phải dừng xe ở vị trí an toàn và tắt máy, bất kể trạng thái người lái.
- Lịch sử bảo trì chỉ làm một giả thuyết hợp lý hơn hoặc kém hơn; không khẳng định nguyên nhân hỏng hóc.
- Nếu `driver.attention` là unknown, nói rõ camera chưa xác định được người lái; cảnh báo của xe vẫn giữ.
- Nếu `driver.responded` là true, nói đã ghi nhận phản hồi nhưng cảnh báo kỹ thuật vẫn được theo dõi.
- Nói rõ dữ liệu xe là mô phỏng. Không chẩn đoán y khoa, không nói sẽ điều khiển xe hay gọi cứu hộ, không nói đã được chứng nhận an toàn.
- `recommendations`: chép lại `mandatory_steps` (có thể diễn đạt gọn hơn); chúng chỉ để tham khảo, giao diện luôn hiển thị bước của policy.
""".strip()

# Wording that would tell a driver who must stop to keep going. A negation earlier in the same
# clause ("Không nên tiếp tục …", "thay vì tiếp tục …", "chưa nên đi tiếp") makes it safe.
_CONTINUE = re.compile(r"tiếp tục (lái|chạy|hành trình|đi|đến|tới)|đi tiếp|chạy tiếp|lái tiếp", re.IGNORECASE)
_NEGATION = re.compile(r"\b(không|đừng|chưa|thay vì|tránh)\b", re.IGNORECASE)


def unsafe_for_stop(text: str) -> bool:
    for match in _CONTINUE.finditer(text):
        clause = re.split(r"[.;:!?,]", text[: match.start()])[-1]
        if not _NEGATION.search(clause):
            return True
    return False


log = logging.getLogger("car_neuron.driver")
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="driver-agent")
_agents: dict[str, Any] = {}


def _build_agent(kind: str):
    from agents import Agent

    import llm_provider

    llm_provider.configure()
    return Agent(
        name="Vehicle Guardian" if kind == "guardian" else "Driver Attention",
        instructions=GUARDIAN_INSTRUCTIONS if kind == "guardian" else INSTRUCTIONS,
        model=llm_provider.model_name(),
        model_settings=llm_provider.model_settings(),
        output_type=DriverNarrative,
    )


def guardian_payload(guardian: GuardianResult) -> dict[str, Any]:
    """Everything the Guardian agent sees: structured values only, never images."""
    block, decision = guardian.block, guardian.decision
    return {
        "ecu": {**block["vehicle"], "simulated": True},
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
    _agents[kind] = _agents.get(kind) or _build_agent(kind)
    if guardian:
        payload: dict[str, Any] = guardian_payload(guardian)
    else:
        payload = {
            "vehicle_moving": moving,
            "rule_assessment": {"severity": rule.severity, "state": rule.state, "summary": rule.summary, "evidence": rule.evidence},
            "recent_events": [event.model_dump(mode="json", by_alias=True) for event in events[-6:]],
        }
    result = Runner.run_sync(_agents[kind], json.dumps(payload, ensure_ascii=False), max_turns=2)
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
