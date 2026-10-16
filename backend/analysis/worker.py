"""Background analysis: one job at a time, newest job per vehicle wins.

The LLM call is the only part with a timeout. When it fails or times out, the
rule-only assessment is used, and whichever result is chosen is persisted
exactly once (a late LLM reply is discarded).
"""

import json
import logging
import os
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

from analysis.context import build_context
from analysis.detector import LOOKBACK, evaluate, policy_for
from analysis.rules import rules_assessment
from driver.registry import attach_driver
from store import store, utc_now
from telemetry.db import TelemetryStore, iso_utc
from telemetry.ingest import add_trip_event
from telemetry.queries import (
    dtc_status,
    get_trip,
    latest_analysis_meta,
    samples_between,
    vehicle_profile,
)
from telemetry.stream import Broker, redact

log = logging.getLogger("car_neuron.analysis")
SEVERITY_TITLES = {
    "warning": "Agent cảnh báo",
    "critical": "Cảnh báo nguy hiểm",
    "normal": "Trở lại bình thường",
}


@dataclass(frozen=True)
class Job:
    vehicle_id: str
    trip_id: str
    until: str  # ISO time of the newest sample to include
    trigger: str
    rules: tuple[str, ...] = ()


class AnalysisWorker:
    def __init__(self, telemetry: TelemetryStore, broker: Broker, agent=None, timeout: float | None = None):
        self.telemetry = telemetry
        self.broker = broker
        self._agent = agent
        self.timeout = timeout if timeout is not None else float(os.getenv("AGENT_TIMEOUT_SECONDS", "45"))
        self._pending: "OrderedDict[str, Job]" = OrderedDict()
        self._submitted: dict[str, dict[str, Any]] = {}
        self._condition = threading.Condition()
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="agent")
        self._thread: threading.Thread | None = None

    @property
    def agent(self):
        if self._agent is None:
            from agent.orchestrator import vehicle_agent

            self._agent = vehicle_agent
        return self._agent

    # ---- queue ------------------------------------------------------------
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="analysis-worker", daemon=True)
            self._thread.start()

    def last_for(self, vehicle_id: str) -> dict[str, Any] | None:
        """The newest of: the latest stored analysis, the latest submitted job."""
        stored = latest_analysis_meta(self.telemetry, vehicle_id)
        with self._condition:
            submitted = self._submitted.get(vehicle_id)
        if stored and submitted:
            return submitted if submitted["at"] >= stored["at"] else stored
        return submitted or stored

    def submit(self, job: Job) -> None:
        with self._condition:
            self._pending.pop(job.vehicle_id, None)
            self._pending[job.vehicle_id] = job  # newer job replaces the queued one
            self._submitted[job.vehicle_id] = {"trip_id": job.trip_id, "at": job.until, "rules": list(job.rules)}
            self._condition.notify()

    def run_pending(self) -> list[dict[str, Any]]:
        """Process every queued job in this thread (tests, scripts)."""
        results = []
        while True:
            with self._condition:
                if not self._pending:
                    return results
                _, job = self._pending.popitem(last=False)
            results.append(self.process(job))

    def _loop(self) -> None:
        while True:
            with self._condition:
                while not self._pending:
                    self._condition.wait()
                _, job = self._pending.popitem(last=False)
            try:
                self.process(job)
            except Exception:  # keep the worker alive; the next batch retries
                log.exception("analysis failed for %s", job.vehicle_id)

    # ---- one analysis -----------------------------------------------------
    def _model(self, context: dict[str, Any], memory) -> tuple[Any, list, str, str | None]:
        """(raw assessment, trace, engine, fallback reason)."""
        if os.getenv("AGENT_MODE", "openai").lower() == "rules":
            return rules_assessment(context), [], "rules", "rules_mode"
        future = self._executor.submit(self.agent.model_assessment, context, memory)
        try:
            raw, trace = future.result(timeout=self.timeout)
            return raw, trace, "agent", None
        except TimeoutError:
            reason = "timeout"
        except Exception:
            log.exception("agent call failed")
            reason = "error"
        return rules_assessment(context), [], "rules", reason

    def process(self, job: Job) -> dict[str, Any]:
        trip = get_trip(self.telemetry, job.trip_id)
        if trip is None:
            raise LookupError(f"unknown trip {job.trip_id}")
        until = datetime.fromisoformat(job.until)
        history = samples_between(self.telemetry, job.trip_id, iso_utc(until - LOOKBACK), job.until)
        dtc = dtc_status(self.telemetry, job.vehicle_id, job.trip_id)
        profile = vehicle_profile(self.telemetry, job.vehicle_id)
        findings = evaluate(history, dtc)
        context = attach_driver(build_context(job.vehicle_id, trip, history, dtc, profile, findings))
        memory = store.get_active_incident_memory(job.vehicle_id)

        raw, trace, engine, fallback = self._model(context, memory)
        assessment, safety = self.agent.finalize(raw, context, trace, policy_for(findings, dtc))
        result = self.agent.persist_assessment(context, assessment, trace, safety, memory)

        analysis_id = f"ana_{uuid4().hex[:12]}"
        severity = assessment.severity.value
        payload = redact({
            "id": analysis_id,
            "vehicle_id": job.vehicle_id,
            "trip_id": job.trip_id,
            "at": job.until,
            "trigger": job.trigger,
            "engine": engine,
            "fallback_reason": fallback,
            "model_severity": raw.severity.value if engine == "agent" else None,
            "severity": severity,
            "findings": [finding.to_dict() for finding in findings],
            "record_count": context["record_count"],
            "simulated": trip["simulated"],
            "created_at": utc_now(),
            "reply": {**result, "batch_id": analysis_id, "accepted_records": context["record_count"]},
        })
        previous = latest_analysis_meta(self.telemetry, job.vehicle_id)
        previous_severity = self._severity_of_latest(job.trip_id)
        with self.telemetry.base.transaction() as connection:
            connection.execute(
                "INSERT INTO analyses (id, vehicle_id, trip_id, at, trigger, engine, model_severity, "
                "final_severity, findings_json, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    analysis_id,
                    job.vehicle_id,
                    job.trip_id,
                    job.until,
                    job.trigger,
                    engine,
                    payload["model_severity"],
                    severity,
                    json.dumps(payload["findings"], ensure_ascii=False),
                    json.dumps(payload, ensure_ascii=False),
                    payload["created_at"],
                ),
            )
            if severity != (previous_severity or "normal"):
                add_trip_event(
                    connection, job.trip_id, job.until, severity,
                    f"{SEVERITY_TITLES[severity]}: {assessment.diagnosis[:140]}", analysis_id,
                )
        log.info("analysis %s %s %s (%s, after %s)", analysis_id, job.trigger, severity, engine,
                 previous and previous["at"])
        self.broker.publish(job.vehicle_id, "analysis", payload)
        self.broker.publish(job.vehicle_id, "trip", get_trip(self.telemetry, job.trip_id))
        if severity == "normal":
            from voice import clear_alert_history

            clear_alert_history(job.vehicle_id)
        if severity in ("warning", "critical"):
            from voice import speak_car_result

            speak_car_result(job.vehicle_id, severity, "vi", result, assessment.diagnosis, assessment.recommendations)
        return payload

    def _severity_of_latest(self, trip_id: str) -> str | None:
        with self.telemetry.base.connect() as connection:
            row = connection.execute(
                "SELECT final_severity FROM analyses WHERE trip_id = ? ORDER BY at DESC, created_at DESC LIMIT 1",
                (trip_id,),
            ).fetchone()
        return row["final_severity"] if row else None

