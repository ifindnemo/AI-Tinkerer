import json
from pathlib import Path
from typing import Any


MAINTENANCE_HISTORY_FILE = (
    Path(__file__).parents[3] / "vehicle_maintenance_history.json"
)


def get_maintenance_history(vehicle_id: str) -> dict[str, Any]:
    with MAINTENANCE_HISTORY_FILE.open(encoding="utf-8") as file:
        history = json.load(file)

    if history["vehicle_id"] != vehicle_id:
        return {"vehicle_id": vehicle_id, "total_records": 0, "records": []}

    records = history["maintenance_history"]
    return {
        "vehicle_id": vehicle_id,
        "generated_at": history["generated_at"],
        "source_note": history["source_note"],
        "total_records": len(records),
        "records": records,
    }
