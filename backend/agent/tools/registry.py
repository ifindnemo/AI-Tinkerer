from typing import Any, Callable

from pydantic import ValidationError

from schemas import EnvironmentToolContext

from .environment_context import (
    get_external_environment_context,
    get_external_environment_context_data,
)
from .google_calendar import (
    create_google_calendar_event,
    delete_google_calendar_event,
    update_google_calendar_event,
)
from .garage_search import search_nearby_garages
from .maintenance_history import get_maintenance_history


ToolFunction = Callable[..., Any]


def _sdk_tool_schema(tool) -> dict[str, Any]:
    return {
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.params_json_schema,
        "strict": True,
    }


READ_TOOL_SCHEMAS = [
    _sdk_tool_schema(get_external_environment_context),
    {
        "type": "function",
        "name": "get_maintenance_history",
        "description": "Read previous maintenance records for this vehicle.",
        "parameters": {
            "type": "object",
            "properties": {"vehicle_id": {"type": "string"}},
            "required": ["vehicle_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "search_nearby_garages",
        "description": (
            "Find nearby vehicle repair and maintenance garages from GPS coordinates."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "latitude": {"type": "number", "minimum": -90, "maximum": 90},
                "longitude": {
                    "type": "number",
                    "minimum": -180,
                    "maximum": 180,
                },
                "radius_meters": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 30000,
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                },
            },
            "required": [
                "latitude",
                "longitude",
                "radius_meters",
                "max_results",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


READ_TOOL_FUNCTIONS: dict[str, ToolFunction] = {
    "get_maintenance_history": get_maintenance_history,
    "search_nearby_garages": search_nearby_garages,
}


WRITE_TOOL_SCHEMAS = [
    {
        "type": "function",
        "name": "create_google_calendar_event",
        "description": "Create a confirmed vehicle service appointment in Google Calendar.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "start_time": {
                    "type": "string",
                    "description": "ISO 8601 start time with timezone offset.",
                },
                "end_time": {
                    "type": "string",
                    "description": "ISO 8601 end time with timezone offset.",
                },
                "time_zone": {
                    "type": "string",
                    "description": "IANA timezone, for example Asia/Ho_Chi_Minh.",
                },
                "description": {"type": ["string", "null"]},
                "location": {"type": ["string", "null"]},
            },
            "required": [
                "summary",
                "start_time",
                "end_time",
                "time_zone",
                "description",
                "location",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "update_google_calendar_event",
        "description": "Update a confirmed Google Calendar vehicle service event.",
        "parameters": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string"},
                "summary": {"type": "string"},
                "start_time": {
                    "type": "string",
                    "description": "ISO 8601 start time with timezone offset.",
                },
                "end_time": {
                    "type": "string",
                    "description": "ISO 8601 end time with timezone offset.",
                },
                "time_zone": {
                    "type": "string",
                    "description": "IANA timezone, for example Asia/Ho_Chi_Minh.",
                },
                "description": {"type": ["string", "null"]},
                "location": {"type": ["string", "null"]},
            },
            "required": [
                "event_id",
                "summary",
                "start_time",
                "end_time",
                "time_zone",
                "description",
                "location",
            ],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "delete_google_calendar_event",
        "description": "Delete a confirmed Google Calendar vehicle service event.",
        "parameters": {
            "type": "object",
            "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


WRITE_TOOL_FUNCTIONS: dict[str, ToolFunction] = {
    "create_google_calendar_event": create_google_calendar_event,
    "update_google_calendar_event": update_google_calendar_event,
    "delete_google_calendar_event": delete_google_calendar_event,
}


def execute_read_tool(
    name: str,
    arguments: dict[str, Any],
    telemetry_context: dict[str, Any] | None = None,
) -> Any:
    if name == "get_external_environment_context":
        if arguments:
            raise ValueError(
                "get_external_environment_context does not accept model-provided arguments"
            )
        if telemetry_context is None:
            raise ValueError(
                "get_external_environment_context requires backend telemetry context"
            )
        try:
            location = EnvironmentToolContext.model_validate(
                telemetry_context.get("current_location")
            )
        except ValidationError as error:
            raise ValueError(
                "Telemetry context does not contain a valid last-record location"
            ) from error
        return get_external_environment_context_data(
            location.latitude,
            location.longitude,
        ).model_dump(mode="json")

    function = READ_TOOL_FUNCTIONS.get(name)
    if function is None:
        raise ValueError(f"Unknown or disallowed tool: {name}")
    return function(**arguments)


def execute_write_tool(
    name: str, arguments: dict[str, Any], *, confirmed: bool = False
) -> Any:
    function = WRITE_TOOL_FUNCTIONS.get(name)
    if function is None:
        raise ValueError(f"Unknown or disallowed tool: {name}")
    if not confirmed:
        return {
            "status": "confirmation_required",
            "tool": name,
            "arguments": arguments,
        }
    return function(**arguments)
