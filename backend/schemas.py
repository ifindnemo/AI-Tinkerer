from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator


class Severity(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"


class TelemetryInput(BaseModel):
    vehicle_id: str = Field(min_length=1, max_length=64)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    coolant_temp: float = Field(ge=-40, le=180)
    engine_rpm: float = Field(ge=0, le=12000)
    vehicle_speed: float = Field(ge=0, le=350)
    intake_air_temp: float = Field(ge=-40, le=100)
    engine_load: float = Field(ge=0, le=100)
    battery_voltage: float = Field(ge=0, le=30)


class PredictionResult(BaseModel):
    label: str
    severity: Severity
    confidence: float = Field(ge=0, le=1)
    probabilities: dict[str, float]
    model_version: str


class PolicyDecision(BaseModel):
    status: str
    should_create_incident: bool
    severity: Severity
    reasons: list[str] = Field(default_factory=list)


class ActionType(str, Enum):
    FIND_GARAGE = "find_garage"
    BOOK_APPOINTMENT = "book_appointment"
    REMIND_LATER = "remind_later"


class IncidentAction(BaseModel):
    action: ActionType
    garage_id: str | None = None
    slot: str | None = None
    scheduled_for: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None

    @model_validator(mode="after")
    def validate_action_fields(self):
        if self.action == ActionType.BOOK_APPOINTMENT and (not self.garage_id or not self.slot):
            raise ValueError("garage_id and slot are required for book_appointment")
        if self.action == ActionType.REMIND_LATER and not self.scheduled_for:
            raise ValueError("scheduled_for is required for remind_later")
        return self


class ConfirmAction(BaseModel):
    pending_action_id: str


class DemoRunRequest(BaseModel):
    vehicle_id: str = Field(default_factory=lambda: f"demo-{uuid4().hex[:8]}")
    latitude: float = 16.0544
    longitude: float = 108.2022


class IncidentResponse(BaseModel):
    id: str
    vehicle_id: str
    severity: Severity
    status: str
    diagnosis: str
    prediction: dict[str, Any]
    reasons: list[str]
    recommendations: list[str]
    tool_trace: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str
