import json
from datetime import datetime, timedelta, timezone
from functools import reduce

import httpx
import pytest

from car_neuron_gateway.batcher import Batcher
from car_neuron_gateway.clock import FakeClock
from car_neuron_gateway.elm327 import Elm327
from car_neuron_gateway.fake_elm import FakeElm327
from car_neuron_gateway.gps import FixedLocation, parse_nmea
from car_neuron_gateway.runner import run
from car_neuron_gateway.scenarios import Overheat
from car_neuron_gateway.sources import ObdSource
from car_neuron_gateway.transport import LoopbackTransport
from car_neuron_gateway.trip import TripTracker
from car_neuron_gateway.uploader import REJECTED, SENT, SPOOLED, Uploader

T0 = datetime(2026, 10, 11, 1, 0, tzinfo=timezone.utc)


def test_trip_ends_after_two_minutes_engine_off_and_restarts() -> None:
    trips = TripTracker()
    first = trips.update(T0, 800)
    assert trips.update(T0 + timedelta(seconds=60), 0) == first
    assert trips.update(T0 + timedelta(seconds=181), 0) is None
    assert trips.update(T0 + timedelta(seconds=182), 0) is None
    second = trips.update(T0 + timedelta(seconds=183), 900)
    assert second and second != first


def test_batcher_sends_vehicle_once_and_flushes_on_faults_and_gaps() -> None:
    batcher = Batcher("dev_1", "obd", {"vin": None, "supportedPids": []}, size=3)
    record = {"signals": {}}
    sent = []
    for i in range(4):
        sent += batcher.add("trip-a", T0 + timedelta(seconds=i), record)
    sent += batcher.add("trip-a", T0 + timedelta(seconds=30), record)  # gap > 10 s
    fault = {"readAt": "x", "mil": True, "stored": ["P0217"], "pending": []}
    sent += batcher.add("trip-a", T0 + timedelta(seconds=31), record, fault)

    assert [len(b["records"]) for b in sent] == [3, 1, 2]
    assert "vehicle" in sent[0] and all("vehicle" not in b for b in sent[1:])
    assert [b["seq"] for b in sent] == [0, 1, 2] and sent[2]["dtc"] == fault


def test_nmea_positions() -> None:
    body = "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W"
    checksum = reduce(lambda acc, ch: acc ^ ord(ch), body, 0)
    assert parse_nmea(f"${body}*{checksum:02X}") == {"lat": 48.1173, "lon": 11.516667}
    assert parse_nmea(f"${body}*00") is None  # bad checksum
    assert FixedLocation(10.8, 106.7).location()["fixed"] is True


def _uploader(tmp_path, handler) -> Uploader:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return Uploader("http://backend", "cnd_test", tmp_path / "spool", client=client)


def test_offline_batches_are_spooled_then_sent_in_order(tmp_path) -> None:
    online, received = False, []

    def handler(request: httpx.Request) -> httpx.Response:
        if not online:
            raise httpx.ConnectError("offline")
        assert request.headers["Authorization"] == "Bearer cnd_test"
        received.append(json.loads(request.content)["batchId"])
        return httpx.Response(202, json={"status": "accepted"})

    uploader = _uploader(tmp_path, handler)
    assert uploader.send({"batchId": "b1"}) == SPOOLED
    assert uploader.send({"batchId": "b2"}) == SPOOLED
    online = True
    assert uploader.send({"batchId": "b3"}) == SENT
    assert received == ["b1", "b2", "b3"] and uploader.pending() == 0


def test_rejected_batches_are_kept_aside_not_retried(tmp_path) -> None:
    uploader = _uploader(tmp_path, lambda request: httpx.Response(422, json={"detail": "bad"}))
    assert uploader.send({"batchId": "bad"}) == REJECTED
    assert uploader.pending() == 0
    assert len(list((tmp_path / "spool" / "rejected").glob("*.json"))) == 1


def test_overheat_run_end_to_end() -> None:
    clock = FakeClock(start=T0.timestamp())
    fake = FakeElm327(Overheat(), clock)
    batches: list[dict] = []

    def send(batch: dict) -> str:
        batches.append(batch)
        return SENT

    outcomes = run(
        ObdSource(Elm327(LoopbackTransport(fake))),
        send,
        clock,
        "dev_1",
        "fake-elm",
        FixedLocation(10.8023, 106.7311),
        duration=200,
        log=lambda message: None,
    )

    records = [r for b in batches for r in b["records"]]
    assert outcomes[SENT] == len(batches) and len(records) == 200
    assert len({b["tripId"] for b in batches}) == 1
    assert [b["seq"] for b in batches] == list(range(len(batches)))
    assert batches[0]["vehicle"]["vin"] == fake.vin
    assert max(r["signals"]["coolant"] for r in records) >= 120
    assert all(r["location"]["fixed"] for r in records)
    faults = [b["dtc"] for b in batches if b.get("dtc", {}).get("stored")]
    assert faults and faults[0]["freezeFrame"]["dtc"] == "P0217"
    for batch in batches:
        times = [datetime.fromisoformat(r["capturedAt"]) for r in batch["records"]]
        assert all(timedelta(seconds=0.5) <= b - a <= timedelta(seconds=10) for a, b in zip(times, times[1:]))
    assert fake.clear_requests == 0


@pytest.mark.parametrize("argv", [["--source", "obd"], ["--source", "obd", "--port", "x", "--fast"]])
def test_cli_rejects_unsafe_combinations(argv) -> None:
    from car_neuron_gateway.__main__ import main

    with pytest.raises(SystemExit):
        main([*argv, "--dry-run"])
