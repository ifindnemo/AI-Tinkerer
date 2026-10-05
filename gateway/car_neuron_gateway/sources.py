"""Where readings come from: a real (or fake) ELM327, or the scenario directly."""

from datetime import datetime

from car_neuron_gateway.elm327 import Elm327
from car_neuron_gateway.pids import BY_NAME, PIDS
from car_neuron_gateway.scenarios import FAKE_VIN, PROFILES, Scenario

# Signals worth reading from the freeze frame when the car supports them.
FREEZE_SIGNALS = ("rpm", "speed", "engineLoad", "coolant", "intake", "map", "stft1", "ltft1")


def _dtc_block(at: datetime, mil: bool, stored, pending, freeze) -> dict:
    block = {"readAt": at.isoformat(), "mil": mil, "stored": list(stored), "pending": list(pending)}
    if freeze:
        block["freezeFrame"] = freeze
    return block


class ObdSource:
    """Reads a car through an ELM327. Only PIDs the car reports as supported are queried."""

    def __init__(self, elm: Elm327):
        self.elm = elm
        self.supported: set[str] = set()

    def connect(self) -> dict:
        self.elm.initialize()
        self.supported = self.elm.supported_pids()
        return {
            "vin": self.elm.read_vin(),
            "protocol": self.elm.describe_protocol(),
            "supportedPids": sorted(self.supported),
        }

    def available(self) -> list[str]:
        return [pid.name for pid in PIDS if pid.command in self.supported]

    def read(self, groups: set[str]) -> dict[str, float]:
        values = {}
        for pid in PIDS:
            if pid.group in groups and pid.command in self.supported:
                value = self.elm.read_value(pid)
                if value is not None:
                    values[pid.name] = value
        return values

    def status(self) -> tuple[bool, int] | None:
        return self.elm.status()

    def read_dtc(self, at: datetime) -> dict:
        status = self.elm.status()
        stored = self.elm.read_dtcs("03")
        pending = self.elm.read_dtcs("07")
        freeze = None
        code = self.elm.freeze_frame_dtc() if stored else None
        if code:
            signals = {}
            for name in FREEZE_SIGNALS:
                pid = BY_NAME[name]
                if pid.command in self.supported and (value := self.elm.freeze_frame_value(pid)) is not None:
                    signals[name] = value
            freeze = {"dtc": code, "signals": signals}
        return _dtc_block(at, bool(status and status[0]), stored, pending, freeze)


class SimSource:
    """Scenario values without the ELM protocol (`--source sim`)."""

    def __init__(self, scenario: Scenario, clock, profile: str = "full"):
        self.scenario = scenario
        self.clock = clock
        self.signals = PROFILES[profile]
        self.start = clock.now()

    def _t(self) -> float:
        return self.clock.now() - self.start

    def _round(self, values: dict[str, float]) -> dict[str, float]:
        out = {}
        for name, value in values.items():
            pid = BY_NAME[name]
            if name in self.signals and pid.low <= value <= pid.high:
                out[name] = round(value, 2)
        return out

    def connect(self) -> dict:
        self.start = self.clock.now()
        return {
            "vin": FAKE_VIN,
            "protocol": "Simulated",
            "supportedPids": sorted(BY_NAME[name].command for name in self.signals),
        }

    def available(self) -> list[str]:
        return [pid.name for pid in PIDS if pid.name in self.signals]

    def read(self, groups: set[str]) -> dict[str, float]:
        values = self.scenario.values(self._t())
        return self._round({p.name: values[p.name] for p in PIDS if p.group in groups})

    def status(self) -> tuple[bool, int]:
        state = self.scenario.dtc(self._t())
        return state.mil, len(state.stored)

    def read_dtc(self, at: datetime) -> dict:
        state = self.scenario.dtc(self._t())
        freeze = None
        if state.freeze:
            code, when = state.freeze
            values = self._round(self.scenario.values(when))
            freeze = {"dtc": code, "signals": {k: v for k, v in values.items() if k in FREEZE_SIGNALS}}
        return _dtc_block(at, state.mil, state.stored, state.pending, freeze)
