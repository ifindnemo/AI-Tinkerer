from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Severity(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"


class TelemetryInput(BaseModel):
    vehicle_id: str = Field(min_length=1, max_length=64)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    latitude: float = Field(default=16.0544, ge=-90, le=90)
    longitude: float = Field(default=108.2022, ge=-180, le=180)
    coolant_temp: float = Field(ge=-40, le=180)
    engine_rpm: float = Field(ge=0, le=12000)
    vehicle_speed: float = Field(ge=0, le=350)
    intake_air_temp: float = Field(ge=-40, le=100)
    engine_load: float = Field(ge=0, le=100)
    battery_voltage: float = Field(ge=0, le=30)


class BlackboxLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class BlackboxTelemetryRecord(BaseModel):
    """Frontend record validated and normalized at the API boundary."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    captured_at: datetime = Field(alias="capturedAt")
    rpm: float = Field(ge=0, le=12000)
    map: float | None = None
    tps: float | None = None
    engine_load: float = Field(alias="engineLoad", ge=0, le=100)
    consumption_l_h: float | None = Field(default=None, alias="consumption", ge=0)
    speed: float = Field(ge=0, le=350)
    coolant_temp_c: float = Field(alias="coolant", ge=-40, le=180)
    oil_temp_c: float | None = Field(default=None, alias="oil", ge=-40, le=220)
    intake_air_temp_c: float = Field(alias="intake", ge=-40, le=100)
    battery_voltage: float = Field(alias="battery", ge=0, le=30)
    fuel_percent: float | None = Field(default=None, alias="fuel", ge=0, le=100)
    fan_percent: float | None = Field(default=None, alias="fan", ge=0, le=100)
    dtc: list[str] = Field(default_factory=list)
    location: BlackboxLocation
    units: dict[str, str] = Field(default_factory=dict)
    fault: Any | None = Field(
        default=None,
        exclude=True,
        repr=False,
        description="Optional demo label; discarded before agent input.",
    )

    def to_telemetry_input(self, vehicle_id: str) -> TelemetryInput:
        return TelemetryInput(
            vehicle_id=vehicle_id,
            timestamp=self.captured_at,
            latitude=self.location.lat,
            longitude=self.location.lon,
            coolant_temp=self.coolant_temp_c,
            engine_rpm=self.rpm,
            vehicle_speed=self.speed,
            intake_air_temp=self.intake_air_temp_c,
            engine_load=self.engine_load,
            battery_voltage=self.battery_voltage,
        )

    def to_agent_context(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)


class TelemetryBatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_version: Literal[1] = Field(alias="schemaVersion")
    batch_id: str = Field(alias="batchId", min_length=1, max_length=128)
    vehicle_id: str = Field(alias="vehicleId", min_length=1, max_length=64)
    source: str = Field(min_length=1, max_length=64)
    sample_interval_ms: int = Field(alias="sampleIntervalMs", gt=0, le=3_600_000)
    record_count: int = Field(alias="recordCount", ge=1, le=500)
    records: list[BlackboxTelemetryRecord] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def validate_record_count(self):
        if self.record_count != len(self.records):
            raise ValueError("recordCount must match the number of records")
        return self

    def to_telemetry_inputs(self) -> list[TelemetryInput]:
        return [record.to_telemetry_input(self.vehicle_id) for record in self.records]

    def to_agent_context(self) -> dict[str, Any]:
        current_location = self.records[-1].location
        return {
            "schema_version": self.schema_version,
            "batch_id": self.batch_id,
            "vehicle_id": self.vehicle_id,
            "source": self.source,
            "sample_interval_ms": self.sample_interval_ms,
            "record_count": len(self.records),
            "current_location": {
                "latitude": current_location.lat,
                "longitude": current_location.lon,
            },
            "records": [record.to_agent_context() for record in self.records],
        }


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
