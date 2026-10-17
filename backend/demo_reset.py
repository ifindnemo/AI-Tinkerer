"""Start a demo run clean: forget what the last run left in this backend's memory.

`?reset=1` on /garage already clears the browser; without this the backend still holds the last run's newest
assessment (talk would say "stop" for 15 minutes), the last camera summary (live for 60 s), the open incident and the
spoken-alert history, and the first batch of the new run reads them. Local use only: it needs a loopback client, and the
page reaches it through the same-origin proxy. Nothing is deleted from the database: incidents are only closed."""
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()
log = logging.getLogger("car_neuron.api")
_LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


class ResetBody(BaseModel):
    scope: Literal["demo", "car"] = "demo"


def reset_demo_state(scope: str = "demo") -> dict[str, int | bool | str]:
    """scope "demo": a whole new run (page opened with reset=1). scope "car": the scenario was switched, so only what
    describes the car goes: the camera and the conversation go on, because the driver did not change."""
    from situation import clear_situations, start_new_epoch
    from store import store
    from voice import clear_all_alert_history

    start_new_epoch()  # an analysis still running for the old scenario is dropped when it finishes
    clear_situations()
    clear_all_alert_history()
    result: dict[str, int | bool | str] = {"scope": scope, "closed_incidents": store.close_open_incidents(), "ok": True}
    if scope == "demo":
        from driver.registry import driver_registry
        from talk import clear_turns

        driver_registry.clear()
        clear_turns()
        result["transcripts"] = _forget_transcripts()
    return result


def _forget_transcripts() -> int:
    """The last run's spoken turns would be read back to the model as this run's conversation. `./demo.sh` removes the
    same files when it starts; only the transcript files are touched."""
    from stt import _conversation_dir

    removed = 0
    try:
        for path in _conversation_dir().glob("*.json"):
            path.unlink(missing_ok=True)
            removed += 1
    except OSError:
        log.warning("could not remove all conversation transcripts", exc_info=True)
    return removed


@router.post("/demo/reset", tags=["demo"])
def reset(request: Request, body: ResetBody | None = None) -> dict:
    client = request.client.host if request.client else ""
    if client not in _LOOPBACK:
        raise HTTPException(status_code=403, detail="The demo reset is for the local machine only.")
    result = reset_demo_state(body.scope if body else "demo")
    log.info("demo state reset: %s", result)
    return result
