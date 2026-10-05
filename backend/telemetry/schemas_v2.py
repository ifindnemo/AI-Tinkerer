"""Ingest schema v2: batches sent by the OBD gateway (or its simulator sources).

Only `capturedAt` is required per record. Every sensor is optional because real
cars support different PIDs; unknown signal names are rejected. All timestamps
are normalized to UTC so SQLite string comparisons stay correct.
"""

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# Signal name -> (min, max). Names match the frontend; PIDs are Mode 01.
SIGNAL_RANGES: dict[str, tuple[float, float]] = {
    "rpm": (0, 12_000),  # 0C
    "speed": (0, 300),  # 0D
    "engineLoad": (0, 100),  # 04
    "coolant": (-40, 180),  # 05
    "intake": (-40, 100),  # 0F
    "map": (0, 255),  # 0B
    "maf": (0, 700),  # 10
    "tps": (0, 100),  # 11
    "stft1": (-100, 100),  # 06
    "ltft1": (-100, 100),  # 07
    "battery": (0, 30),  # 42
    "oil": (-40, 220),  # 5C
    "fuel": (0, 100),  # 2F
    "ambient": (-40, 80),  # 46
}

DTC_PATTERN = re.compile(r"^[PCBU][0-3][0-9A-F]{3}$")
PID_PATTERN = re.compile(r"^[0-9A-F]{4}$")
VIN_PATTERN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
MIN_SAMPLE_GAP = timedelta(milliseconds=500)
MAX_SAMPLE_GAP = timedelta(seconds=10)

_STRICT = ConfigDict(extra="forbid", populate_by_name=True)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("timestamp must include a timezone offset")
    return value.astimezone(timezone.utc)


def _signals(values: dict[str, float]) -> dict[str, float]:
    for name, value in values.items():
        if name not in SIGNAL_RANGES:
            raise ValueError(f"unknown signal: {name}")
        low, high = SIGNAL_RANGES[name]
        # NaN passes both range comparisons, so check finiteness explicitly.
        if not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{name} must be between {low} and {high}")
    return values


class Location(BaseModel):
    model_config = _STRICT

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, alias="accuracyM", ge=0)
    # True when the gateway used --fixed-location instead of a GPS fix.
    fixed: bool = False


class Record(BaseModel):
    model_config = _STRICT

    captured_at: datetime = Field(alias="capturedAt")
    location: Location | None = None
    signals: dict[str, float] = Field(default_factory=dict)

    _utc_time = field_validator("captured_at")(_utc)
    _valid_signals = field_validator("signals")(_signals)


class VehicleInfo(BaseModel):
    model_config = _STRICT

    vin: str | None = None
    protocol: str | None = Field(default=None, max_length=64)
    supported_pids: list[str] = Field(
        default_factory=list, alias="supportedPids", max_length=256
    )

    @field_validator("vin")
    @classmethod
    def _vin(cls, value: str | None) -> str | None:
        if value is not None and not VIN_PATTERN.fullmatch(value):
            raise ValueError("vin must be 17 characters without I, O or Q")
        return value

    @field_validator("supported_pids")
    @classmethod
    def _pids(cls, values: list[str]) -> list[str]:
        if any(not PID_PATTERN.fullmatch(pid) for pid in values):
            raise ValueError("supportedPids must be 4 uppercase hex characters")
        return values


class FreezeFrame(BaseModel):
    model_config = _STRICT

    dtc: str
    signals: dict[str, float] = Field(default_factory=dict)

    _valid_signals = field_validator("signals")(_signals)


class DtcSnapshot(BaseModel):
    model_config = _STRICT

    read_at: datetime = Field(alias="readAt")
    mil: bool
    stored: list[str] = Field(default_factory=list, max_length=32)
    pending: list[str] = Field(default_factory=list, max_length=32)
    freeze_frame: FreezeFrame | None = Field(default=None, alias="freezeFrame")

    _utc_time = field_validator("read_at")(_utc)

    @model_validator(mode="after")
    def _codes(self):
        codes = [*self.stored, *self.pending]
        if self.freeze_frame:
            codes.append(self.freeze_frame.dtc)
        if any(not DTC_PATTERN.fullmatch(code) for code in codes):
            raise ValueError("DTC codes must look like P0217")
        return self


class IngestBatchV2(BaseModel):
    model_config = _STRICT

    schema_version: Literal[2] = Field(alias="schemaVersion")
    batch_id: str = Field(alias="batchId", min_length=1, max_length=128)
    device_id: str = Field(alias="deviceId", min_length=1, max_length=64)
    trip_id: str = Field(alias="tripId", min_length=1, max_length=128)
    seq: int = Field(ge=0)
    source: Literal["obd", "fake-elm", "sim"]
    sample_interval_ms: int = Field(alias="sampleIntervalMs", gt=0, le=60_000)
    vehicle: VehicleInfo | None = None
    records: list[Record] = Field(min_length=1, max_length=500)
    dtc: DtcSnapshot | None = None

    @property
    def simulated(self) -> bool:
        """Anything not read from a real car is labelled as simulated."""
        return self.source != "obd"

    @model_validator(mode="after")
    def _chronological(self):
        for previous, current in zip(self.records, self.records[1:]):
            gap = current.captured_at - previous.captured_at
            if not MIN_SAMPLE_GAP <= gap <= MAX_SAMPLE_GAP:
                raise ValueError("records must be 0.5–10 s apart and in time order")
        return self
