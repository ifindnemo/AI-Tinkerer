from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()

from routes import router  # noqa: E402
from store import store  # noqa: E402


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.initialize()
    yield


app = FastAPI(
    title="Vehicle Guardian API",
    description="ECU telemetry, ML incident detection, and human-controlled agent actions.",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router, prefix="/api")


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
