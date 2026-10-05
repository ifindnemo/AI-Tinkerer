"""Mode 01 PIDs the gateway reads, with SAE J1979 decode formulas.

`encode` is the inverse, used only by the fake ELM327. Signal names and ranges
match backend/telemetry/schemas_v2.py; values outside the range are dropped
here so one glitchy sensor cannot get the whole batch rejected.
"""

from collections.abc import Callable
from dataclasses import dataclass


def _byte(value: float) -> int:
    return max(0, min(255, round(value)))


def _word(value: float) -> bytes:
    raw = max(0, min(0xFFFF, round(value)))
    return bytes([raw >> 8, raw & 0xFF])


@dataclass(frozen=True)
class Pid:
    name: str  # ingest signal name
    pid: str  # Mode 01 PID, two hex digits
    size: int  # data bytes
    group: str  # fast (1 s) | slow (5 s) | rare (30 s)
    low: float
    high: float
    decode: Callable[[bytes], float]
    encode: Callable[[float], bytes]

    @property
    def command(self) -> str:
        return f"01{self.pid}"


def _percent(name: str, pid: str, group: str) -> Pid:
    return Pid(name, pid, 1, group, 0, 100, lambda d: d[0] * 100 / 255, lambda v: bytes([_byte(v * 255 / 100)]))


def _temperature(name: str, pid: str, group: str, high: float) -> Pid:
    return Pid(name, pid, 1, group, -40, high, lambda d: d[0] - 40, lambda v: bytes([_byte(v + 40)]))


def _trim(name: str, pid: str) -> Pid:
    return Pid(name, pid, 1, "slow", -100, 100, lambda d: (d[0] - 128) * 100 / 128, lambda v: bytes([_byte(v * 128 / 100 + 128)]))


PIDS: tuple[Pid, ...] = (
    _percent("engineLoad", "04", "fast"),
    _temperature("coolant", "05", "fast", 180),
    _trim("stft1", "06"),
    _trim("ltft1", "07"),
    Pid("map", "0B", 1, "slow", 0, 255, lambda d: float(d[0]), lambda v: bytes([_byte(v)])),
    Pid("rpm", "0C", 2, "fast", 0, 12_000, lambda d: (256 * d[0] + d[1]) / 4, lambda v: _word(v * 4)),
    Pid("speed", "0D", 1, "fast", 0, 300, lambda d: float(d[0]), lambda v: bytes([_byte(v)])),
    _temperature("intake", "0F", "slow", 100),
    Pid("maf", "10", 2, "slow", 0, 700, lambda d: (256 * d[0] + d[1]) / 100, lambda v: _word(v * 100)),
    _percent("tps", "11", "slow"),
    _percent("fuel", "2F", "rare"),
    Pid("battery", "42", 2, "slow", 0, 30, lambda d: (256 * d[0] + d[1]) / 1000, lambda v: _word(v * 1000)),
    _temperature("ambient", "46", "rare", 80),
    _temperature("oil", "5C", "slow", 220),
)
BY_NAME = {pid.name: pid for pid in PIDS}
BY_PID = {pid.pid: pid for pid in PIDS}


def decode_value(pid: Pid, data: bytes) -> float | None:
    """Decoded, rounded value, or None if the reply is short or out of range."""
    if len(data) < pid.size:
        return None
    value = round(pid.decode(data[: pid.size]), 2)
    return value if pid.low <= value <= pid.high else None
