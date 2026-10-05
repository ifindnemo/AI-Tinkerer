"""Builds the agent input for device data in the shape the guardrails already read."""

from typing import Any

from analysis.detector import Finding
from dtc.kb import explain
from telemetry.signals import BY_NAME, to_agent_record

CONTEXT_SAMPLES = 30


def build_context(
    vehicle_id: str,
    trip: dict[str, Any],
    samples: list[dict[str, Any]],
    dtc: dict[str, Any],
    profile: dict[str, Any],
    findings: list[Finding],
) -> dict[str, Any]:
    samples = samples[-CONTEXT_SAMPLES:]
    records = []
    for sample in samples:
        record: dict[str, Any] = {"captured_at": sample["capturedAt"], **to_agent_record(sample["signals"])}
        if sample.get("location"):
            record["location"] = {"lat": sample["location"]["lat"], "lon": sample["location"]["lon"]}
        records.append(record)
    location = next((s["location"] for s in reversed(samples) if s.get("location")), None)
    codes = dtc.get("codes", [])
    return {
        "schema_version": 2,
        "batch_id": f"{trip['id']}@{samples[-1]['capturedAt']}" if samples else trip["id"],
        "vehicle_id": vehicle_id,
        "source": trip["source"],
        "simulated": trip["simulated"],
        "sample_interval_ms": 1000,
        "record_count": len(records),
        "current_location": (
            {"latitude": location["lat"], "longitude": location["lon"]} if location else None
        ),
        "location_is_fixed": bool(location and location.get("fixed")),
        "records": records,
        "supported_signals": [BY_NAME[name].agent_key for name in profile.get("supported_signals", [])],
        "missing_signals": [BY_NAME[name].agent_key for name in profile.get("missing_signals", [])],
        "dtc_snapshot": {
            "mil": bool(dtc.get("mil")),
            "stored": [c["code"] for c in codes if c["kind"] == "stored"],
            "pending": [c["code"] for c in codes if c["kind"] == "pending"],
            "freeze_frames": {
                c["code"]: to_agent_record(c["freeze_frame"]) for c in codes if c.get("freeze_frame")
            },
            "knowledge": {
                c["code"]: {
                    key: explain(c["code"])[key]
                    for key in ("known", "title", "urgency", "meaning", "causes", "checks", "advice")
                }
                for c in codes
            },
        },
        "detector_findings": [finding.to_dict() for finding in findings],
    }
