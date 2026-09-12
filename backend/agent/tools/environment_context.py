import json
import math
import os
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from agents import RunContextWrapper, function_tool

from schemas import (
    EnvironmentContextData,
    EnvironmentContextResponse,
    EnvironmentToolContext,
    ToolError,
    ToolErrorCode,
)


OPEN_METEO_FORECAST_URL = os.getenv(
    "OPEN_METEO_FORECAST_URL",
    "https://api.open-meteo.com/v1/forecast",
)
WEATHER_API_TIMEOUT_SECONDS = float(os.getenv("WEATHER_API_TIMEOUT_SECONDS", "5"))


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    value = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _error(code: ToolErrorCode, message: str) -> EnvironmentContextResponse:
    return EnvironmentContextResponse(
        success=False,
        data=None,
        error=ToolError(code=code, message=message),
        generated_at=datetime.now(timezone.utc),
        source="open_meteo",
    )


def get_external_environment_context_data(
    latitude: float,
    longitude: float,
) -> EnvironmentContextResponse:
    """Fetch current outside temperature for arbitrary WGS84 coordinates."""
    if (
        not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        return _error(
            ToolErrorCode.INVALID_ARGUMENT,
            "latitude must be between -90 and 90 and longitude between -180 and 180.",
        )

    query = urlencode(
        {
            "latitude": latitude,
            "longitude": longitude,
            "current": "temperature_2m",
            "temperature_unit": "celsius",
            "timezone": "UTC",
        }
    )
    request = Request(
        f"{OPEN_METEO_FORECAST_URL}?{query}",
        headers={"User-Agent": "VehicleGuardian/0.1"},
    )

    try:
        with urlopen(request, timeout=WEATHER_API_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
        current = payload["current"]
        outside_temperature_c = float(current["temperature_2m"])
        observed_at = datetime.fromisoformat(current["time"].replace("Z", "+00:00"))
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=timezone.utc)
        resolved_latitude = float(payload["latitude"])
        resolved_longitude = float(payload["longitude"])
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        return _error(
            ToolErrorCode.SOURCE_UNAVAILABLE,
            f"Unable to fetch current outside temperature: {error}",
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        return _error(
            ToolErrorCode.SOURCE_UNAVAILABLE,
            f"Weather provider returned an invalid response: {error}",
        )

    return EnvironmentContextResponse(
        success=True,
        data=EnvironmentContextData(
            context_id=f"{latitude:.5f},{longitude:.5f}",
            outside_temperature_c=outside_temperature_c,
            observed_at=observed_at,
            latitude=resolved_latitude,
            longitude=resolved_longitude,
            weather_grid_distance_km=round(
                _distance_km(
                    latitude,
                    longitude,
                    resolved_latitude,
                    resolved_longitude,
                ),
                2,
            ),
        ),
        error=None,
        generated_at=datetime.now(timezone.utc),
        source="open_meteo",
    )


@function_tool
def get_external_environment_context(
    context: RunContextWrapper[EnvironmentToolContext],
) -> dict[str, Any]:
    """Fetch outside temperature at the last coordinate in the telemetry batch.

    The coordinates are backend-owned run context, not model-provided arguments.
    Outside temperature is supporting context and cannot diagnose a fault alone.
    """
    response = get_external_environment_context_data(
        context.context.latitude,
        context.context.longitude,
    )
    return response.model_dump(mode="json")
