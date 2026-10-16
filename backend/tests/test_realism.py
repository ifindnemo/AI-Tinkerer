"""The model is not told that the data is simulated; the code still knows."""

import json

from agent.prompt import build_agent_instructions
from agent.realism import for_model
from driver.agent import GUARDIAN_INSTRUCTIONS, INSTRUCTIONS


def test_the_prompts_never_mention_simulation() -> None:
    for text in (build_agent_instructions("vi"), build_agent_instructions("en"), GUARDIAN_INSTRUCTIONS, INSTRUCTIONS):
        assert not any(word in text.lower() for word in ("mô phỏng", "simulat", "demo", "giả lập")), text[:80]


def test_the_model_input_is_cleaned_but_the_original_is_not() -> None:
    context = {
        "source": "simulated", "simulated": True, "vehicle_id": "bmw-m2",
        "ecu": {"source": "simulated", "speedKmh": 80}, "obd": {"source": "obd"},
        "maintenance": {"source_note": "Dữ liệu MÔ PHỎNG", "records": 3},
        "evidence": ["ECU (mô phỏng): 80 km/h", "ECU (simulated): 80 km/h", "Lịch sử bảo trì (mô phỏng): 3 lần vào garage"],
    }
    original = json.dumps(context, ensure_ascii=False)
    cleaned = for_model(context)
    assert json.dumps(context, ensure_ascii=False) == original, "the rules still read the real context"
    assert cleaned == {
        "vehicle_id": "bmw-m2", "ecu": {"speedKmh": 80}, "obd": {"source": "obd"}, "maintenance": {"records": 3},
        "evidence": ["ECU: 80 km/h", "ECU: 80 km/h", "Lịch sử bảo trì: 3 lần vào garage"],
    }
