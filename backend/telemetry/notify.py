"""After a batch is committed: tell the dashboard, run the detector, maybe queue an analysis."""

import logging
from typing import Any

from analysis.detector import LOOKBACK, evaluate, should_analyze
from analysis.worker import AnalysisWorker, Job
from telemetry.db import TelemetryStore, iso_utc
from telemetry.queries import dtc_status, get_trip, samples_between, vehicle_profile
from telemetry.schemas_v2 import IngestBatchV2
from telemetry.stream import Broker

log = logging.getLogger("car_neuron.ingest")


def after_ingest(
    telemetry: TelemetryStore,
    broker: Broker,
    worker: AnalysisWorker,
    batch: IngestBatchV2,
    result: dict[str, Any],
) -> str | None:
    """Returns the analysis trigger, if one was queued. Must run after the commit."""
    if result.get("status") != "accepted":
        return None
    vehicle_id, trip_id = result["vehicle_id"], result["trip_id"]

    samples = []
    for record in batch.records:
        sample: dict[str, Any] = {"capturedAt": iso_utc(record.captured_at), "signals": record.signals}
        if record.location:
            sample["location"] = {"lat": record.location.lat, "lon": record.location.lon, "fixed": record.location.fixed}
        samples.append(sample)
    broker.publish(vehicle_id, "samples", {"trip_id": trip_id, "simulated": batch.simulated, "samples": samples})
    if result.get("profile_changed"):
        broker.publish(vehicle_id, "profile", vehicle_profile(telemetry, vehicle_id))
    dtc = dtc_status(telemetry, vehicle_id, trip_id)
    if batch.dtc:
        broker.publish(vehicle_id, "dtc", dtc)
    broker.publish(vehicle_id, "trip", get_trip(telemetry, trip_id))

    last_at = batch.records[-1].captured_at
    until = iso_utc(last_at)
    history = samples_between(telemetry, trip_id, iso_utc(last_at - LOOKBACK), until)
    findings = evaluate(history, dtc)
    trigger = should_analyze(
        batch_last_at=last_at,
        trip_id=trip_id,
        findings=findings,
        new_dtc_codes=result.get("new_dtc_codes", []),
        profile_changed=bool(result.get("profile_changed")),
        last=worker.last_for(vehicle_id),
    )
    if trigger:
        worker.submit(Job(vehicle_id, trip_id, until, trigger, tuple(f.rule for f in findings)))
        log.info("queued %s analysis for %s at %s", trigger, vehicle_id, until)
    return trigger
