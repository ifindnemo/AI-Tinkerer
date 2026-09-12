from datetime import datetime

from pydantic import BaseModel, Field

from schemas.tool_common import ToolResponse


class EnvironmentContextData(BaseModel):
    context_id: str
    outside_temperature_c: float
    observed_at: datetime
    latitude: float
    longitude: float
    weather_grid_distance_km: float = Field(ge=0)


class EnvironmentToolContext(BaseModel):
    """Backend-owned coordinates from the last telemetry record."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class EnvironmentContextResponse(ToolResponse[EnvironmentContextData]):
    pass
