import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from dtc.kb import explain
from store import utc_now
from telemetry.db import TelemetryStore, iso_utc
from telemetry.schemas_v2 import MAX_SAMPLE_GAP, IngestBatchV2


def _distance_km(batch: IngestBatchV2, previous_end: datetime | None) -> float:
    """Integrate speed over each gap; gaps longer than a normal sample are skipped."""
    total = 0.0
    previous = previous_end
    for record in batch.records:
        speed = record.signals.get("speed")
        if previous is not None and speed is not None:
            gap = record.captured_at - previous
            if gap <= MAX_SAMPLE_GAP:
                total += speed * gap.total_seconds() / 3600
        previous = record.captured_at
    return total


def add_trip_event(connection, trip_id: str, at: str, kind: str, title: str, ref_id: str | None = None) -> None:
    connection.execute(
        "INSERT INTO trip_events (id, trip_id, at, kind, title, ref_id) VALUES (?, ?, ?, ?, ?, ?)",
        (f"evt_{uuid4().hex[:12]}", trip_id, at, kind, title[:200], ref_id),
    )
    connection.execute("UPDATE trips SET event_count = event_count + 1 WHERE id = ?", (trip_id,))


def ingest_batch(
    telemetry: TelemetryStore,
    device: dict[str, Any],
    batch: IngestBatchV2,
) -> dict[str, Any]:
    """Store one gateway batch. Raises PermissionError if it belongs to another device.

    Besides the public reply fields, the result says whether this batch opened the
    trip, brought new DTCs or changed the vehicle profile; the caller uses that to
    notify the dashboard and decide whether to run an analysis.
    """
    if batch.device_id != device["id"]:
        raise PermissionError("deviceId does not match the device token")
    vehicle_id = device["vehicle_id"]
    telemetry.initialize()

    with telemetry.base.transaction() as connection:
        claimed = connection.execute(
            "INSERT INTO ingest_batches (id, device_id, trip_id, seq, received_at) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            (batch.batch_id, device["id"], batch.trip_id, batch.seq, utc_now()),
        ).rowcount
        result: dict[str, Any] = {
            "batch_id": batch.batch_id,
            "trip_id": batch.trip_id,
            "vehicle_id": vehicle_id,
            "simulated": batch.simulated,
            "new_trip": False,
            "new_dtc_codes": [],
            "profile_changed": False,
        }
        if not claimed:
            return {**result, "status": "duplicate", "accepted_records": 0}

        first = batch.records[0].captured_at
        last = batch.records[-1].captured_at
        trip = connection.execute(
            "SELECT vehicle_id, device_id, ended_at FROM trips WHERE id = ?",
            (batch.trip_id,),
        ).fetchone()
        if trip is None:
            connection.execute(
                "INSERT INTO trips (id, vehicle_id, device_id, source, simulated, "
                "started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    batch.trip_id,
                    vehicle_id,
                    device["id"],
                    batch.source,
                    int(batch.simulated),
                    iso_utc(first),
                    iso_utc(last),
                ),
            )
            add_trip_event(connection, batch.trip_id, iso_utc(first), "start", "Bắt đầu chuyến")
            result["new_trip"] = True
            previous_end = None
        elif trip["vehicle_id"] != vehicle_id or trip["device_id"] != device["id"]:
            raise PermissionError("tripId belongs to another device")
        else:
            previous_end = datetime.fromisoformat(trip["ended_at"])

        inserted = connection.executemany(
            "INSERT INTO samples (trip_id, captured_at, lat, lon, location_fixed, "
            "signals_json) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(trip_id, captured_at) DO NOTHING",
            [
                (
                    batch.trip_id,
                    iso_utc(record.captured_at),
                    record.location.lat if record.location else None,
                    record.location.lon if record.location else None,
                    int(bool(record.location and record.location.fixed)),
                    json.dumps(record.signals),
                )
                for record in batch.records
            ],
        ).rowcount

        coolant = max((r.signals["coolant"] for r in batch.records if "coolant" in r.signals), default=None)
        connection.execute(
            """
            UPDATE trips SET
                ended_at = MAX(ended_at, ?),
                sample_count = sample_count + ?,
                distance_km = distance_km + ?,
                max_coolant = CASE
                    WHEN ? IS NULL THEN max_coolant
                    WHEN max_coolant IS NULL OR ? > max_coolant THEN ?
                    ELSE max_coolant END
            WHERE id = ?
            """,
            (
                iso_utc(last),
                inserted,
                _distance_km(batch, previous_end),
                coolant,
                coolant,
                coolant,
                batch.trip_id,
            ),
        )

        if batch.vehicle:
            pids = json.dumps(batch.vehicle.supported_pids)
            before = connection.execute(
                "SELECT vin, protocol, supported_pids_json FROM vehicles WHERE id = ?", (vehicle_id,)
            ).fetchone()
            connection.execute(
                """
                INSERT INTO vehicles (id, vin, protocol, supported_pids_json, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    vin = COALESCE(excluded.vin, vehicles.vin),
                    protocol = COALESCE(excluded.protocol, vehicles.protocol),
                    supported_pids_json = CASE
                        WHEN excluded.supported_pids_json = '[]'
                        THEN vehicles.supported_pids_json
                        ELSE excluded.supported_pids_json END,
                    updated_at = excluded.updated_at
                """,
                (vehicle_id, batch.vehicle.vin, batch.vehicle.protocol, pids, utc_now()),
            )
            after = connection.execute(
                "SELECT vin, protocol, supported_pids_json FROM vehicles WHERE id = ?", (vehicle_id,)
            ).fetchone()
            result["profile_changed"] = before is None or tuple(before) != tuple(after)

        if batch.dtc:
            seen = iso_utc(batch.dtc.read_at)
            frame = batch.dtc.freeze_frame
            connection.execute(
                "UPDATE trips SET last_dtc_read_at = ?, mil = ? WHERE id = ?",
                (seen, int(batch.dtc.mil), batch.trip_id),
            )
            for kind, codes in (("stored", batch.dtc.stored), ("pending", batch.dtc.pending)):
                for code in codes:
                    frame_json = (
                        json.dumps(frame.signals) if frame and frame.dtc == code else None
                    )
                    known = connection.execute(
                        "SELECT 1 FROM dtc_events WHERE vehicle_id = ? AND trip_id = ? "
                        "AND code = ? AND kind = ?",
                        (vehicle_id, batch.trip_id, code, kind),
                    ).fetchone()
                    connection.execute(
                        """
                        INSERT INTO dtc_events (id, vehicle_id, trip_id, code, kind, mil,
                            first_seen_at, last_seen_at, freeze_frame_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(vehicle_id, trip_id, code, kind) DO UPDATE SET
                            mil = excluded.mil,
                            last_seen_at = excluded.last_seen_at,
                            freeze_frame_json = COALESCE(
                                excluded.freeze_frame_json, dtc_events.freeze_frame_json)
                        """,
                        (
                            f"dtc_{uuid4().hex[:12]}",
                            vehicle_id,
                            batch.trip_id,
                            code,
                            kind,
                            int(batch.dtc.mil),
                            seen,
                            seen,
                            frame_json,
                        ),
                    )
                    if not known:
                        result["new_dtc_codes"].append(code)
                        label = "Mã lỗi đã lưu" if kind == "stored" else "Mã lỗi đang chờ"
                        add_trip_event(
                            connection, batch.trip_id, seen, "dtc",
                            f"{label} {code}: {explain(code)['title']}", code,
                        )

    return {**result, "status": "accepted", "accepted_records": inserted}
