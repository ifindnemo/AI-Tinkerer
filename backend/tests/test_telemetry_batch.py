import pytest
from pydantic import ValidationError

from schemas import TelemetryBatchInput


def _record(captured_at: str, latitude: float, longitude: float, fault: str):
    return {
        "capturedAt": captured_at,
        "rpm": 2450,
        "map": 68.2,
        "tps": 34.5,
        "engineLoad": 57.1,
        "consumption": 8.4,
        "speed": 62,
        "coolant": 96,
        "intake": 38,
        "battery": 13.9,
        "location": {"lat": latitude, "lon": longitude},
        "fault": fault,
    }


def _batch() -> dict:
    return {
        "schemaVersion": 1,
        "batchId": "batch-demo-001",
        "vehicleId": "vehicle-demo-001",
        "source": "blackbox-simulator",
        "sampleIntervalMs": 1000,
        "recordCount": 2,
        "records": [
            _record("2026-09-12T06:29:59Z", 10.8011, 106.7311, "normal"),
            _record("2026-09-12T06:30:00Z", 10.8023, 106.7328, "overheat"),
        ],
    }


def test_batch_uses_last_location_and_excludes_fault_from_agent_context() -> None:
    batch = TelemetryBatchInput.model_validate(_batch())

    context = batch.to_agent_context()

    assert context["current_location"] == {
        "latitude": 10.8023,
        "longitude": 106.7328,
    }
    assert all("fault" not in record for record in context["records"])


def test_batch_rejects_record_count_mismatch() -> None:
    payload = _batch()
    payload["recordCount"] = 15

    with pytest.raises(ValidationError, match="recordCount must match"):
        TelemetryBatchInput.model_validate(payload)
