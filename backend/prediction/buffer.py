import os
from collections import defaultdict, deque
from threading import Lock

from schemas import TelemetryInput


class TelemetryBuffer:
    def __init__(self, window_size: int | None = None):
        self.window_size = (
            window_size
            if window_size is not None
            else int(os.getenv("TELEMETRY_WINDOW_SIZE", "12"))
        )
        if self.window_size < 2:
            raise ValueError("TELEMETRY_WINDOW_SIZE must be at least 2")
        self._samples: dict[str, deque[TelemetryInput]] = defaultdict(
            lambda: deque(maxlen=self.window_size)
        )
        self._lock = Lock()

    def add(self, sample: TelemetryInput) -> list[TelemetryInput] | None:
        with self._lock:
            samples = self._samples[sample.vehicle_id]
            samples.append(sample)
            if len(samples) < self.window_size:
                return None
            return list(samples)

    def size(self, vehicle_id: str) -> int:
        with self._lock:
            return len(self._samples.get(vehicle_id, ()))

    def clear(self, vehicle_id: str) -> None:
        with self._lock:
            self._samples.pop(vehicle_id, None)


telemetry_buffer = TelemetryBuffer()
