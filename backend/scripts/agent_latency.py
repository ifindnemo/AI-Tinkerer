"""Manual paid measurement of one vehicle-agent run; never runs without CAR_NEURON_ALLOW_PAID_LLM=1.

Sends a "running warm" batch (coolant 96 -> 106.5 C, 65 km/h) to the real model once or twice and prints where the
time goes: the whole run, each tool, the number of model calls, tokens. Tools run side by side, so read them
against the total rather than adding them up. The same line is logged by the backend on every real batch
(logger car_neuron.agent, "agent run ...").
"""
import argparse
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def warm_body(count: int = 15) -> dict:
    start = datetime(2026, 10, 17, tzinfo=timezone.utc)
    records = [{"capturedAt": (start + timedelta(seconds=i)).isoformat().replace("+00:00", "Z"), "rpm": 2400, "map": 60, "tps": 30,
                "engineLoad": 70, "consumption": 8, "speed": 65, "coolant": round(96 + 10.5 * min(1, i / 10), 1), "intake": 38,
                "battery": 13.9, "fan": 0, "location": {"lat": 10.8, "lon": 106.7}} for i in range(count)]
    return {"schemaVersion": 1, "batchId": "agent-latency", "vehicleId": "agent-latency", "source": "blackbox-simulator",
            "sampleIntervalMs": 1000, "recordCount": len(records), "records": records}


def main(argv=None) -> int:
    if os.getenv("CAR_NEURON_ALLOW_PAID_LLM") != "1":
        print("Refusing paid LLM calls: set CAR_NEURON_ALLOW_PAID_LLM=1 explicitly to run.")
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeat", type=int, choices=range(1, 3), default=2, help="the second run shows prompt caching")
    args = parser.parse_args(argv)
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    import logging
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("car_neuron.agent").setLevel(logging.INFO)
    from agent.orchestrator import VehicleAgent
    from schemas import TelemetryBatchInput

    context = TelemetryBatchInput.model_validate(warm_body()).to_agent_context()
    agent = VehicleAgent()
    for run in range(1, args.repeat + 1):
        started = time.monotonic()
        try:
            assessment, trace = agent.model_assessment(dict(context), None)
        except Exception as error:
            print(f"run {run}: failed ({type(error).__name__}); service details omitted")
            return 1
        print(f"run {run}: {(time.monotonic() - started) * 1000:.0f} ms, severity={assessment.severity.value}, tools={[step['tool'] for step in trace]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
