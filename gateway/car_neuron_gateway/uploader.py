"""Posts batches to the backend. Offline batches wait on disk and are resent in order."""

import json
import time
from pathlib import Path

import httpx

RETRY = "retry"
SENT = "sent"
SPOOLED = "spooled"
REJECTED = "rejected"


class Uploader:
    def __init__(
        self,
        server: str,
        token: str,
        spool_dir: Path,
        path: str = "/api/ingest/batch",
        client: httpx.Client | None = None,
    ):
        self.url = server.rstrip("/") + path
        self.headers = {"Authorization": f"Bearer {token}"}
        self.spool = Path(spool_dir)
        self.rejected = self.spool / "rejected"
        self.spool.mkdir(parents=True, exist_ok=True)
        self.client = client or httpx.Client(timeout=10)

    def send(self, batch: dict) -> str:
        if not self._drain():
            self._save(self.spool, batch)
            return SPOOLED
        result = self._post(batch)
        if result == RETRY:
            self._save(self.spool, batch)
            return SPOOLED
        return result

    def pending(self) -> int:
        return len(list(self.spool.glob("*.json")))

    def _post(self, batch: dict) -> str:
        try:
            response = self.client.post(self.url, json=batch, headers=self.headers)
        except httpx.HTTPError:
            return RETRY
        if response.status_code in (200, 202):
            return SENT
        if response.status_code in (400, 401, 403, 404, 409, 422):
            # Resending will not help; keep it for inspection instead of retrying forever.
            self._save(self.rejected, {"status": response.status_code, "reply": response.text, "batch": batch})
            return REJECTED
        return RETRY

    def _drain(self) -> bool:
        for path in sorted(self.spool.glob("*.json")):
            if self._post(json.loads(path.read_text(encoding="utf-8"))) == RETRY:
                return False
            path.unlink()
        return True

    @staticmethod
    def _save(folder: Path, payload: dict) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{time.time_ns():020d}-{payload.get('batchId', 'rejected')}.json"
        temporary = folder / f".{name}.tmp"
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary.rename(folder / name)
