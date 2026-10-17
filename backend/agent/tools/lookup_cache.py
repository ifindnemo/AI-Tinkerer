"""Short-lived cache for the agent's slow outside lookups (weather ~0.9 s, garages ~0.5 s).

The car does not move between two analyses a few seconds apart and the weather does not change in minutes, so the
second analysis of a drive should not pay for them again. Only a successful result is kept, for TOOL_CACHE_SECONDS
(default 600, 0 turns the cache off); an error is never cached, so a failed lookup is retried on the next run."""
import copy
import os
import threading
import time
from typing import Any, Callable

_lock = threading.Lock()
_entries: dict[tuple, tuple[float, Any]] = {}
_MAX_ENTRIES = 64


def ttl_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("TOOL_CACHE_SECONDS", "600")))
    except ValueError:
        return 600.0


def place(latitude: float, longitude: float) -> tuple[float, float]:
    """About 110 m: the same spot for the cache, however the GPS jitters."""
    return round(float(latitude), 3), round(float(longitude), 3)


def cached(key: tuple, function: Callable[[], Any]) -> Any:
    """`function()` or, within the TTL, what it returned last time for `key`. Exceptions pass through uncached."""
    ttl = ttl_seconds()
    if ttl <= 0:
        return function()
    now = time.monotonic()
    with _lock:
        hit = _entries.get(key)
        if hit and now - hit[0] < ttl:
            return copy.deepcopy(hit[1])
    result = function()
    if isinstance(result, dict) and (result.get("success") is False or result.get("error")):
        return result
    with _lock:
        if len(_entries) >= _MAX_ENTRIES:
            _entries.pop(min(_entries, key=lambda k: _entries[k][0]))
        _entries[key] = (time.monotonic(), copy.deepcopy(result))
    return result


def clear() -> None:
    with _lock:
        _entries.clear()
