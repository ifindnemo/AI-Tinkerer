"""Groups records into ingest v2 batches (backend/telemetry/schemas_v2.py)."""

import uuid
from datetime import datetime, timedelta

MAX_GAP = timedelta(seconds=10)  # the backend rejects larger gaps inside one batch


class Batcher:
    def __init__(self, device_id: str, source: str, vehicle: dict | None, size: int = 15):
        self.device_id = device_id
        self.source = source
        self.vehicle = vehicle
        self.size = size
        self.trip_id: str | None = None
        self.seq = 0
        self.records: list[dict] = []
        self.last_at: datetime | None = None
        self.dtc: dict | None = None

    def add(self, trip_id: str, at: datetime, record: dict, dtc: dict | None = None) -> list[dict]:
        """Add one record; return the batches that are ready to send."""
        ready = []
        if trip_id != self.trip_id:
            ready += self.flush()
            self.trip_id, self.seq = trip_id, 0
        elif self.last_at and at - self.last_at > MAX_GAP:
            ready += self.flush()
        self.records.append(record)
        self.last_at = at
        if dtc:
            self.dtc = dtc
        # A new fault should reach the backend now, not at the end of the batch.
        urgent = bool(dtc and (dtc["stored"] or dtc["pending"]))
        if len(self.records) >= self.size or urgent:
            ready += self.flush()
        return ready

    def flush(self) -> list[dict]:
        if not self.records or self.trip_id is None:
            return []
        batch = {
            "schemaVersion": 2,
            "batchId": str(uuid.uuid4()),
            "deviceId": self.device_id,
            "tripId": self.trip_id,
            "seq": self.seq,
            "source": self.source,
            "sampleIntervalMs": 1000,
            "records": self.records,
        }
        if self.seq == 0 and self.vehicle:
            batch["vehicle"] = self.vehicle
        if self.dtc:
            batch["dtc"] = self.dtc
        self.records, self.dtc = [], None
        self.seq += 1
        return [batch]
