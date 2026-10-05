from datetime import datetime, timezone

import pytest

from car_neuron_gateway.allowlist import ForbiddenCommand
from car_neuron_gateway.clock import FakeClock
from car_neuron_gateway.dtc import decode_dtc, encode_dtc, parse_dtc_message
from car_neuron_gateway.elm327 import Elm327, messages
from car_neuron_gateway.fake_elm import FakeElm327
from car_neuron_gateway.pids import BY_NAME, PIDS, decode_value
from car_neuron_gateway.scenarios import FAKE_VIN, Overheat, Scenario
from car_neuron_gateway.sources import ObdSource
from car_neuron_gateway.transport import LoopbackTransport


def _client(scenario=None, profile="full"):
    clock = FakeClock(start=0)
    fake = FakeElm327(scenario or Scenario(), clock, profile)
    elm = Elm327(LoopbackTransport(fake))
    elm.initialize()
    return elm, fake, clock


def test_known_sae_examples_decode() -> None:
    assert decode_value(BY_NAME["rpm"], bytes([0x1A, 0xF8])) == 1726
    assert decode_value(BY_NAME["coolant"], bytes([0x7B])) == 83
    assert decode_value(BY_NAME["battery"], bytes([0x37, 0x08])) == 14.09  # 14.088 V, rounded to 2 decimals
    assert decode_value(BY_NAME["ambient"], bytes([0xFF])) is None  # 215 °C is outside the schema


@pytest.mark.parametrize("pid", PIDS, ids=lambda p: p.name)
def test_encode_decode_round_trip(pid) -> None:
    middle = (pid.low + min(pid.high, 200)) / 2
    assert decode_value(pid, pid.encode(middle)) == pytest.approx(middle, abs=0.8)


def test_dtc_codes_and_replies() -> None:
    assert decode_dtc(0x02, 0x17) == "P0217"
    assert decode_dtc(*encode_dtc("C1234")) == "C1234"
    assert parse_dtc_message(bytes([0x43, 0x01, 0x02, 0x17])) == ["P0217"]  # CAN, count byte
    assert parse_dtc_message(bytes([0x43, 0x01, 0x71, 0, 0, 0, 0])) == ["P0171"]  # legacy padding
    assert parse_dtc_message(bytes([0x43, 0x00])) == []


def test_iso_tp_lines_are_reassembled() -> None:
    lines = ["014", "0: 49 02 01 43 4E 58", "1: 46 41 4B 45 45 4C 4D", "2: 30 30 30 30 30 30 31"]
    assert messages(lines) == [bytes([0x49, 0x02, 0x01]) + FAKE_VIN.encode()]


def test_client_reads_profile_vin_and_values() -> None:
    elm, fake, clock = _client(profile="minimal")
    source = ObdSource(elm)
    vehicle = source.connect()

    assert vehicle["vin"] == FAKE_VIN
    assert "0105" in vehicle["supportedPids"] and "015C" not in vehicle["supportedPids"]
    assert "oil" not in source.available()
    clock.t = 200
    values = source.read({"fast", "slow", "rare"})
    assert values["coolant"] == pytest.approx(Scenario().values(200)["coolant"], abs=1)
    assert "oil" not in values and "ambient" not in values


def test_overheat_dtc_and_freeze_frame_are_read() -> None:
    scenario = Overheat()
    elm, fake, clock = _client(scenario)
    source = ObdSource(elm)
    source.connect()

    clock.t = scenario.time_at(116)
    early = source.read_dtc(datetime.now(timezone.utc))
    assert early["pending"] == ["P0217"] and not early["stored"]

    clock.t = 175
    late = source.read_dtc(datetime.now(timezone.utc))
    assert late["mil"] and late["stored"] == ["P0217"]
    assert late["freezeFrame"]["dtc"] == "P0217"
    assert late["freezeFrame"]["signals"]["coolant"] == pytest.approx(118, abs=1)


def test_clear_codes_never_reach_the_car() -> None:
    elm, fake, _ = _client()
    with pytest.raises(ForbiddenCommand):
        elm.command("04")
    assert fake.clear_requests == 0
