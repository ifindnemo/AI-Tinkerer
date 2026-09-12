import json
import os
from datetime import datetime, timedelta
from typing import Any

from agents import Agent, ModelSettings, Runner

from agent.prompt import build_agent_instructions
from agent.safety import evaluate_hard_safety
from agent.tools import (
    VEHICLE_READ_TOOLS,
    VehicleToolContext,
    create_google_calendar_event,
)
from schemas import ActionType, IncidentAction, Severity, VehicleAssessment
from store import store


SEVERITY_RANK = {
    Severity.NORMAL: 0,
    Severity.WARNING: 1,
    Severity.CRITICAL: 2,
}


class VehicleAgent:
    def __init__(self):
        self.model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        self.agent = Agent[VehicleToolContext](
            name="Vehicle Guardian",
            instructions=build_agent_instructions(),
            model=self.model,
            model_settings=ModelSettings(
                parallel_tool_calls=True,
                store=False,
            ),
            tools=VEHICLE_READ_TOOLS,
            output_type=VehicleAssessment,
        )

    @staticmethod
    def _enforce_safety_floor(
        assessment: VehicleAssessment,
        safety,
    ) -> VehicleAssessment:
        target_severity = assessment.severity
        if SEVERITY_RANK[target_severity] < SEVERITY_RANK[safety.minimum_severity]:
            target_severity = safety.minimum_severity

        evidence = list(dict.fromkeys([*safety.reasons, *assessment.evidence]))[:8]
        recommendations = list(assessment.recommendations)
        if target_severity == Severity.CRITICAL:
            critical_action = "Dừng xe ở vị trí an toàn và không tiếp tục lái."
            recommendations = [
                critical_action,
                *[item for item in recommendations if item != critical_action],
            ][:5]

        if (
            target_severity == assessment.severity
            and evidence == assessment.evidence
            and recommendations == assessment.recommendations
        ):
            return assessment
        return assessment.model_copy(
            update={
                "severity": target_severity,
                "evidence": evidence,
                "recommendations": recommendations,
            }
        )

    def _run_analysis(
        self,
        telemetry_context: dict[str, Any],
        short_term_memory: dict[str, Any] | None,
    ) -> tuple[VehicleAssessment, list[dict[str, Any]], dict[str, Any]]:
        vehicle_id = str(telemetry_context["vehicle_id"])
        current_location = telemetry_context.get("current_location") or {}
        context = VehicleToolContext(
            vehicle_id=vehicle_id,
            latitude=current_location.get("latitude"),
            longitude=current_location.get("longitude"),
        )
        safety = evaluate_hard_safety(telemetry_context)
        input_data = {
            "telemetry_context": telemetry_context,
            "hard_safety_guardrail": safety.model_dump(mode="json"),
            "short_term_memory": short_term_memory,
        }
        result = Runner.run_sync(
            self.agent,
            json.dumps(input_data, ensure_ascii=False),
            context=context,
            max_turns=6,
        )
        if not isinstance(result.final_output, VehicleAssessment):
            raise RuntimeError("OpenAI agent returned an invalid vehicle assessment")
        assessment = self._enforce_safety_floor(result.final_output, safety)
        return assessment, context.trace, safety.model_dump(mode="json")

    def analyze_telemetry_context(
        self,
        telemetry_context: dict[str, Any],
    ) -> dict[str, Any]:
        vehicle_id = str(telemetry_context["vehicle_id"])
        previous_memory = store.get_active_incident_memory(vehicle_id)
        assessment, trace, safety = self._run_analysis(
            telemetry_context,
            previous_memory,
        )
        assessment_data = assessment.model_dump(mode="json")

        result: dict[str, Any] = {
            "status": assessment.severity.value,
            "vehicle_id": vehicle_id,
            "assessment": assessment_data,
            "hard_safety_guardrail": safety,
            "tool_trace": trace,
        }
        if assessment.severity == Severity.NORMAL:
            result["memory"] = (
                {
                    "id": previous_memory["id"],
                    "status": previous_memory["status"],
                    "expires_at": previous_memory["expires_at"],
                }
                if previous_memory
                else None
            )
            return result

        existing = store.get_open_incident(vehicle_id)
        if existing:
            incident = store.update_incident_analysis(
                existing["id"],
                severity=assessment.severity.value,
                diagnosis=assessment.diagnosis,
                assessment=assessment_data,
                reasons=assessment.evidence,
                recommendations=assessment.recommendations,
                tool_trace=trace,
            )
        else:
            incident = store.create_incident(
                vehicle_id=vehicle_id,
                severity=assessment.severity.value,
                diagnosis=assessment.diagnosis,
                assessment=assessment_data,
                reasons=assessment.evidence,
                recommendations=assessment.recommendations,
                tool_trace=trace,
            )

        memory = store.upsert_incident_memory(
            incident_id=incident["id"],
            vehicle_id=vehicle_id,
            telemetry_context=telemetry_context,
            assessment=assessment_data,
            tool_trace=trace,
        )
        result.update(
            {
                "status": "incident_created",
                "incident": incident,
                "memory": {
                    "id": memory["id"],
                    "status": memory["status"],
                    "expires_at": memory["expires_at"],
                },
            }
        )
        return result

    @staticmethod
    def get_incident(incident_id: str):
        return store.get_incident(incident_id)

    @staticmethod
    def get_incident_memory(incident_id: str):
        return store.get_incident_memory(incident_id)

    @staticmethod
    def prepare_action(incident_id: str, action: IncidentAction) -> dict[str, Any]:
        incident = store.get_incident(incident_id)
        if incident is None:
            raise LookupError("Incident not found")
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
        store.update_incident_memory_status(incident_id, "waiting_confirmation")
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
            start = datetime.fromisoformat(
                pending["payload"]["slot"].replace("Z", "+00:00")
            )
            if start.tzinfo is None:
                raise ValueError("Booking slot must include a timezone offset")
            calendar_event = create_google_calendar_event(
                summary=f"Bảo dưỡng xe {incident['vehicle_id']}",
                start_time=start.isoformat(),
                end_time=(start + timedelta(hours=1)).isoformat(),
                time_zone=os.getenv("GOOGLE_CALENDAR_TIME_ZONE", "Asia/Ho_Chi_Minh"),
                description=f"Vehicle Guardian incident {incident_id}",
                location=pending["payload"]["garage_id"],
            )
            result = store.create_appointment(incident, pending["payload"])
            result["calendar_event"] = calendar_event
        elif pending["action_type"] == "remind_later":
            result = store.create_reminder(incident, pending["payload"])
        else:
            raise ValueError("Unsupported pending action")
        store.mark_action_executed(pending_action_id)
        store.update_incident_memory_status(incident_id, "action_completed")
        return {"status": "executed", "action_type": pending["action_type"], "result": result}


vehicle_agent = VehicleAgent()
