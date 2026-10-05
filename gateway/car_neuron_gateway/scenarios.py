"""Deterministic car behaviour for the simulator and the fake ELM327.

`t` is seconds since the engine started. Everything produced here is simulated
and reaches the backend labelled as such (source fake-elm or sim).
"""

import math
from dataclasses import dataclass, field

from car_neuron_gateway.pids import BY_NAME


@dataclass
class DtcState:
    mil: bool = False
    stored: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)
    # (code, seconds) of the fault that triggered the freeze frame
    freeze: tuple[str, float] | None = None


def _idle(t: float) -> dict[str, float]:
    wobble, drift = math.sin(t * 0.7), math.sin(t * 0.13)
    coolant = 70 + 20 * min(1.0, t / 120) + 0.3 * drift
    return {
        "rpm": 800 + 12 * wobble,
        "speed": 0,
        "engineLoad": 21 + 0.6 * wobble,
        "coolant": coolant,
        "intake": 34 + 0.5 * drift,
        "map": 32 + 0.4 * wobble,
        "maf": 3.1 + 0.1 * wobble,
        "tps": 14.1,
        "stft1": 1.5 * wobble,
        "ltft1": -1.6,
        "battery": 14.1 + 0.03 * drift,
        "oil": coolant + 6,
        "fuel": 62,
        "ambient": 33,
    }


def _city(t: float) -> dict[str, float]:
    values = _idle(t)
    speed = max(0.0, 25 + 25 * math.sin(t * 0.05))
    values.update(
        speed=speed,
        rpm=800 + speed * 35 + 15 * math.sin(t * 0.9),
        engineLoad=22 + speed * 0.6,
        map=30 + speed * 0.5,
        maf=3 + speed * 0.25,
        tps=14 + speed * 0.4,
        coolant=min(91.0, values["coolant"]) + 1.5 * math.sin(t * 0.02),
    )
    values["oil"] = values["coolant"] + 6
    return values


class Scenario:
    name = "normal"
    description = "Nổ máy đứng yên, máy ấm dần lên khoảng 90°C"

    def values(self, t: float) -> dict[str, float]:
        return _idle(t)

    def dtc(self, t: float) -> DtcState:
        return DtcState()


class City(Scenario):
    name = "city"
    description = "Chạy phố 0–50 km/h, mọi chỉ số bình thường"

    def values(self, t: float) -> dict[str, float]:
        return _city(t)


class Overheat(Scenario):
    """Cruising at a flat load while coolant climbs 92 → 122°C (105°C at ~95 s, 120°C at ~170 s)."""

    name = "overheat"
    description = "Quá nhiệt: tải không đổi nhưng nhiệt nước làm mát tăng 92 → 122°C"
    RAMP_START, RAMP_END, FROM, TO = 30.0, 180.0, 92.0, 122.0

    def coolant(self, t: float) -> float:
        if t <= self.RAMP_START:
            return self.FROM
        if t >= self.RAMP_END:
            return self.TO + 0.3 * math.sin(t)
        share = (t - self.RAMP_START) / (self.RAMP_END - self.RAMP_START)
        return self.FROM + (self.TO - self.FROM) * share

    def time_at(self, coolant: float) -> float:
        share = (coolant - self.FROM) / (self.TO - self.FROM)
        return self.RAMP_START + share * (self.RAMP_END - self.RAMP_START)

    def values(self, t: float) -> dict[str, float]:
        values = _idle(t)
        drive = math.sin(t * 0.3)
        coolant = self.coolant(t)
        values.update(
            speed=60 + 1.5 * drive,
            rpm=2200 + 40 * drive,
            engineLoad=36 + 0.8 * math.sin(t * 0.4),
            map=46 + 0.8 * drive,
            maf=14 + 0.3 * drive,
            tps=17 + 0.5 * drive,
            coolant=coolant,
            oil=coolant + 7,
            intake=38 + min(t, 42) * 0.1,
        )
        return values

    def dtc(self, t: float) -> DtcState:
        stored_at = self.time_at(118)
        if t >= stored_at:
            return DtcState(mil=True, stored=["P0217"], freeze=("P0217", stored_at))
        if t >= self.time_at(115):
            return DtcState(pending=["P0217"])
        return DtcState()


class Misfire(Scenario):
    name = "misfire"
    description = "Bỏ máy xy-lanh 1: vòng tua cầm chừng rung, P0301"

    def values(self, t: float) -> dict[str, float]:
        values = _idle(t)
        coolant = 90 + 0.3 * math.sin(t * 0.13)  # engine already warm
        values.update(
            rpm=780 + 90 * math.sin(t * 2.3) * math.sin(t * 0.9),
            stft1=6 + 2 * math.sin(t * 0.5),
            coolant=coolant,
            oil=coolant + 6,
        )
        return values

    def dtc(self, t: float) -> DtcState:
        if t >= 40:
            return DtcState(mil=True, stored=["P0301"], freeze=("P0301", 40.0))
        if t >= 20:
            return DtcState(pending=["P0301"])
        return DtcState()


class Lean(Scenario):
    name = "lean"
    description = "Hỗn hợp nghèo: fuel trim dương cao, P0171"

    def values(self, t: float) -> dict[str, float]:
        values = _city(t)
        if t >= 30:
            values.update(stft1=18 + 2 * math.sin(t * 0.4), ltft1=12)
        return values

    def dtc(self, t: float) -> DtcState:
        if t >= 60:
            return DtcState(mil=True, stored=["P0171"], freeze=("P0171", 60.0))
        if t >= 45:
            return DtcState(pending=["P0171"])
        return DtcState()


SCENARIOS: dict[str, type[Scenario]] = {
    cls.name: cls for cls in (Scenario, City, Overheat, Misfire, Lean)
}

# Signals each fake car exposes. "minimal" checks that missing sensors are hidden.
PROFILES: dict[str, frozenset[str]] = {
    "full": frozenset(BY_NAME),
    "minimal": frozenset(BY_NAME) - {"oil", "fuel", "ambient", "maf"},
}
FAKE_VIN = "CNXFAKEELM0000001"  # deliberately not a real manufacturer code
