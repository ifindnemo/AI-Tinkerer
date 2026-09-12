import json
from dataclasses import dataclass, field
from typing import Any, Callable

from agents import RunContextWrapper, function_tool

from .garage_search import search_nearby_garages
from .maintenance_history import get_maintenance_history


@dataclass
class VehicleToolContext:
    """Application-only state available to the agent's function tools."""

    vehicle_id: str
    latitude: float | None
    longitude: float | None
    trace: list[dict[str, Any]] = field(default_factory=list)


def _run_and_trace(
    wrapper: RunContextWrapper[VehicleToolContext],
    name: str,
    arguments: dict[str, Any],
    function: Callable[[], dict[str, Any]],
) -> str:
    try:
        result = function()
    except Exception as error:
        result = {"error": str(error)}

    wrapper.context.trace.append(
        {"tool": name, "arguments": arguments, "result": result}
    )
    return json.dumps(result, ensure_ascii=False)


@function_tool(name_override="get_maintenance_history")
def get_maintenance_history_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
) -> str:
    """Return previous maintenance records for the vehicle being analysed."""
    vehicle_id = wrapper.context.vehicle_id
    return _run_and_trace(
        wrapper,
        "get_maintenance_history",
        {"vehicle_id": vehicle_id},
        lambda: get_maintenance_history(vehicle_id),
    )


@function_tool(name_override="search_nearby_garages")
def search_nearby_garages_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
) -> str:
    """Find repair garages near the vehicle's current GPS position."""
    latitude = wrapper.context.latitude
    longitude = wrapper.context.longitude
    if latitude is None or longitude is None:
        return _run_and_trace(
            wrapper,
            "search_nearby_garages",
            {},
            lambda: _raise_missing_gps(),
        )
    arguments = {
        "latitude": latitude,
        "longitude": longitude,
        "radius_meters": 5_000,
        "max_results": 5,
    }
    return _run_and_trace(
        wrapper,
        "search_nearby_garages",
        arguments,
        lambda: search_nearby_garages(**arguments),
    )


def _raise_missing_gps() -> dict[str, Any]:
    raise ValueError("GPS coordinates were not provided for this telemetry sample")


VEHICLE_READ_TOOLS = [
    get_maintenance_history_tool,
    search_nearby_garages_tool,
]
