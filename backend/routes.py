import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from agent.orchestrator import vehicle_agent
from prediction.alert_policy import alert_policy
from prediction.buffer import telemetry_buffer
from prediction.predictor import predictor
from schemas import (
    ConfirmAction,
    DemoRunRequest,
    IncidentAction,
    PolicyDecision,
    PredictionResult,
    Severity,
    TelemetryInput,
)


router = APIRouter()
DATA_DIR = Path(__file__).parent / "data"


def process_telemetry(sample: TelemetryInput) -> dict:
    window = telemetry_buffer.add(sample)
    hard_limit = alert_policy.evaluate_hard_limits(sample)

    if window is None and hard_limit is None:
        return {
            "status": "buffering",
            "vehicle_id": sample.vehicle_id,
            "samples": telemetry_buffer.size(sample.vehicle_id),
            "required_samples": telemetry_buffer.window_size,
        }

    if window is not None:
        prediction = predictor.predict(window)
    else:
        prediction = PredictionResult(
            label="hard_safety_limit",
            severity=hard_limit.severity,
            confidence=1.0,
            probabilities={"hard_safety_limit": 1.0},
            model_version="hard-guard-v1",
        )

    decision = hard_limit or alert_policy.evaluate(sample, prediction)
    if not decision.should_create_incident:
        return {
            "status": decision.status,
            "vehicle_id": sample.vehicle_id,
            "prediction": prediction.model_dump(mode="json"),
            "policy": decision.model_dump(mode="json"),
        }

    incident = vehicle_agent.create_incident(sample, prediction, decision)
    return {
        "status": "incident_created",
        "vehicle_id": sample.vehicle_id,
        "prediction": prediction.model_dump(mode="json"),
        "policy": decision.model_dump(mode="json"),
        "incident": incident,
    }


@router.post("/telemetry", tags=["telemetry"])
def receive_telemetry(sample: TelemetryInput) -> dict:
    return process_telemetry(sample)


@router.get("/incidents/{incident_id}", tags=["incidents"])
def get_incident(incident_id: str) -> dict:
    incident = vehicle_agent.get_incident(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.post("/incidents/{incident_id}/action", tags=["incidents"])
def prepare_action(incident_id: str, action: IncidentAction) -> dict:
    try:
        return vehicle_agent.prepare_action(incident_id, action)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/incidents/{incident_id}/confirm", tags=["incidents"])
def confirm_action(incident_id: str, confirmation: ConfirmAction) -> dict:
    try:
        return vehicle_agent.confirm_action(incident_id, confirmation.pending_action_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/demo/scenarios", tags=["demo"])
def list_scenarios() -> list[dict]:
    with (DATA_DIR / "scenarios.json").open(encoding="utf-8") as file:
        return json.load(file)


@router.post("/demo/scenarios/{scenario_id}/run", tags=["demo"])
def run_scenario(scenario_id: str, request: DemoRunRequest) -> dict:
    scenarios = list_scenarios()
    scenario = next((item for item in scenarios if item["id"] == scenario_id), None)
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scenario not found")

    telemetry_buffer.clear(request.vehicle_id)
    alert_policy.reset(request.vehicle_id)
    started_at = datetime.now(timezone.utc)
    responses: list[dict] = []
    count = scenario.get("sample_count", telemetry_buffer.window_size + 2)

    for index in range(count):
        values = {
            key: base + scenario.get("trend", {}).get(key, 0) * index
            for key, base in scenario["base"].items()
        }
        sample = TelemetryInput(
            vehicle_id=request.vehicle_id,
            timestamp=started_at + timedelta(seconds=index),
            **values,
        )
        responses.append(process_telemetry(sample))
        if responses[-1]["status"] == "incident_created":
            break

    return {
        "scenario": scenario["name"],
        "vehicle_id": request.vehicle_id,
        "samples_sent": len(responses),
        "final_result": responses[-1],
    }
