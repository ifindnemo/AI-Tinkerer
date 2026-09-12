import json
import os
from typing import Any

from agents import Agent, ModelSettings, Runner
from pydantic import BaseModel, Field

from agent.prompt import SYSTEM_PROMPT
from agent.tools import VEHICLE_READ_TOOLS, VehicleToolContext, search_nearby_garages
from schemas import (
    ActionType,
    IncidentAction,
    PolicyDecision,
    PredictionResult,
    TelemetryInput,
)
from services import calculate_diagnostic_metrics
from store import store


class VehicleAnalysis(BaseModel):
    diagnosis: str = Field(
        description=(
            "Giải thích cảnh báo và khuyến nghị an toàn ngắn gọn "
            "bằng tiếng Việt."
        )
    )
    recommendations: list[str] = Field(
        min_length=1,
        max_length=5,
        description="Các bước tiếp theo dựa trên dữ liệu và kết quả công cụ.",
    )


class VehicleAgent:
    def __init__(self):
        self.model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        self.agent = Agent[VehicleToolContext](
            name="Vehicle Guardian",
            instructions=SYSTEM_PROMPT,
            model=self.model,
            model_settings=ModelSettings(
                parallel_tool_calls=True,
                store=False,
            ),
            tools=VEHICLE_READ_TOOLS,
            output_type=VehicleAnalysis,
        )

    def _openai_analysis(
        self,
        sample: TelemetryInput,
        prediction: PredictionResult,
        decision: PolicyDecision,
        samples: list[TelemetryInput],
    ) -> tuple[VehicleAnalysis, list[dict[str, Any]]]:
        context = VehicleToolContext(
            vehicle_id=sample.vehicle_id,
            latitude=sample.latitude,
            longitude=sample.longitude,
        )
        input_data = {
            "telemetry": sample.model_dump(mode="json"),
            "prediction": prediction.model_dump(mode="json"),
            "policy": decision.model_dump(mode="json"),
            "diagnostic_metrics": calculate_diagnostic_metrics(samples),
        }
        result = Runner.run_sync(
            self.agent,
            json.dumps(input_data, ensure_ascii=False),
            context=context,
            max_turns=6,
        )
        if not isinstance(result.final_output, VehicleAnalysis):
            raise RuntimeError("OpenAI agent returned an invalid analysis")
        return result.final_output, context.trace

    def create_incident(
        self,
        sample: TelemetryInput,
        prediction: PredictionResult,
        decision: PolicyDecision,
        samples: list[TelemetryInput] | None = None,
    ) -> dict[str, Any]:
        existing = store.get_open_incident(sample.vehicle_id)
        if existing:
            return existing

        analysis, trace = self._openai_analysis(
            sample,
            prediction,
            decision,
            samples or [sample],
        )

        return store.create_incident(
            vehicle_id=sample.vehicle_id,
            severity=decision.severity.value,
            diagnosis=analysis.diagnosis,
            prediction=prediction.model_dump(mode="json"),
            reasons=decision.reasons,
            recommendations=analysis.recommendations,
            tool_trace=trace,
        )

    @staticmethod
    def get_incident(incident_id: str):
        return store.get_incident(incident_id)

    @staticmethod
    def prepare_action(incident_id: str, action: IncidentAction) -> dict[str, Any]:
        incident = store.get_incident(incident_id)
        if incident is None:
            raise LookupError("Incident not found")

        if action.action == ActionType.FIND_GARAGE:
            if action.latitude is None or action.longitude is None:
                raise ValueError("latitude and longitude are required for find_garage")
            return {
                "status": "completed",
                "requires_confirmation": False,
                "result": search_nearby_garages(
                    action.latitude,
                    action.longitude,
                ),
            }
        if action.action == ActionType.BOOK_APPOINTMENT:
            pending = store.create_pending_action(
                incident_id,
                "book_appointment",
                {"garage_id": action.garage_id, "slot": action.slot},
            )
        else:
            pending = store.create_pending_action(
                incident_id,
                "remind_later",
                {"scheduled_for": action.scheduled_for.isoformat()},
            )

        return {
            "status": "pending_confirmation",
            "requires_confirmation": True,
            "pending_action": pending,
        }

    @staticmethod
    def confirm_action(incident_id: str, pending_action_id: str) -> dict[str, Any]:
        incident = store.get_incident(incident_id)
        pending = store.get_pending_action(pending_action_id)
        if incident is None or pending is None or pending["incident_id"] != incident_id:
            raise LookupError("Incident or pending action not found")
        if pending["status"] != "pending_confirmation":
            raise ValueError("Action was already executed or is no longer pending")

        if pending["action_type"] == "book_appointment":
            result = store.create_appointment(incident, pending["payload"])
        elif pending["action_type"] == "remind_later":
            result = store.create_reminder(incident, pending["payload"])
        else:
            raise ValueError("Unsupported pending action")
        store.mark_action_executed(pending_action_id)
        return {"status": "executed", "action_type": pending["action_type"], "result": result}


vehicle_agent = VehicleAgent()
