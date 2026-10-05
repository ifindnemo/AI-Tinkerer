import secrets
from datetime import datetime, timedelta

ENGINE_OFF_END = timedelta(seconds=120)
GAP_END = timedelta(minutes=5)


class TripTracker:
    """A trip starts when the engine runs and ends after 120 s with rpm 0 or a 5-minute gap.

    Cars without an rpm PID are treated as running while data arrives.
    """

    def __init__(self):
        self.trip_id: str | None = None
        self.last_at: datetime | None = None
        self.engine_off_since: datetime | None = None

    def update(self, at: datetime, rpm: float | None) -> str | None:
        """Return the current trip id, or None when no trip is active."""
        running = rpm is None or rpm > 0
        if self.trip_id and self.last_at and at - self.last_at > GAP_END:
            self.trip_id = None
        self.last_at = at
        if self.trip_id is None:
            if not running:
                return None
            self.trip_id = f"trip_{at:%Y%m%dT%H%M%SZ}_{secrets.token_hex(2)}"
            self.engine_off_since = None
            return self.trip_id
        if running:
            self.engine_off_since = None
        elif self.engine_off_since is None:
            self.engine_off_since = at
        elif at - self.engine_off_since >= ENGINE_OFF_END:
            self.trip_id = None
            return None
        return self.trip_id
