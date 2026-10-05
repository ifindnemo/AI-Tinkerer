import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from analysis.worker import AnalysisWorker
from store import utc_now
from telemetry.db import TelemetryStore, telemetry_store
from telemetry.ingest import ingest_batch
from telemetry.notify import after_ingest
from telemetry.queries import dtc_status, snapshot, vehicle_profile
from telemetry.schemas_v2 import IngestBatchV2
from telemetry.stream import Broker, broker, event_stream

log = logging.getLogger("car_neuron.ingest")
router = APIRouter()
_VEHICLE_ID = re.compile(r"^[\w-]{1,64}$")
SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}
_worker: AnalysisWorker | None = None


def get_telemetry_store() -> TelemetryStore:
    return telemetry_store


def get_broker() -> Broker:
    return broker


def get_worker() -> AnalysisWorker:
    global _worker
    if _worker is None:
        _worker = AnalysisWorker(telemetry_store, broker)
    return _worker


def _bearer_token(authorization: str | None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Missing device token")
    return token.strip()


def _vehicle(vehicle_id: str) -> str:
    if not _VEHICLE_ID.fullmatch(vehicle_id):
        raise HTTPException(status_code=404, detail="Unknown vehicle")
    return vehicle_id


@router.post("/ingest/batch", status_code=202, tags=["ingest"])
def receive_ingest_batch(
    batch: IngestBatchV2,
    authorization: str | None = Header(default=None),
    telemetry: TelemetryStore = Depends(get_telemetry_store),
    events: Broker = Depends(get_broker),
    worker: AnalysisWorker = Depends(get_worker),
) -> dict[str, Any]:
    """Accept one gateway batch (schema v2). Analysis runs in the background."""
    device = telemetry.authenticate(_bearer_token(authorization))
    if device is None:
        raise HTTPException(status_code=401, detail="Unknown device token")
    try:
        result = ingest_batch(telemetry, device, batch)
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    try:
        result["analysis_queued"] = after_ingest(telemetry, events, worker, batch, result)
    except Exception:  # the batch is stored; a notification failure must not make the gateway resend it
        log.exception("post-ingest processing failed for batch %s", batch.batch_id)
        result["analysis_queued"] = None
    return result


@router.get("/vehicles/{vehicle_id}/stream", tags=["live"])
async def stream_vehicle(
    vehicle_id: str,
    request: Request,
    telemetry: TelemetryStore = Depends(get_telemetry_store),
    events: Broker = Depends(get_broker),
) -> StreamingResponse:
    """Server-sent events: `snapshot` on connect, then samples, profile, dtc, trip, analysis."""
    _vehicle(vehicle_id)
    return StreamingResponse(
        event_stream(
            events,
            vehicle_id,
            lambda: run_in_threadpool(snapshot, telemetry, vehicle_id),
            request.is_disconnected,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/vehicles/{vehicle_id}/profile", tags=["live"])
def get_profile(vehicle_id: str, telemetry: TelemetryStore = Depends(get_telemetry_store)) -> dict[str, Any]:
    return vehicle_profile(telemetry, _vehicle(vehicle_id))


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=60)


@router.post("/vehicles/{vehicle_id}/profile", tags=["live"])
def update_profile(
    vehicle_id: str,
    update: ProfileUpdate,
    telemetry: TelemetryStore = Depends(get_telemetry_store),
    events: Broker = Depends(get_broker),
) -> dict[str, Any]:
    _vehicle(vehicle_id)
    telemetry.initialize()
    with telemetry.base.transaction() as connection:
        connection.execute(
            "INSERT INTO vehicles (id, display_name, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at",
            (vehicle_id, update.display_name.strip(), utc_now()),
        )
    profile = vehicle_profile(telemetry, vehicle_id)
    events.publish(vehicle_id, "profile", profile)
    return profile


@router.get("/vehicles/{vehicle_id}/dtc", tags=["live"])
def get_dtc(vehicle_id: str, telemetry: TelemetryStore = Depends(get_telemetry_store)) -> dict[str, Any]:
    return dtc_status(telemetry, _vehicle(vehicle_id))
