from datetime import datetime, timezone

import pytest

from dtc.kb import DTC_PATTERN, KB, URGENCY_LABELS, explain
from telemetry.vin import make_from_vin, model_year_from_vin


def test_every_entry_is_well_formed() -> None:
    assert len(KB) >= 60
    for code, info in KB.items():
        assert DTC_PATTERN.fullmatch(code) and info.code == code
        assert info.urgency in URGENCY_LABELS
        assert info.title and info.meaning and info.advice and info.causes and info.checks


@pytest.mark.parametrize("code", ["P0217", "P0301", "P0171", "P0128", "P0420"])
def test_codes_used_by_the_demo_scenarios_are_known(code) -> None:
    assert explain(code)["known"] is True


def test_overheat_is_the_only_critical_default() -> None:
    assert [code for code, info in KB.items() if info.urgency == "critical"] == ["P0217"]


def test_generated_families_have_the_right_numbers() -> None:
    assert {f"P030{n}" for n in range(1, 9)} <= KB.keys()
    assert {f"P0{n}" for n in range(130, 142)} <= KB.keys()
    assert "sau bộ xúc tác" in KB["P0136"].title and "trước bộ xúc tác" in KB["P0135"].title


@pytest.mark.parametrize("code", ["P1234", "P0999", "U0100"])
def test_unknown_codes_are_never_guessed(code) -> None:
    info = explain(code)
    assert info["known"] is False
    assert "cần máy chẩn đoán của hãng" in info["meaning"]
    assert info["causes"] == []


def test_manufacturer_specific_codes_are_labelled() -> None:
    assert explain("P1234")["title"] == "Mã riêng của hãng xe"
    assert explain("P0999")["title"] == "Mã chưa có trong kho tra cứu"


def test_vin_hints() -> None:
    today = datetime(2026, 10, 4, tzinfo=timezone.utc)
    assert make_from_vin("WBS00000000000001") == "BMW M"
    assert make_from_vin("JTDBR32E720012345") == "Toyota"
    assert make_from_vin("CNXFAKEELM0000001") is None
    assert model_year_from_vin("WBS000000R0000001", today) == 2024
    assert model_year_from_vin("WBS000000W0000001", today) == 1998  # 2028 is in the future
    assert model_year_from_vin("WBS00000000000001", today) is None  # 0 is not a year code
