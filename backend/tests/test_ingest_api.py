import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from store import Store
from telemetry.db import MIGRATIONS, TelemetryStore, hash_token
from telemetry.ingest import ingest_batch
from analysis.worker import AnalysisWorker
from telemetry.routes import get_broker, get_telemetry_store, get_worker, router
from telemetry.stream import Broker
from telemetry.schemas_v2 import IngestBatchV2


@pytest.fixture
def telemetry(tmp_path) -> TelemetryStore:
    store = TelemetryStore(Store(tmp_path / "ingest-test.db"))
    store.initialize()
    return store


@pytest.fixture
def device(telemetry) -> dict:
    return telemetry.create_device("bmw-m2", "laptop")


def _payload(device_id: str, **overrides) -> dict:
    payload = {
        "schemaVersion": 2,
        "batchId": "b-001",
        "deviceId": device_id,
        "tripId": "trip-001",
        "seq": 0,
        "source": "obd",
        "sampleIntervalMs": 1000,
        "vehicle": {"vin": "WBA00000000000001", "supportedPids": ["0105", "010C", "010D"]},
        "records": [
            {
                "capturedAt": f"2026-10-11T08:15:0{i}+07:00",
                "location": {"lat": 10.8, "lon": 106.7},
                "signals": {"rpm": 2000, "speed": 36, "coolant": 90 + i},
            }
            for i in range(3)
        ],
    }
    payload.update(overrides)
    return payload


def _rows(telemetry: TelemetryStore, sql: str) -> list[dict]:
    with telemetry.base.connect() as connection:
        return [dict(row) for row in connection.execute(sql)]


def test_migration_sets_user_version_and_is_repeatable(telemetry) -> None:
    TelemetryStore(telemetry.base).initialize()

    assert _rows(telemetry, "PRAGMA user_version")[0]["user_version"] == len(MIGRATIONS)


def test_database_at_version_1_is_upgraded(tmp_path) -> None:
    base = Store(tmp_path / "v1.db")
    base.initialize()
    with base.transaction() as connection:
        connection.executescript(MIGRATIONS[0])
        connection.execute("PRAGMA user_version = 1")
        connection.execute(
            "INSERT INTO trips (id, vehicle_id, device_id, source, simulated, started_at, ended_at) "
            "VALUES ('t1', 'v', 'd', 'obd', 0, 'a', 'b')"
        )

    upgraded = TelemetryStore(base)
    upgraded.initialize()

    assert _rows(upgraded, "PRAGMA user_version")[0]["user_version"] == 2
    trip = _rows(upgraded, "SELECT mil, last_dtc_read_at FROM trips")[0]
    assert trip == {"mil": 0, "last_dtc_read_at": None}
    assert _rows(upgraded, "SELECT COUNT(*) AS n FROM analyses")[0]["n"] == 0


def test_device_token_is_stored_only_as_a_hash(telemetry, device) -> None:
    stored = _rows(telemetry, "SELECT token_hash FROM devices")[0]["token_hash"]

    assert stored == hash_token(device["token"]) != device["token"]
    assert telemetry.authenticate(device["token"])["id"] == device["id"]
    assert telemetry.authenticate("cnd_wrong") is None


def test_ingest_stores_trip_samples_and_vehicle_profile(telemetry, device) -> None:
    batch = IngestBatchV2.model_validate(_payload(device["id"]))

    result = ingest_batch(telemetry, device, batch)

    assert result["status"] == "accepted" and result["accepted_records"] == 3
    trip = _rows(telemetry, "SELECT * FROM trips")[0]
    assert trip["vehicle_id"] == "bmw-m2" and trip["simulated"] == 0
    assert trip["started_at"] == "2026-10-11T01:15:00.000+00:00"
    assert trip["max_coolant"] == 92 and trip["sample_count"] == 3
    assert trip["distance_km"] == pytest.approx(36 * 2 / 3600)
    vehicle = _rows(telemetry, "SELECT * FROM vehicles")[0]
    assert vehicle["vin"] == "WBA00000000000001"
    assert json.loads(vehicle["supported_pids_json"]) == ["0105", "010C", "010D"]


def test_duplicate_batch_is_ignored(telemetry, device) -> None:
    batch = IngestBatchV2.model_validate(_payload(device["id"]))
    ingest_batch(telemetry, device, batch)

    again = ingest_batch(telemetry, device, batch)

    assert again["status"] == "duplicate"
    assert _rows(telemetry, "SELECT sample_count FROM trips")[0]["sample_count"] == 3


def test_rejects_batches_and_trips_of_another_device(telemetry, device) -> None:
    other = telemetry.create_device("bmw-m2", "other")
    with pytest.raises(PermissionError):
        ingest_batch(telemetry, device, IngestBatchV2.model_validate(_payload(other["id"])))

    ingest_batch(telemetry, device, IngestBatchV2.model_validate(_payload(device["id"])))
    stolen_trip = IngestBatchV2.model_validate(_payload(other["id"], batchId="b-002"))
    with pytest.raises(PermissionError):
        ingest_batch(telemetry, other, stolen_trip)
    assert len(_rows(telemetry, "SELECT id FROM ingest_batches")) == 1


def test_dtc_events_keep_the_freeze_frame(telemetry, device) -> None:
    payload = _payload(
        device["id"],
        dtc={
            "readAt": "2026-10-11T08:15:02+07:00",
            "mil": True,
            "stored": ["P0217"],
            "pending": ["P0128"],
            "freezeFrame": {"dtc": "P0217", "signals": {"coolant": 121, "rpm": 2400}},
        },
    )

    ingest_batch(telemetry, device, IngestBatchV2.model_validate(payload))

    events = {row["code"]: row for row in _rows(telemetry, "SELECT * FROM dtc_events")}
    assert events["P0217"]["kind"] == "stored" and events["P0217"]["mil"] == 1
    assert json.loads(events["P0217"]["freeze_frame_json"]) == {"coolant": 121, "rpm": 2400}
    assert events["P0128"]["freeze_frame_json"] is None


def test_ingest_endpoint_requires_a_device_token(telemetry, device) -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    events = Broker()
    worker = AnalysisWorker(telemetry, events, agent=object())
    app.dependency_overrides[get_telemetry_store] = lambda: telemetry
    app.dependency_overrides[get_broker] = lambda: events
    app.dependency_overrides[get_worker] = lambda: worker
    client = TestClient(app)
    payload = _payload(device["id"])

    assert client.post("/api/ingest/batch", json=payload).status_code == 401
    bad_auth = {"Authorization": "Bearer cnd_wrong"}
    assert client.post("/api/ingest/batch", json=payload, headers=bad_auth).status_code == 401

    auth = {"Authorization": f"Bearer {device['token']}"}
    response = client.post("/api/ingest/batch", json=payload, headers=auth)
    assert response.status_code == 202 and response.json()["accepted_records"] == 3

    payload["records"][0]["signals"]["fan"] = 10
    payload["batchId"] = "b-002"
    assert client.post("/api/ingest/batch", json=payload, headers=auth).status_code == 422
