"""A fake ELM327 that speaks the adapter's text protocol, for coding without a car.

In-process it plugs into `LoopbackTransport`. As a script it opens a pseudo-terminal
so the real serial code path can be exercised:

    python -m car_neuron_gateway.fake_elm --scenario overheat
    # prints /dev/pts/N; then: python -m car_neuron_gateway --source obd --port /dev/pts/N
"""

import argparse
import os
import re
import threading
import tty

from car_neuron_gateway.clock import RealClock
from car_neuron_gateway.dtc import encode_dtc
from car_neuron_gateway.pids import BY_NAME, BY_PID
from car_neuron_gateway.scenarios import FAKE_VIN, PROFILES, SCENARIOS, Scenario

VERSION = "ELM327 v1.5"
_HEX = re.compile(r"^(?:[0-9A-F]{2})+$")


class FakeElm327:
    def __init__(self, scenario: Scenario, clock=None, profile: str = "full", vin: str | None = FAKE_VIN):
        self.scenario = scenario
        self.clock = clock or RealClock()
        self.start = self.clock.now()
        self.signals = PROFILES[profile]
        self.vin = vin
        self.received: list[str] = []
        self._reset()

    def _reset(self) -> None:
        self.echo, self.spaces = True, True

    @property
    def elapsed(self) -> float:
        return self.clock.now() - self.start

    @property
    def clear_requests(self) -> int:
        """How often Mode 04 (clear DTCs) reached the car. Must stay 0."""
        return sum(command.startswith("04") for command in self.received)

    def handle(self, raw: str) -> str:
        command = raw.strip().upper().replace(" ", "")
        self.received.append(command)
        body = self._respond(command)
        echo = f"{raw.strip()}\r" if self.echo else ""
        return f"{echo}{body}\r\r>"

    # ---- formatting -------------------------------------------------------
    def _hex(self, data: bytes) -> str:
        return (" " if self.spaces else "").join(f"{b:02X}" for b in data)

    def _frames(self, data: bytes) -> str:
        """Single frame up to 7 bytes; otherwise ISO-TP lines as the ELM prints them (ATH0)."""
        if len(data) <= 7:
            return self._hex(data)
        lines = [f"{len(data):03X}", f"0: {self._hex(data[:6])}"]
        for index, start in enumerate(range(6, len(data), 7), start=1):
            lines.append(f"{index % 16:X}: {self._hex(data[start:start + 7])}")
        return "\r".join(lines)

    def _bitmap(self, base: int) -> bytes:
        supported = {int(BY_NAME[name].pid, 16) for name in self.signals} | {0x01}
        bits = 0
        for pid in range(base + 1, base + 33):
            if pid in supported or (pid == base + 0x20 and any(p > pid for p in supported)):
                bits |= 1 << (32 - (pid - base))
        return bits.to_bytes(4, "big")

    # ---- commands ---------------------------------------------------------
    def _respond(self, command: str) -> str:
        if command.startswith("AT"):
            return self._at(command)
        if not _HEX.fullmatch(command):
            return "?"
        mode, pid = command[:2], command[2:4]
        t = self.elapsed
        if mode == "01":
            return self._mode01(pid, t)
        if mode == "02":
            return self._mode02(pid, t)
        if mode in ("03", "07"):
            state = self.scenario.dtc(t)
            codes = state.stored if mode == "03" else state.pending
            data = bytes([0x43 if mode == "03" else 0x47, len(codes)])
            return self._frames(data + b"".join(encode_dtc(code) for code in codes))
        if mode == "09" and pid == "00":
            return self._hex(bytes([0x49, 0x00, 0x40, 0x00, 0x00, 0x00]))  # supports 0902
        if mode == "09" and pid == "02" and self.vin:
            return self._frames(bytes([0x49, 0x02, 0x01]) + self.vin.encode("ascii"))
        if mode == "04":
            return "44"  # a real car would clear its codes; the gateway must never get here
        return "NO DATA"

    def _mode01(self, pid: str, t: float) -> str:
        if pid in ("00", "20", "40"):
            return self._hex(bytes([0x41, int(pid, 16)]) + self._bitmap(int(pid, 16)))
        if pid == "01":
            state = self.scenario.dtc(t)
            status = (0x80 if state.mil else 0) | min(len(state.stored), 0x7F)
            return self._hex(bytes([0x41, 0x01, status, 0x07, 0x65, 0x00]))
        info = BY_PID.get(pid)
        if info is None or info.name not in self.signals:
            return "NO DATA"
        value = self.scenario.values(t)[info.name]
        return self._hex(bytes([0x41, int(pid, 16)]) + info.encode(value))

    def _mode02(self, pid: str, t: float) -> str:
        freeze = self.scenario.dtc(t).freeze
        if freeze is None:
            return "NO DATA"
        code, at = freeze
        if pid == "02":
            return self._hex(bytes([0x42, 0x02, 0x00]) + encode_dtc(code))
        info = BY_PID.get(pid)
        if info is None or info.name not in self.signals:
            return "NO DATA"
        value = self.scenario.values(at)[info.name]
        return self._hex(bytes([0x42, int(pid, 16), 0x00]) + info.encode(value))

    def _at(self, command: str) -> str:
        if command in ("ATZ", "ATWS"):
            self._reset()
            return f"\r{VERSION}"
        if command == "ATI":
            return VERSION
        if command in ("ATE0", "ATE1"):
            self.echo = command == "ATE1"
            return "OK"
        if command in ("ATS0", "ATS1"):
            self.spaces = command == "ATS1"
            return "OK"
        if command == "ATDPN":
            return "A6"
        if command == "ATDP":
            return "AUTO, ISO 15765-4 (CAN 11/500)"
        if command == "ATRV":
            return f"{self.scenario.values(self.elapsed)['battery']:.1f}V"
        if re.fullmatch(r"AT(D|L[01]|H[01]|SP[0-9A-C]|AT[0-2]|ST[0-9A-F]{2})", command):
            return "OK"
        return "?"


def serve_pty(device: FakeElm327) -> str:
    """Serve the fake adapter on a pseudo-terminal and return its path."""
    master, slave = os.openpty()
    tty.setraw(slave)

    def loop() -> None:
        pending = b""
        while True:
            try:
                chunk = os.read(master, 256)
            except OSError:
                return
            pending += chunk
            while b"\r" in pending:
                line, pending = pending.split(b"\r", 1)
                if line.strip():
                    os.write(master, device.handle(line.decode("ascii", "replace")).encode())

    threading.Thread(target=loop, daemon=True).start()
    return os.ttyname(slave)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fake ELM327 on a pseudo-terminal")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="normal")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="full")
    args = parser.parse_args()
    path = serve_pty(FakeElm327(SCENARIOS[args.scenario](), profile=args.profile))
    print(path, flush=True)
    threading.Event().wait()


if __name__ == "__main__":
    main()
