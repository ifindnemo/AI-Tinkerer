import time
from datetime import datetime, timezone


class RealClock:
    def now(self) -> float:
        return time.time()

    def sleep_until(self, timestamp: float) -> None:
        time.sleep(max(0.0, timestamp - time.time()))


class FakeClock:
    """Jumps instead of sleeping: a 10-minute scenario runs in milliseconds."""

    def __init__(self, start: float | None = None):
        self.t = time.time() if start is None else start

    def now(self) -> float:
        return self.t

    def sleep_until(self, timestamp: float) -> None:
        self.t = max(self.t, timestamp)


def utc(timestamp: float) -> datetime:
    return datetime.fromtimestamp(timestamp, timezone.utc)
