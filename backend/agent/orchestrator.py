import json
import os
from datetime import datetime, timedelta
from typing import Any

from agents import Agent, Runner

import llm_provider

from agent.prompt import build_agent_instructions
from agent.safety import evaluate_hard_safety
from agent.tools.garage_search import search_nearby_garages
from agent.tools import (
    VEHICLE_READ_TOOLS,
    VehicleToolContext,
    create_google_calendar_event,
)
from schemas import (
    ActionType,
    IncidentAction,
    SafetyGuardrailResult,
    Severity,
    VehicleAssessment,
)
from store import store


SEVERITY_RANK = {
    Severity.NORMAL: 0,
    Severity.WARNING: 1,
    Severity.CRITICAL: 2,
}


class VehicleAgent:
    def __init__(self):
        llm_provider.configure()
        self.model = llm_provider.model_name()
        self.agent = Agent[VehicleToolContext](
            name="Vehicle Guardian",
            instructions=build_agent_instructions(),
            model=self.model,
            model_settings=llm_provider.model_settings(parallel_tool_calls=True),
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

    def model_assessment(
        self,
        telemetry_context: dict[str, Any],
        short_term_memory: dict[str, Any] | None,
    ) -> tuple[VehicleAssessment, list[dict[str, Any]]]:
        """Run the LLM agent only. Returns its raw assessment and tool trace."""
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
        return result.final_output, context.trace

    def finalize(
        self,
        raw: VehicleAssessment,
        telemetry_context: dict[str, Any],
        trace: list[dict[str, Any]],
        policy: dict[str, Any] | None = None,
    ) -> tuple[VehicleAssessment, dict[str, Any]]:
        """Deterministic floors and ceilings, then the garage lookup for alerts."""
        safety = evaluate_hard_safety(telemetry_context)
        assessment = self._enforce_safety_floor(raw, safety)
        assessment = self._enforce_simulated_nominal_profile(
            assessment,
            telemetry_context,
            safety.triggered,
        )
        if policy:
            assessment = self._apply_detector_policy(assessment, telemetry_context, safety, policy)
        self._ensure_nearby_garages(assessment, telemetry_context, trace)
        return assessment, safety.model_dump(mode="json")

    def _run_analysis(
        self,
        telemetry_context: dict[str, Any],
        short_term_memory: dict[str, Any] | None,
        policy: dict[str, Any] | None = None,
    ) -> tuple[VehicleAssessment, list[dict[str, Any]], dict[str, Any]]:
        raw, trace = self.model_assessment(telemetry_context, short_term_memory)
        assessment, safety = self.finalize(raw, telemetry_context, trace, policy)
        return assessment, trace, safety

    @classmethod
    def _apply_detector_policy(
        cls,
        assessment: VehicleAssessment,
        telemetry_context: dict[str, Any],
        safety,
        policy: dict[str, Any],
    ) -> VehicleAssessment:
        """Device data: rules set a minimum severity, and with no rule, no DTC and no
        guardrail the model alone cannot raise an alert (ceiling = normal)."""
        floor = Severity(policy.get("minimum_severity", "normal"))
        if SEVERITY_RANK[floor] > SEVERITY_RANK[Severity.NORMAL]:
            assessment = cls._enforce_safety_floor(
                assessment,
                SafetyGuardrailResult(
                    triggered=True,
                    minimum_severity=floor,
                    reasons=list(policy.get("reasons", [])),
                ),
            )
        if (
            policy.get("ceiling_normal")
            and not safety.triggered
            and assessment.severity != Severity.NORMAL
        ):
            records = telemetry_context.get("records") or []
            coolant = [r["coolant_temp_c"] for r in records if r.get("coolant_temp_c") is not None]
            evidence = (
                [f"Nhiệt độ nước làm mát {min(coolant):.1f}–{max(coolant):.1f}°C, chưa chạm ngưỡng cảnh báo."]
                if coolant
                else []
            )
            assessment = VehicleAssessment(
                severity=Severity.NORMAL,
                diagnosis=(
                    f"Trong {len(records)} mẫu gần nhất, các chỉ số chưa vượt ngưỡng cảnh báo của hệ thống "
                    "và xe không báo mã lỗi."
                ),
                suspected_faults=[],
                evidence=[*evidence, "Không có mã lỗi DTC và đèn check engine tắt."],
                confidence=0.8,
                missing_data=list(assessment.missing_data),
                recommendations=["Tiếp tục theo dõi xe trong các chuyến tiếp theo."],
            )
        return assessment

    @staticmethod
    def _enforce_simulated_nominal_profile(
        assessment: VehicleAssessment,
        telemetry_context: dict[str, Any],
        safety_triggered: bool,
    ) -> VehicleAssessment:
        """Prevent model-only thermal false positives in the stable demo profile."""
        records = telemetry_context.get("records") or []
        if (
            telemetry_context.get("source") != "simulated"
            or safety_triggered
            or not records
        ):
            return assessment

        def values(name: str) -> list[float]:
            return [
                float(record[name])
                for record in records
                if record.get(name) is not None
            ]

        coolant = values("coolant_temp_c")
        oil = values("oil_temp_c")
        intake = values("intake_air_temp_c")
        battery = values("battery_voltage")
        fuel = values("fuel_percent")
        has_dtc = any(record.get("dtc") for record in records)
        nominal = (
            len(coolant) == len(records)
            and len(battery) == len(records)
            and not has_dtc
            and all(-20 <= value <= 105 for value in coolant)
            and max(coolant) - min(coolant) <= 2
            and all(12 <= value <= 15.2 for value in battery)
            and max(battery) - min(battery) <= 0.5
            and (not oil or (all(0 <= value <= 115 for value in oil) and max(oil) - min(oil) <= 3))
            and (not intake or all(-30 <= value <= 70 for value in intake))
            and (not fuel or all(value >= 10 for value in fuel))
        )
        if not nominal:
            return assessment

        evidence = [
            f"Nhiệt độ nước làm mát ổn định {min(coolant):.1f}–{max(coolant):.1f}°C.",
            f"Điện áp ổn định {min(battery):.1f}–{max(battery):.1f}V.",
            "Không ghi nhận mã lỗi DTC trong batch hiện tại.",
        ]
        if oil:
            evidence.insert(
                1,
                f"Nhiệt độ dầu ổn định {min(oil):.1f}–{max(oil):.1f}°C.",
            )
        return VehicleAssessment(
            severity=Severity.NORMAL,
            diagnosis=(
                "Các chỉ số trong 15 mẫu mô phỏng ổn định và nằm trong vùng "
                "vận hành bình thường; chưa ghi nhận dấu hiệu quá nhiệt hoặc lỗi hiện tại."
            ),
            suspected_faults=[],
            evidence=evidence,
            confidence=0.9,
            missing_data=[],
            recommendations=["Tiếp tục theo dõi xe trong các gói telemetry tiếp theo."],
        )

    @staticmethod
    def _ensure_nearby_garages(
        assessment: VehicleAssessment,
        telemetry_context: dict[str, Any],
        trace: list[dict[str, Any]],
    ) -> None:
        """Always attempt a nearby-garage lookup for a final warning or critical result."""
        if assessment.severity == Severity.NORMAL or any(
            item.get("tool") == "search_nearby_garages" for item in trace
        ):
            return
        if os.getenv("EXTERNAL_TOOLS", "on").lower() == "off":
            return  # offline demo / tests: never call LocationIQ

        location = telemetry_context.get("current_location") or {}
        latitude = location.get("latitude")
        longitude = location.get("longitude")
        if not isinstance(latitude, (int, float)) or not isinstance(
            longitude, (int, float)
        ):
            return

        arguments = {
            "latitude": latitude,
            "longitude": longitude,
            "radius_meters": 5_000,
            "max_results": 5,
        }
        try:
            result = search_nearby_garages(**arguments)
        except Exception as error:
            result = {"error": str(error)}
        trace.append(
            {
                "tool": "search_nearby_garages",
                "arguments": arguments,
                "result": result,
            }
        )

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
        return self.persist_assessment(
            telemetry_context, assessment, trace, safety, previous_memory
        )

    @staticmethod
    def persist_assessment(
        telemetry_context: dict[str, Any],
        assessment: VehicleAssessment,
        trace: list[dict[str, Any]],
        safety: dict[str, Any],
        previous_memory: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """Open or update the incident and its short-term memory for an alert.
        Called exactly once per analysis, after the final assessment is chosen."""
        vehicle_id = str(telemetry_context["vehicle_id"])
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
