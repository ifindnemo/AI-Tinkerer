import json
from dataclasses import dataclass, field
from typing import Any, Callable

from agents import RunContextWrapper, function_tool

from agent.realism import for_model
from booking import build_proposal
from .environment_context import get_external_environment_context_data
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
    return json.dumps(for_model(result), ensure_ascii=False)  # the trace above keeps the original


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


@function_tool(name_override="get_external_environment_context")
def get_external_environment_context_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
) -> str:
    """Return outside temperature at the final coordinate of the telemetry batch."""
    latitude = wrapper.context.latitude
    longitude = wrapper.context.longitude
    if latitude is None or longitude is None:
        return _run_and_trace(
            wrapper,
            "get_external_environment_context",
            {},
            lambda: _raise_missing_gps(),
        )
    return _run_and_trace(
        wrapper,
        "get_external_environment_context",
        {},
        lambda: get_external_environment_context_data(
            latitude,
            longitude,
        ).model_dump(mode="json"),
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


@function_tool(name_override="propose_booking")
def propose_booking_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
    garage_name: str,
    days_from_now: int,
    hour: int,
) -> str:
    """Propose a garage appointment for the driver to confirm. This books nothing: the driver
    sees the proposal and confirms or ignores it. Call it only after search_nearby_garages found
    garages. garage_name must be copied exactly from that result. days_from_now is 1-14 (1 =
    tomorrow); hour is the local start hour, 8-17."""
    arguments = {"garage_name": garage_name, "days_from_now": days_from_now, "hour": hour}

    def propose() -> dict[str, Any]:
        proposal = build_proposal(garage_name, days_from_now, hour, wrapper.context.trace)
        return {
            "proposed": True,
            "garage": proposal["garage_id"],
            "slot": proposal["slot"],
            "note": "Waiting for the driver to confirm. Nothing is booked yet.",
        }

    return _run_and_trace(wrapper, "propose_booking", arguments, propose)


def _raise_missing_gps() -> dict[str, Any]:
    raise ValueError("GPS coordinates were not provided for this telemetry sample")


VEHICLE_TOOLS = [
    get_external_environment_context_tool,
    get_maintenance_history_tool,
    search_nearby_garages_tool,
    propose_booking_tool,
]
