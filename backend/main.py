import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()
# Without this the app's own log.info/warning lines (voice clips, agent fallbacks) never show.
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from routes import router  # noqa: E402
from store import store  # noqa: E402
from telemetry.db import telemetry_store  # noqa: E402
from telemetry.routes import get_worker, router as telemetry_router  # noqa: E402
from driver.routes import router as driver_router  # noqa: E402
from stt import router as stt_router  # noqa: E402
from voice import router as voice_router  # noqa: E402


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.initialize()
    telemetry_store.initialize()
    get_worker().start()
    yield


app = FastAPI(
    title="Vehicle Guardian API",
    description=(
        "Direct ECU telemetry assessment with deterministic safety guardrails, "
        "short-term incident memory, and human-controlled actions."
    ),
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router, prefix="/api")
app.include_router(telemetry_router, prefix="/api")
app.include_router(driver_router, prefix="/api")
app.include_router(stt_router, prefix="/api")
app.include_router(voice_router, prefix="/api")


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
