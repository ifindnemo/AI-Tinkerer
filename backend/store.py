import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: str | Path | None = None):
        configured = path or os.getenv("DATABASE_PATH", "vehicle_guardian.db")
        self.path = Path(configured)
        if not self.path.is_absolute():
            self.path = Path(__file__).parent / self.path
        self._lock = Lock()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS incidents (
                    id TEXT PRIMARY KEY,
                    vehicle_id TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    status TEXT NOT NULL,
                    diagnosis TEXT NOT NULL,
                    prediction_json TEXT NOT NULL,
                    assessment_json TEXT NOT NULL DEFAULT '{}',
                    reasons_json TEXT NOT NULL,
                    recommendations_json TEXT NOT NULL,
                    tool_trace_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_incidents_vehicle_status
                    ON incidents(vehicle_id, status);

                CREATE TABLE IF NOT EXISTS pending_actions (
                    id TEXT PRIMARY KEY,
                    incident_id TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    executed_at TEXT,
                    FOREIGN KEY(incident_id) REFERENCES incidents(id)
                );

                CREATE TABLE IF NOT EXISTS appointments (
                    id TEXT PRIMARY KEY,
                    incident_id TEXT NOT NULL,
                    vehicle_id TEXT NOT NULL,
                    garage_id TEXT NOT NULL,
                    slot TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS reminders (
                    id TEXT PRIMARY KEY,
                    incident_id TEXT NOT NULL,
                    vehicle_id TEXT NOT NULL,
                    scheduled_for TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS incident_memories (
                    id TEXT PRIMARY KEY,
                    incident_id TEXT NOT NULL UNIQUE,
                    vehicle_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    telemetry_context_json TEXT NOT NULL,
                    assessment_json TEXT NOT NULL,
                    tool_trace_json TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(incident_id) REFERENCES incidents(id)
                );
                CREATE INDEX IF NOT EXISTS idx_incident_memories_vehicle_status
                    ON incident_memories(vehicle_id, status, expires_at);
                """
            )
            incident_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(incidents)")
            }
            if "assessment_json" not in incident_columns:
                connection.execute(
                    "ALTER TABLE incidents "
                    "ADD COLUMN assessment_json TEXT NOT NULL DEFAULT '{}'"
                )

    @staticmethod
    def _incident_from_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item.pop("prediction_json", None)
        item["assessment"] = json.loads(item.pop("assessment_json", "{}"))
        item["reasons"] = json.loads(item.pop("reasons_json"))
        item["recommendations"] = json.loads(item.pop("recommendations_json"))
        item["tool_trace"] = json.loads(item.pop("tool_trace_json"))
        return item

    def create_incident(
        self,
        *,
        vehicle_id: str,
        severity: str,
        diagnosis: str,
        assessment: dict[str, Any],
        reasons: list[str],
        recommendations: list[str],
        tool_trace: list[dict[str, Any]],
    ) -> dict[str, Any]:
        self.initialize()
        incident_id = f"inc_{uuid4().hex[:12]}"
        created_at = utc_now()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO incidents (
                    id, vehicle_id, severity, status, diagnosis, prediction_json,
                    assessment_json, reasons_json, recommendations_json,
                    tool_trace_json, created_at
                ) VALUES (?, ?, ?, 'open', ?, '{}', ?, ?, ?, ?, ?)
                """,
                (
                    incident_id,
                    vehicle_id,
                    severity,
                    diagnosis,
                    json.dumps(assessment, ensure_ascii=False),
                    json.dumps(reasons, ensure_ascii=False),
                    json.dumps(recommendations, ensure_ascii=False),
                    json.dumps(tool_trace, ensure_ascii=False),
                    created_at,
                ),
            )
        return self.get_incident(incident_id)

    def update_incident_analysis(
        self,
        incident_id: str,
        *,
        severity: str,
        diagnosis: str,
        assessment: dict[str, Any],
        reasons: list[str],
        recommendations: list[str],
        tool_trace: list[dict[str, Any]],
    ) -> dict[str, Any]:
        self.initialize()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE incidents
                SET severity = ?, diagnosis = ?, assessment_json = ?,
                    reasons_json = ?, recommendations_json = ?, tool_trace_json = ?
                WHERE id = ? AND status = 'open'
                """,
                (
                    severity,
                    diagnosis,
                    json.dumps(assessment, ensure_ascii=False),
                    json.dumps(reasons, ensure_ascii=False),
                    json.dumps(recommendations, ensure_ascii=False),
                    json.dumps(tool_trace, ensure_ascii=False),
                    incident_id,
                ),
            )
        return self.get_incident(incident_id)

    @staticmethod
    def _memory_from_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["telemetry_context"] = json.loads(item.pop("telemetry_context_json"))
        item["assessment"] = json.loads(item.pop("assessment_json"))
        item["tool_trace"] = json.loads(item.pop("tool_trace_json"))
        return item

    def upsert_incident_memory(
        self,
        *,
        incident_id: str,
        vehicle_id: str,
        telemetry_context: dict[str, Any],
        assessment: dict[str, Any],
        tool_trace: list[dict[str, Any]],
        status: str = "active",
        ttl_minutes: int | None = None,
    ) -> dict[str, Any]:
        self.initialize()
        ttl = (
            ttl_minutes
            if ttl_minutes is not None
            else int(os.getenv("INCIDENT_MEMORY_TTL_MINUTES", "60"))
        )
        if ttl < 1:
            raise ValueError("INCIDENT_MEMORY_TTL_MINUTES must be at least 1")
        now = datetime.now(timezone.utc)
        now_text = now.isoformat()
        expires_at = (now + timedelta(minutes=ttl)).isoformat()
        memory_id = f"mem_{uuid4().hex[:12]}"
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO incident_memories (
                    id, incident_id, vehicle_id, status, telemetry_context_json,
                    assessment_json, tool_trace_json, expires_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(incident_id) DO UPDATE SET
                    status = excluded.status,
                    telemetry_context_json = excluded.telemetry_context_json,
                    assessment_json = excluded.assessment_json,
                    tool_trace_json = excluded.tool_trace_json,
                    expires_at = excluded.expires_at,
                    updated_at = excluded.updated_at
                """,
                (
                    memory_id,
                    incident_id,
                    vehicle_id,
                    status,
                    json.dumps(telemetry_context, ensure_ascii=False),
                    json.dumps(assessment, ensure_ascii=False),
                    json.dumps(tool_trace, ensure_ascii=False),
                    expires_at,
                    now_text,
                    now_text,
                ),
            )
        return self.get_incident_memory(incident_id)

    def get_incident_memory(self, incident_id: str) -> dict[str, Any] | None:
        self.initialize()
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE incident_memories
                SET status = 'expired', updated_at = ?
                WHERE incident_id = ? AND expires_at <= ?
                    AND status NOT IN ('resolved', 'expired')
                """,
                (now, incident_id, now),
            )
            row = connection.execute(
                "SELECT * FROM incident_memories WHERE incident_id = ?",
                (incident_id,),
            ).fetchone()
        return self._memory_from_row(row)

    def get_active_incident_memory(self, vehicle_id: str) -> dict[str, Any] | None:
        self.initialize()
        now = utc_now()
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM incident_memories
                WHERE vehicle_id = ? AND expires_at > ?
                    AND status IN ('active', 'waiting_confirmation', 'action_completed')
                ORDER BY updated_at DESC LIMIT 1
                """,
                (vehicle_id, now),
            ).fetchone()
        return self._memory_from_row(row)

    def update_incident_memory_status(
        self,
        incident_id: str,
        status: str,
    ) -> dict[str, Any] | None:
        allowed_statuses = {
            "active",
            "waiting_confirmation",
            "action_completed",
            "resolved",
            "expired",
        }
        if status not in allowed_statuses:
            raise ValueError(f"Unsupported incident memory status: {status}")
        self.initialize()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE incident_memories
                SET status = ?, updated_at = ?
                WHERE incident_id = ?
                """,
                (status, utc_now(), incident_id),
            )
        return self.get_incident_memory(incident_id)

    def get_incident(self, incident_id: str) -> dict[str, Any] | None:
        self.initialize()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM incidents WHERE id = ?", (incident_id,)
            ).fetchone()
        return self._incident_from_row(row)

    def get_open_incident(self, vehicle_id: str) -> dict[str, Any] | None:
        self.initialize()
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM incidents
                WHERE vehicle_id = ? AND status = 'open'
                ORDER BY created_at DESC LIMIT 1
                """,
                (vehicle_id,),
            ).fetchone()
        return self._incident_from_row(row)

    def create_pending_action(
        self, incident_id: str, action_type: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self.initialize()
        action_id = f"act_{uuid4().hex[:12]}"
        created_at = utc_now()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO pending_actions
                    (id, incident_id, action_type, payload_json, status, created_at)
                VALUES (?, ?, ?, ?, 'pending_confirmation', ?)
                """,
                (action_id, incident_id, action_type, json.dumps(payload), created_at),
            )
        return {
            "id": action_id,
            "incident_id": incident_id,
            "action_type": action_type,
            "payload": payload,
            "status": "pending_confirmation",
            "created_at": created_at,
        }

    def get_pending_action(self, action_id: str) -> dict[str, Any] | None:
        self.initialize()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM pending_actions WHERE id = ?", (action_id,)
            ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["payload"] = json.loads(item.pop("payload_json"))
        return item

    def mark_action_executed(self, action_id: str) -> None:
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE pending_actions
                SET status = 'executed', executed_at = ?
                WHERE id = ? AND status = 'pending_confirmation'
                """,
                (utc_now(), action_id),
            )

    def create_appointment(self, incident: dict[str, Any], payload: dict[str, Any]):
        appointment_id = f"apt_{uuid4().hex[:12]}"
        result = {
            "id": appointment_id,
            "incident_id": incident["id"],
            "vehicle_id": incident["vehicle_id"],
            "garage_id": payload["garage_id"],
            "slot": payload["slot"],
            "created_at": utc_now(),
        }
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO appointments
                    (id, incident_id, vehicle_id, garage_id, slot, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                tuple(result.values()),
            )
        return result

    def create_reminder(self, incident: dict[str, Any], payload: dict[str, Any]):
        reminder_id = f"rem_{uuid4().hex[:12]}"
        result = {
            "id": reminder_id,
            "incident_id": incident["id"],
            "vehicle_id": incident["vehicle_id"],
            "scheduled_for": payload["scheduled_for"],
            "message": payload.get("message", "Kiểm tra lại cảnh báo xe."),
            "created_at": utc_now(),
        }
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO reminders
                    (id, incident_id, vehicle_id, scheduled_for, message, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                tuple(result.values()),
            )
        return result


store = Store()
