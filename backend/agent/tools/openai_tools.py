import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from agents import RunContextWrapper, function_tool

from agent.realism import for_model
from booking import build_proposal
from .environment_context import get_external_environment_context_data
from .garage_search import search_nearby_garages
from .lookup_cache import cached, place
from .maintenance_history import get_maintenance_history


@dataclass
class VehicleToolContext:
    """Application-only state available to the agent's function tools."""

    vehicle_id: str
    latitude: float | None
    longitude: float | None
    trace: list[dict[str, Any]] = field(default_factory=list)
    timings: list[tuple[str, float]] = field(default_factory=list)  # (tool, ms): for the log only, never shown


def _run_and_trace(
    wrapper: RunContextWrapper[VehicleToolContext],
    name: str,
    arguments: dict[str, Any],
    function: Callable[[], dict[str, Any]],
) -> str:
    started = time.monotonic()
    try:
        result = function()
    except Exception as error:
        result = {"error": str(error)}
    wrapper.context.timings.append((name, round((time.monotonic() - started) * 1000, 1)))

    wrapper.context.trace.append(
        {"tool": name, "arguments": arguments, "result": result}
    )
    return json.dumps(for_model(result), ensure_ascii=False)  # the trace above keeps the original


Call = tuple[dict[str, Any], Callable[[], dict[str, Any]]]  # (arguments for the trace, the lookup)


def _history_call(context: VehicleToolContext) -> Call:
    vehicle_id = context.vehicle_id
    return {"vehicle_id": vehicle_id}, lambda: get_maintenance_history(vehicle_id)


def _weather_call(context: VehicleToolContext) -> Call:
    latitude, longitude = context.latitude, context.longitude
    if latitude is None or longitude is None:
        return {}, _raise_missing_gps
    spot = place(latitude, longitude)
    return {}, lambda: cached(
        ("weather", spot),
        lambda: get_external_environment_context_data(latitude, longitude).model_dump(mode="json"),
    )


def _garages_call(context: VehicleToolContext) -> Call:
    latitude, longitude = context.latitude, context.longitude
    if latitude is None or longitude is None:
        return {}, _raise_missing_gps
    arguments = {
        "latitude": latitude,
        "longitude": longitude,
        "radius_meters": 5_000,
        "max_results": 5,
    }
    spot = place(latitude, longitude)
    return arguments, lambda: cached(("garages", spot), lambda: search_nearby_garages(**arguments))


@function_tool(name_override="get_maintenance_history")
def get_maintenance_history_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
) -> str:
    """Return previous maintenance records for the vehicle being analysed."""
    return _run_and_trace(wrapper, "get_maintenance_history", *_history_call(wrapper.context))


@function_tool(name_override="get_external_environment_context")
def get_external_environment_context_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
) -> str:
    """Return outside temperature at the final coordinate of the telemetry batch."""
    return _run_and_trace(wrapper, "get_external_environment_context", *_weather_call(wrapper.context))


@function_tool(name_override="search_nearby_garages")
def search_nearby_garages_tool(
    wrapper: RunContextWrapper[VehicleToolContext],
) -> str:
    """Find repair garages near the vehicle's current GPS position."""
    return _run_and_trace(wrapper, "search_nearby_garages", *_garages_call(wrapper.context))


def prefetch_read_tools(context: VehicleToolContext, *, include_garages: bool) -> dict[str, Any]:
    """Run the read-only lookups side by side, before the model is called, so it needs no model turn to ask for
    them. Same trace entries and timings as when the model calls the tools, always in the same order. Returns the
    results as the model would see them. Never raises: a failed lookup becomes {"error": ...} like a tool call."""
    jobs = [
        ("get_external_environment_context", _weather_call(context)),
        ("get_maintenance_history", _history_call(context)),
    ]
    if include_garages:
        jobs.append(("search_nearby_garages", _garages_call(context)))

    def run(job: tuple[str, Call]) -> tuple[str, dict[str, Any], dict[str, Any], float]:
        name, (arguments, function) = job
        started = time.monotonic()
        try:
            result = function()
        except Exception as error:
            result = {"error": str(error)}
        return name, arguments, result, round((time.monotonic() - started) * 1000, 1)

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        outcomes = list(pool.map(run, jobs))
    seen: dict[str, Any] = {}
    for name, arguments, result, milliseconds in outcomes:
        context.timings.append((name, milliseconds))
        context.trace.append({"tool": name, "arguments": arguments, "result": result})
        seen[name] = for_model(result)
    return seen


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


# With the lookups prefetched the model only has this one left to ask for.
PREFETCHED_VEHICLE_TOOLS = [propose_booking_tool]

VEHICLE_TOOLS = [
    get_external_environment_context_tool,
    get_maintenance_history_tool,
    search_nearby_garages_tool,
    propose_booking_tool,
]
