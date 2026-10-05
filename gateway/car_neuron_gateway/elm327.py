"""Minimal ELM327 client. Every command goes through the read-only allowlist."""

import re

from car_neuron_gateway.allowlist import check_command
from car_neuron_gateway.dtc import decode_dtc, parse_dtc_message
from car_neuron_gateway.pids import Pid, decode_value

INIT_COMMANDS = ("ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0")
_NOISE = ("SEARCHING", "BUS INIT", "OK")
_ERRORS = ("NO DATA", "?", "UNABLE", "CAN ERROR", "BUS ERROR", "STOPPED", "ERROR", "BUFFER FULL")
_FRAME = re.compile(r"^([0-9A-F]):([0-9A-F]+)$")
_LENGTH = re.compile(r"^[0-9A-F]{3}$")
_BYTES = re.compile(r"^(?:[0-9A-F]{2})+$")
_VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


def messages(lines: list[str]) -> list[bytes]:
    """Single-frame replies (one per ECU) plus one reassembled ISO-TP message, if any."""
    found: list[bytes] = []
    frames: dict[int, bytes] = {}
    length = None
    for line in lines:
        text = line.replace(" ", "").upper()
        if match := _FRAME.fullmatch(text):
            frames[int(match[1], 16)] = bytes.fromhex(match[2])
        elif _LENGTH.fullmatch(text):
            length = int(text, 16)
        elif _BYTES.fullmatch(text):
            found.append(bytes.fromhex(text))
    if frames:
        data = b"".join(frames[index] for index in sorted(frames))
        found.append(data[:length] if length else data)
    return found


class Elm327:
    def __init__(self, transport, timeout: float = 5.0):
        self.transport = transport
        self.timeout = timeout

    def command(self, raw: str) -> list[str]:
        command = check_command(raw)
        self.transport.write(f"{command}\r".encode("ascii"))
        reply = self.transport.read_until(b">", self.timeout).decode("ascii", "replace")
        lines = [line.strip() for line in reply.replace("\n", "\r").replace(">", "").split("\r")]
        return [
            line for line in lines
            if line and line.replace(" ", "").upper() != command and not line.startswith(_NOISE)
        ]

    def initialize(self) -> None:
        for command in INIT_COMMANDS:
            self.command(command)

    def query(self, raw: str) -> list[bytes]:
        """Replies matching the request (mode + 0x40, and the PID for modes 01/02/09)."""
        lines = self.command(raw)
        if any(line.upper().startswith(_ERRORS) for line in lines):
            return []
        command = raw.replace(" ", "").upper()
        mode = int(command[:2], 16) + 0x40
        found = [m for m in messages(lines) if m and m[0] == mode]
        if command[:2] in ("01", "02", "09") and len(command) >= 4:
            pid = int(command[2:4], 16)
            found = [m for m in found if len(m) > 1 and m[1] == pid]
        return found

    def describe_protocol(self) -> str | None:
        lines = self.command("ATDP")
        return lines[0][:64] if lines else None

    def supported_pids(self) -> set[str]:
        """Mode 01 PIDs as '01XX' strings, following the 0x20/0x40 range bits."""
        supported: set[str] = set()
        base = 0x00
        while base <= 0x40:
            replies = self.query(f"01{base:02X}")
            if not replies:
                break
            bits = 0
            for reply in replies:
                if len(reply) >= 6:
                    bits |= int.from_bytes(reply[2:6], "big")
            for offset in range(1, 33):
                if bits & (1 << (32 - offset)):
                    supported.add(f"01{base + offset:02X}")
            if f"01{base + 0x20:02X}" not in supported:
                break
            base += 0x20
        return supported

    def read_value(self, pid: Pid) -> float | None:
        replies = self.query(pid.command)
        return decode_value(pid, replies[0][2:]) if replies else None

    def status(self) -> tuple[bool, int] | None:
        """(MIL on, number of stored DTCs) from Mode 01 PID 01."""
        replies = self.query("0101")
        if not replies or len(replies[0]) < 3:
            return None
        flags = replies[0][2]
        return bool(flags & 0x80), flags & 0x7F

    def read_dtcs(self, mode: str) -> list[str]:
        codes: list[str] = []
        for reply in self.query(mode):
            codes.extend(code for code in parse_dtc_message(reply) if code not in codes)
        return codes

    def freeze_frame_dtc(self) -> str | None:
        replies = self.query("020200")
        if not replies or len(replies[0]) < 5 or not (replies[0][3] or replies[0][4]):
            return None
        return decode_dtc(replies[0][3], replies[0][4])

    def freeze_frame_value(self, pid: Pid) -> float | None:
        replies = self.query(f"02{pid.pid}00")
        return decode_value(pid, replies[0][3:]) if replies else None

    def read_vin(self) -> str | None:
        """Mode 09 PID 02. CAN returns one message; older buses one line per 4 bytes."""
        replies = sorted(self.query("0902"), key=lambda reply: reply[2] if len(reply) > 2 else 0)
        raw = b"".join(reply[3:] for reply in replies).replace(b"\x00", b"")
        vin = raw.decode("ascii", "ignore").strip().upper()
        return vin if _VIN.fullmatch(vin) else None
