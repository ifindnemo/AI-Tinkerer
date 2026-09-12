import json
import os
import sqlite3
from datetime import datetime, timezone
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
                """
            )

    @staticmethod
    def _incident_from_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["prediction"] = json.loads(item.pop("prediction_json"))
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
        prediction: dict[str, Any],
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
                    reasons_json, recommendations_json, tool_trace_json, created_at
                ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
                """,
                (
                    incident_id,
                    vehicle_id,
                    severity,
                    diagnosis,
                    json.dumps(prediction, ensure_ascii=False),
                    json.dumps(reasons, ensure_ascii=False),
                    json.dumps(recommendations, ensure_ascii=False),
                    json.dumps(tool_trace, ensure_ascii=False),
                    created_at,
                ),
            )
        return self.get_incident(incident_id)

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
