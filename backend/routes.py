from fastapi import APIRouter, HTTPException

from agent.orchestrator import vehicle_agent
from schemas import (
    ConfirmAction,
    IncidentAction,
    TelemetryBatchInput,
)


router = APIRouter()


def _run_agent(telemetry_context: dict) -> dict:
    try:
        return vehicle_agent.analyze_telemetry_context(telemetry_context)
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="Vehicle analysis is temporarily unavailable.",
        ) from error


@router.post("/telemetry/batch", tags=["telemetry"])
def receive_telemetry_batch(batch: TelemetryBatchInput) -> dict:
    """Validate a frontend black-box batch and send it directly to the agent."""
    result = _run_agent(batch.to_agent_context())
    return {
        **result,
        "batch_id": batch.batch_id,
        "accepted_records": len(batch.records),
        "sanitization": {
            "removed_fields": ["fault"],
            "removed_values": sum(record.fault is not None for record in batch.records),
        },
    }


@router.get("/incidents/{incident_id}", tags=["incidents"])
def get_incident(incident_id: str) -> dict:
    incident = vehicle_agent.get_incident(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.get("/incidents/{incident_id}/memory", tags=["incidents"])
def get_incident_memory(incident_id: str) -> dict:
    memory = vehicle_agent.get_incident_memory(incident_id)
    if memory is None:
        raise HTTPException(status_code=404, detail="Incident memory not found")
    return memory


@router.post("/incidents/{incident_id}/action", tags=["incidents"])
def prepare_action(incident_id: str, action: IncidentAction) -> dict:
    try:
        return vehicle_agent.prepare_action(incident_id, action)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/incidents/{incident_id}/confirm", tags=["incidents"])
def confirm_action(incident_id: str, confirmation: ConfirmAction) -> dict:
    try:
        return vehicle_agent.confirm_action(incident_id, confirmation.pending_action_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
