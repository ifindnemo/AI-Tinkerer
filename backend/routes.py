import logging

from fastapi import APIRouter, HTTPException, Response

from agent.orchestrator import vehicle_agent
from booking import ics_for
from schemas import (
    ConfirmAction,
    IncidentAction,
    TelemetryBatchInput,
)
from store import store


router = APIRouter()
log = logging.getLogger("car_neuron.api")


def _run_agent(telemetry_context: dict) -> dict:
    try:
        return vehicle_agent.analyze_telemetry_context(telemetry_context)
    except Exception as error:
        log.exception("vehicle analysis failed")
        raise HTTPException(
            status_code=502,
            detail="Vehicle analysis is temporarily unavailable.",
        ) from error


@router.post("/telemetry/batch", tags=["telemetry"])
def receive_telemetry_batch(batch: TelemetryBatchInput) -> dict:
    """Validate a frontend black-box batch and send it directly to the agent."""
    context = batch.to_agent_context()
    result = _run_agent(context)
    assessment = result["assessment"]
    severity = assessment["severity"]  # result["status"] is the incident status, not the severity
    if severity == "normal":
        from voice import clear_alert_history

        clear_alert_history(batch.vehicle_id)
    if severity in ("warning", "critical"):
        from voice import announce_alert, follow_up_for, tool_options_line

        driver = context.get("driver_attention") or {}
        hold = severity == "critical" or (driver.get("status") == "live" and bool(driver.get("must_stop")))
        # The plan (car + driver) says what to do; with no special plan, the nearby garages are offered as choices.
        options = (result.get("plan") or {}).get("spoken") or tool_options_line(result.get("tool_trace"), batch.lang, hold=hold)
        announce_alert(
            assessment["diagnosis"],
            severity=severity,
            recommendations=assessment["recommendations"],
            dedupe_key=f"{batch.vehicle_id}:{severity}:{batch.lang}",
            once=True,  # one announcement per episode: the page shows the rest; a normal assessment starts a new one
            session_id=batch.vehicle_id,
            lang=batch.lang,
            options=options,
            follow_up=follow_up_for(result, batch.lang),
        )
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


@router.get("/appointments/{appointment_id}/calendar.ics", tags=["incidents"])
def appointment_calendar(appointment_id: str) -> Response:
    """The confirmed appointment as an .ics file the driver can open in any calendar app."""
    appointment = store.get_appointment(appointment_id)
    if appointment is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return Response(
        ics_for(appointment),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{appointment_id}.ics"'},
    )
