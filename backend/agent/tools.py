import json
import math
from pathlib import Path
from typing import Any

from store import store


DATA_DIR = Path(__file__).parents[1] / "data"


def _load_json(name: str) -> Any:
    with (DATA_DIR / name).open(encoding="utf-8") as file:
        return json.load(file)


def get_vehicle_history(vehicle_id: str) -> dict[str, Any]:
    history = _load_json("vehicle_history.json")
    records = [item for item in history if item["vehicle_id"] == vehicle_id]
    return {"vehicle_id": vehicle_id, "records": records}


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


def search_garages(latitude: float = 16.0544, longitude: float = 108.2022) -> dict[str, Any]:
    garages = _load_json("garages.json")
    for garage in garages:
        garage["distance_km"] = round(
            _distance_km(latitude, longitude, garage["latitude"], garage["longitude"]),
            1,
        )
    garages.sort(key=lambda item: item["distance_km"])
    return {"garages": garages[:3]}


def get_garage_slots(garage_id: str) -> dict[str, Any]:
    garages = _load_json("garages.json")
    garage = next((item for item in garages if item["id"] == garage_id), None)
    if garage is None:
        raise ValueError("Garage not found")
    return {"garage_id": garage_id, "slots": garage["available_slots"]}


READ_TOOL_SCHEMAS = [
    {
        "type": "function",
        "name": "get_vehicle_history",
        "description": "Read previous maintenance and fault history for this vehicle.",
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
        "name": "search_garages",
        "description": "Find nearby garages from the demo garage directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "latitude": {"type": "number"},
                "longitude": {"type": "number"},
            },
            "required": ["latitude", "longitude"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "get_garage_slots",
        "description": "Read available appointment slots for one garage.",
        "parameters": {
            "type": "object",
            "properties": {"garage_id": {"type": "string"}},
            "required": ["garage_id"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


READ_TOOL_FUNCTIONS = {
    "get_vehicle_history": get_vehicle_history,
    "search_garages": search_garages,
    "get_garage_slots": get_garage_slots,
}


def execute_read_tool(name: str, arguments: dict[str, Any]) -> Any:
    function = READ_TOOL_FUNCTIONS.get(name)
    if function is None:
        raise ValueError(f"Unknown or disallowed tool: {name}")
    return function(**arguments)


def prepare_booking(incident_id: str, garage_id: str, slot: str):
    get_garage_slots(garage_id)
    return store.create_pending_action(
        incident_id,
        "book_appointment",
        {"garage_id": garage_id, "slot": slot},
    )


def prepare_reminder(incident_id: str, scheduled_for: str):
    return store.create_pending_action(
        incident_id,
        "remind_later",
        {"scheduled_for": scheduled_for, "message": "Kiểm tra lại cảnh báo xe và đặt lịch garage."},
    )
