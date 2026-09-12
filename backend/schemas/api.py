from datetime import datetime
from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Severity(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"


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
    force: float | None = None
    power: float | None = None
    engine_load: float = Field(alias="engineLoad", ge=0, le=100)
    consumption_l_h: float | None = Field(default=None, alias="consumption", ge=0)
    consumption_l_100km: float | None = Field(
        default=None,
        alias="consumptionL100Km",
        ge=0,
    )
    speed: float = Field(ge=0, le=350)
    co: float | None = Field(default=None, ge=0)
    hc: float | None = Field(default=None, ge=0)
    co2: float | None = Field(default=None, ge=0)
    o2: float | None = Field(default=None, ge=0)
    lambda_value: float | None = Field(default=None, alias="lambda", ge=0)
    afr: float | None = Field(default=None, ge=0)
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


class ActionType(str, Enum):
    BOOK_APPOINTMENT = "book_appointment"
    REMIND_LATER = "remind_later"


class IncidentAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: ActionType
    garage_id: str | None = None
    slot: str | None = None
    scheduled_for: datetime | None = None

    @model_validator(mode="after")
    def validate_action_fields(self):
        if self.action == ActionType.BOOK_APPOINTMENT and (
            not self.garage_id or not self.slot
        ):
            raise ValueError("garage_id and slot are required for book_appointment")
        if self.action == ActionType.BOOK_APPOINTMENT:
            try:
                start = datetime.fromisoformat(self.slot.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("slot must use ISO 8601 format") from error
            if start.tzinfo is None:
                raise ValueError("slot must include a timezone offset")
        if self.action == ActionType.REMIND_LATER and not self.scheduled_for:
            raise ValueError("scheduled_for is required for remind_later")
        return self


class ConfirmAction(BaseModel):
    pending_action_id: str


class IncidentResponse(BaseModel):
    id: str
    vehicle_id: str
    severity: Severity
    status: str
    diagnosis: str
    assessment: dict[str, Any]
    reasons: list[str]
    recommendations: list[str]
    tool_trace: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str
