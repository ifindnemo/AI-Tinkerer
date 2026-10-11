from typing import Any

from fastapi import APIRouter, Depends

from driver.schemas import DriverBatch
from driver.service import DriverService, driver_service

router = APIRouter()


def get_driver_service() -> DriverService:
    return driver_service


@router.post("/driver/events", tags=["driver"])
def receive_driver_events(batch: DriverBatch, service: DriverService = Depends(get_driver_service)) -> dict[str, Any]:
    """Structured attention events from the browser (never video). Returns the current assessment."""
    return service.process(batch)
