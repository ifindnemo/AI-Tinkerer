import json
import os
from typing import Any

from agent.prompt import SYSTEM_PROMPT
from agent.tools import (
    READ_TOOL_SCHEMAS,
    execute_read_tool,
    get_external_environment_context_data,
    get_garage_slots,
    get_vehicle_history,
    prepare_booking,
    prepare_reminder,
    search_garages,
)
from schemas import (
    ActionType,
    IncidentAction,
    PolicyDecision,
    PredictionResult,
    Severity,
    TelemetryInput,
)
from store import store


class VehicleAgent:
    def __init__(self):
        self.model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    @staticmethod
    def _fallback_analysis(
        sample: TelemetryInput,
        prediction: PredictionResult,
        decision: PolicyDecision,
        telemetry_context: dict[str, Any],
    ) -> tuple[str, list[dict[str, Any]]]:
        current_location = telemetry_context.get(
            "current_location",
            {"latitude": sample.latitude, "longitude": sample.longitude},
        )
        environment_context = get_external_environment_context_data(
            current_location["latitude"], current_location["longitude"]
        ).model_dump(mode="json")
        history = get_vehicle_history(sample.vehicle_id)
        garages = search_garages(
            current_location["latitude"], current_location["longitude"]
        )
        trace = [
            {
                "tool": "get_external_environment_context",
                "arguments": {},
                "resolved_location": current_location,
                "result": environment_context,
            },
            {
                "tool": "get_vehicle_history",
                "arguments": {"vehicle_id": sample.vehicle_id},
                "result": history,
            },
            {
                "tool": "search_garages",
                "arguments": current_location,
                "result": garages,
            },
        ]
        trace.insert(
            0,
            {
                "source": "frontend_telemetry",
                "record_count": telemetry_context["record_count"],
                "fault_label_removed": True,
            },
        )
        previous = "Xe chưa có lỗi tương tự trong lịch sử."
        if history["records"]:
            previous = f"Tìm thấy {len(history['records'])} bản ghi bảo dưỡng/lỗi trước đây."
        diagnosis = (
            f"Hệ thống phát hiện {prediction.label} ({prediction.confidence:.0%}). "
            f"{previous} Cần kiểm tra tại garage; kết quả ML không thay thế chẩn đoán kỹ thuật."
        )
        if decision.severity == Severity.CRITICAL:
            diagnosis = "Hãy dừng xe ở vị trí an toàn và tắt máy. " + diagnosis
        return diagnosis, trace

    def _openai_analysis(
        self,
        sample: TelemetryInput,
        prediction: PredictionResult,
        decision: PolicyDecision,
        telemetry_context: dict[str, Any],
    ) -> tuple[str, list[dict[str, Any]]]:
        from openai import OpenAI

        client = OpenAI()
        current_location = telemetry_context.get(
            "current_location",
            {"latitude": sample.latitude, "longitude": sample.longitude},
        )
        input_items: list[Any] = [
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "telemetry_context": telemetry_context,
                        "prediction": prediction.model_dump(mode="json"),
                        "policy": decision.model_dump(mode="json"),
                        "default_location": current_location,
                    },
                    ensure_ascii=False,
                ),
            }
        ]
        trace: list[dict[str, Any]] = []

        for turn in range(4):
            response = client.responses.create(
                model=self.model,
                instructions=SYSTEM_PROMPT,
                input=input_items,
                tools=READ_TOOL_SCHEMAS,
                tool_choice=(
                    {
                        "type": "function",
                        "name": "get_external_environment_context",
                    }
                    if turn == 0
                    else "auto"
                ),
                store=False,
            )
            input_items.extend(item.model_dump() for item in response.output)
            calls = [item for item in response.output if item.type == "function_call"]
            if not calls:
                return response.output_text, trace
            for call in calls:
                arguments = json.loads(call.arguments)
                try:
                    result = execute_read_tool(
                        call.name,
                        arguments,
                        telemetry_context=telemetry_context,
                    )
                except Exception as error:
                    result = {"error": str(error)}
                trace_item = {
                    "tool": call.name,
                    "arguments": arguments,
                    "result": result,
                }
                if call.name == "get_external_environment_context":
                    trace_item["resolved_location"] = current_location
                trace.append(trace_item)
                input_items.append(
                    {
                        "type": "function_call_output",
                        "call_id": call.call_id,
                        "output": json.dumps(result, ensure_ascii=False),
                    }
                )
        raise RuntimeError("Agent exceeded the tool-call turn limit")

    def create_incident(
        self,
        sample: TelemetryInput,
        prediction: PredictionResult,
        decision: PolicyDecision,
        telemetry_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        existing = store.get_open_incident(sample.vehicle_id)
        if existing:
            return existing

        if telemetry_context is None:
            telemetry_context = {
                "schema_version": 1,
                "batch_id": None,
                "vehicle_id": sample.vehicle_id,
                "source": "single_telemetry_request",
                "record_count": 1,
                "current_location": {
                    "latitude": sample.latitude,
                    "longitude": sample.longitude,
                },
                "records": [sample.model_dump(mode="json")],
            }

        if os.getenv("OPENAI_API_KEY"):
            try:
                diagnosis, trace = self._openai_analysis(
                    sample, prediction, decision, telemetry_context
                )
            except Exception as error:
                diagnosis, trace = self._fallback_analysis(
                    sample, prediction, decision, telemetry_context
                )
                trace.append({"tool": "openai_agent", "error": str(error), "fallback": True})
        else:
            diagnosis, trace = self._fallback_analysis(
                sample, prediction, decision, telemetry_context
            )
            trace.append({"tool": "openai_agent", "skipped": "OPENAI_API_KEY is not configured"})

        recommendations = ["Xem garage gần nhất", "Chọn lịch sửa xe", "Nhắc lại vào thời điểm khác"]
        if decision.severity == Severity.CRITICAL:
            recommendations.insert(0, "Dừng xe an toàn và tắt máy")

        return store.create_incident(
            vehicle_id=sample.vehicle_id,
            severity=decision.severity.value,
            diagnosis=diagnosis,
            prediction=prediction.model_dump(mode="json"),
            reasons=decision.reasons,
            recommendations=recommendations,
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
            return {
                "status": "completed",
                "requires_confirmation": False,
                "result": search_garages(
                    action.latitude or 16.0544,
                    action.longitude or 108.2022,
                ),
            }
        if action.action == ActionType.BOOK_APPOINTMENT:
            slots = get_garage_slots(action.garage_id)
            if action.slot not in slots["slots"]:
                raise ValueError("Selected slot is not available")
            pending = prepare_booking(incident_id, action.garage_id, action.slot)
        else:
            pending = prepare_reminder(incident_id, action.scheduled_for.isoformat())

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
