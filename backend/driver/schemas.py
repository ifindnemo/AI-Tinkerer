"""Wire format of the driver-attention module.

Only structured values are accepted, and `extra="forbid"` means a client cannot slip an image,
a landmark list or any other field in: such a request is rejected with 422.
"""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from lang import Lang

AttentionState = Literal["attentive", "distracted", "drowsy", "no_face", "uncertain"]
HeadDirection = Literal["forward", "left", "right", "up", "down"]

_STRICT = ConfigDict(extra="forbid", populate_by_name=True)
_MAX_MS = 3_600_000


class Eyes(BaseModel):
    model_config = _STRICT

    closed: bool
    closed_ms: int = Field(alias="closedMs", ge=0, le=_MAX_MS)
    perclos: float | None = Field(default=None, ge=0, le=1)
    score: float | None = Field(default=None, ge=0, le=1)


class Head(BaseModel):
    model_config = _STRICT

    direction: HeadDirection | None = None
    yaw_deg: float | None = Field(default=None, alias="yawDeg", ge=-180, le=180)
    pitch_deg: float | None = Field(default=None, alias="pitchDeg", ge=-180, le=180)
    away_ms: int = Field(alias="awayMs", ge=0, le=_MAX_MS)


class DriverEvent(BaseModel):
    model_config = _STRICT

    captured_at: datetime = Field(alias="capturedAt")
    face_present: bool = Field(alias="facePresent")
    absent_ms: int = Field(alias="absentMs", ge=0, le=_MAX_MS)
    eyes: Eyes
    head: Head
    state: AttentionState
    confidence: float = Field(ge=0, le=1)

    @field_validator("captured_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("capturedAt must include a timezone offset")
        return value.astimezone(timezone.utc)


class VehicleSnapshot(BaseModel):
    """The newest ECU reading shown next to the camera. Only the simulator exists so far."""

    model_config = _STRICT

    source: Literal["simulated", "obd"]  # "obd": the garage page's live device stream
    captured_at: datetime = Field(alias="capturedAt")
    speed_kmh: float = Field(alias="speedKmh", ge=0, le=300)
    coolant_c: float = Field(alias="coolantC", ge=-40, le=160)
    engine_load_pct: float | None = Field(default=None, alias="engineLoadPct", ge=0, le=100)
    driving_minutes: int | None = Field(default=None, alias="drivingMinutes", ge=0, le=1440)

    @field_validator("captured_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("capturedAt must include a timezone offset")
        return value.astimezone(timezone.utc)


class Context(BaseModel):
    model_config = _STRICT

    vehicle_moving: bool = Field(alias="vehicleMoving")
    # Optional: the car this camera belongs to. Its blackbox agent then sees the driver's state.
    vehicle_id: str | None = Field(default=None, alias="vehicleId", pattern=r"^[\w-]{1,64}$")
    # Optional: with an ECU reading the backend combines car and driver (driver/guardian.py).
    vehicle: VehicleSnapshot | None = None
    # `capturedAt` of the event at which the driver confirmed the alert (eyes open, facing forward).
    acknowledged_at: datetime | None = Field(default=None, alias="acknowledgedAt")
    # The language of the agent's words and of the spoken alert; severity and steps do not depend on it.
    lang: Lang = "vi"

    @field_validator("acknowledged_at")
    @classmethod
    def _utc(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("acknowledgedAt must include a timezone offset")
        return value.astimezone(timezone.utc) if value else None


class DriverBatch(BaseModel):
    model_config = _STRICT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    session_id: str = Field(alias="sessionId", pattern=r"^[\w-]{8,64}$")
    source: Literal["webcam", "simulated"]
    context: Context
    events: list[DriverEvent] = Field(min_length=1, max_length=60)


class DriverNarrative(BaseModel):
    """What the agent may write. Severity and evidence always come from the rules."""

    summary: str = Field(min_length=1, max_length=600)
    recommendations: list[str] = Field(min_length=1, max_length=4)
