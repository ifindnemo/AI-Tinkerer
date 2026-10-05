"""Telemetry tables (devices, vehicles, trips, samples, DTCs) next to the incident store.

Schema changes are numbered migrations tracked with `PRAGMA user_version`.
"""

import hashlib
import secrets
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from uuid import uuid4

from store import Store, store, utc_now


MIGRATIONS: list[str] = [
    # 1 · ingest v2
    """
    CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        vehicle_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY,
        vin TEXT,
        make TEXT,
        model_year_guess INTEGER,
        display_name TEXT,
        protocol TEXT,
        supported_pids_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source TEXT NOT NULL,
        simulated INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        sample_count INTEGER NOT NULL DEFAULT 0,
        distance_km REAL NOT NULL DEFAULT 0,
        max_coolant REAL,
        event_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_trips_vehicle_started
        ON trips(vehicle_id, started_at);
    CREATE TABLE IF NOT EXISTS ingest_batches (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        received_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS samples (
        trip_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        lat REAL,
        lon REAL,
        location_fixed INTEGER NOT NULL DEFAULT 0,
        signals_json TEXT NOT NULL,
        PRIMARY KEY (trip_id, captured_at)
    );
    CREATE TABLE IF NOT EXISTS dtc_events (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        code TEXT NOT NULL,
        kind TEXT NOT NULL,
        mil INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        freeze_frame_json TEXT,
        UNIQUE (vehicle_id, trip_id, code, kind)
    );
    """,
    # 2 · analysis results and the trip timeline (pins)
    """
    CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        at TEXT NOT NULL,
        trigger TEXT NOT NULL,
        engine TEXT NOT NULL,
        model_severity TEXT,
        final_severity TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_vehicle_at ON analyses(vehicle_id, at);
    CREATE TABLE IF NOT EXISTS trip_events (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL,
        at TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        ref_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trip_events_trip_at ON trip_events(trip_id, at);
    ALTER TABLE trips ADD COLUMN last_dtc_read_at TEXT;
    ALTER TABLE trips ADD COLUMN mil INTEGER NOT NULL DEFAULT 0;
    """,
]


def iso_utc(value: datetime) -> str:
    """Fixed-width UTC text, so SQLite string comparison matches time order."""
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class TelemetryStore:
    def __init__(self, base: Store):
        self.base = base
        self._initialized = False
        self._init_lock = Lock()

    def initialize(self) -> None:
        if self._initialized:
            return
        self.base.initialize()
        with self._init_lock:
            if self._initialized:
                return
            with self.base.transaction() as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                for number, script in enumerate(MIGRATIONS, start=1):
                    if number > version:
                        connection.executescript(script)
                        connection.execute(f"PRAGMA user_version = {number}")
            self._initialized = True

    def create_device(self, vehicle_id: str, label: str = "") -> dict[str, Any]:
        """Register a gateway. The token is returned once; only its hash is stored."""
        self.initialize()
        device_id = f"dev_{uuid4().hex[:12]}"
        token = f"cnd_{secrets.token_urlsafe(32)}"
        with self.base.transaction() as connection:
            connection.execute(
                "INSERT INTO devices (id, token_hash, vehicle_id, label, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (device_id, hash_token(token), vehicle_id, label, utc_now()),
            )
        return {"id": device_id, "vehicle_id": vehicle_id, "label": label, "token": token}

    def authenticate(self, token: str) -> dict[str, Any] | None:
        self.initialize()
        with self.base.transaction() as connection:
            row = connection.execute(
                "SELECT id, vehicle_id, label FROM devices WHERE token_hash = ?",
                (hash_token(token),),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                "UPDATE devices SET last_seen_at = ? WHERE id = ?",
                (utc_now(), row["id"]),
            )
        return dict(row)


telemetry_store = TelemetryStore(store)
