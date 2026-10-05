from datetime import timezone

import pytest
from pydantic import ValidationError

from telemetry.schemas_v2 import IngestBatchV2


def _batch(**overrides) -> dict:
    batch = {
        "schemaVersion": 2,
        "batchId": "b-001",
        "deviceId": "dev_laptop01",
        "tripId": "trip-001",
        "seq": 0,
        "source": "obd",
        "sampleIntervalMs": 1000,
        "records": [
            {"capturedAt": "2026-10-11T08:15:00+07:00", "signals": {"rpm": 812, "coolant": 88}},
            {"capturedAt": "2026-10-11T08:15:01+07:00", "signals": {"rpm": 820}},
        ],
    }
    batch.update(overrides)
    return batch


def test_accepts_records_with_missing_sensors_and_no_location() -> None:
    batch = IngestBatchV2.model_validate(_batch())

    assert batch.records[1].signals == {"rpm": 820}
    assert batch.records[0].location is None
    assert batch.simulated is False


def test_normalizes_timestamps_to_utc() -> None:
    batch = IngestBatchV2.model_validate(_batch())

    first = batch.records[0].captured_at
    assert first.tzinfo == timezone.utc
    assert first.hour == 1


def test_simulator_sources_are_labelled_simulated() -> None:
    assert IngestBatchV2.model_validate(_batch(source="fake-elm")).simulated


@pytest.mark.parametrize(
    "signals",
    [{"fan": 10}, {"coolant": 999}, {"coolant": float("nan")}],
    ids=["unknown", "out-of-range", "nan"],
)
def test_rejects_bad_signals(signals) -> None:
    payload = _batch()
    payload["records"][0]["signals"] = signals

    with pytest.raises(ValidationError):
        IngestBatchV2.model_validate(payload)


def test_rejects_timestamps_without_offset_or_out_of_order() -> None:
    naive = _batch()
    naive["records"][0]["capturedAt"] = "2026-10-11T08:15:00"
    reversed_order = _batch()
    reversed_order["records"].reverse()

    for payload in (naive, reversed_order):
        with pytest.raises(ValidationError):
            IngestBatchV2.model_validate(payload)


def test_validates_vehicle_and_dtc_blocks() -> None:
    good = _batch(
        vehicle={"vin": "WBA00000000000001", "supportedPids": ["0105", "010C"]},
        dtc={
            "readAt": "2026-10-11T08:15:00+07:00",
            "mil": True,
            "stored": ["P0217"],
            "freezeFrame": {"dtc": "P0217", "signals": {"coolant": 121}},
        },
    )
    assert IngestBatchV2.model_validate(good).dtc.stored == ["P0217"]

    bad_code = _batch(dtc={"readAt": "2026-10-11T08:15:00+07:00", "mil": True, "stored": ["X123"]})
    bad_vin = _batch(vehicle={"vin": "WBA0000000000000I"})
    for payload in (bad_code, bad_vin):
        with pytest.raises(ValidationError):
            IngestBatchV2.model_validate(payload)
