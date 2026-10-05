"""Server-sent events for the live dashboard.

Ingest and the analysis worker run in threads; each subscriber lives on the
event loop that served its request, so publishing hops loops with
`call_soon_threadsafe`. Every payload is redacted here because the Next.js SSE
route passes the stream through unchanged.
"""

import asyncio
import json
import re
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from threading import Lock
from typing import Any

QUEUE_SIZE = 500
HEARTBEAT_SECONDS = 15.0

_URL_SECRET = re.compile(r"([?&](?:key|access_token|api_key|token)=)[^&\s\"<>]+", re.IGNORECASE)
_OPENAI_KEY = re.compile(r"\bsk-[\w-]{16,}")
GENERIC_ERROR = "Dịch vụ chưa trả được dữ liệu."


def redact(value: Any) -> Any:
    """Same rules as the frontend `publicPayload`: tool errors become a generic message."""
    if isinstance(value, str):
        return _OPENAI_KEY.sub("[redacted]", _URL_SECRET.sub(r"\1[redacted]", value))
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {
            key: GENERIC_ERROR if key == "error" and item is not None else redact(item)
            for key, item in value.items()
        }
    return value


def format_event(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


class Broker:
    def __init__(self, queue_size: int = QUEUE_SIZE):
        self.queue_size = queue_size
        self._subscribers: dict[str, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = defaultdict(list)
        self._lock = Lock()

    def subscribe(self, vehicle_id: str) -> asyncio.Queue:
        """Call from the request's event loop."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=self.queue_size)
        with self._lock:
            self._subscribers[vehicle_id].append((asyncio.get_running_loop(), queue))
        return queue

    def unsubscribe(self, vehicle_id: str, queue: asyncio.Queue) -> None:
        with self._lock:
            remaining = [(loop, q) for loop, q in self._subscribers.get(vehicle_id, []) if q is not queue]
            if remaining:
                self._subscribers[vehicle_id] = remaining
            else:
                self._subscribers.pop(vehicle_id, None)

    def subscriber_count(self, vehicle_id: str) -> int:
        with self._lock:
            return len(self._subscribers.get(vehicle_id, []))

    def publish(self, vehicle_id: str, event: str, data: Any) -> None:
        """Safe from any thread. A full queue drops the event for that slow client only."""
        message = {"event": event, "data": redact(data)}
        with self._lock:
            targets = list(self._subscribers.get(vehicle_id, []))
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(_offer, queue, message)
            except RuntimeError:
                pass  # that loop is closed; its request is gone


def _offer(queue: asyncio.Queue, message: dict) -> None:
    try:
        queue.put_nowait(message)
    except asyncio.QueueFull:
        pass


async def event_stream(
    events: "Broker",
    vehicle_id: str,
    load_snapshot: Callable[[], Awaitable[dict]],
    is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat: float = HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """Snapshot first, then live events; a comment line keeps idle connections open.

    Subscribing before the snapshot is read means nothing published meanwhile is
    lost (the client de-duplicates samples by time)."""
    queue = events.subscribe(vehicle_id)
    try:
        yield "retry: 3000\n\n"
        yield format_event("snapshot", redact(await load_snapshot()))
        while not await is_disconnected():
            try:
                message = await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            yield format_event(message["event"], message["data"])
    finally:
        events.unsubscribe(vehicle_id, queue)


broker = Broker()
