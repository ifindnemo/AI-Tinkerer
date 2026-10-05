"""Read-only guard: every command sent to the ELM327 must pass `check_command`.

Car Neuron only reads the car. Mode 04 (clear DTCs and freeze frame) and any
write or UDS service (e.g. 0x14 clear, 0x2E write, 0x31 routine) are rejected,
as are AT commands that change adapter memory (ATPP…).
"""

import re


# Mode 01 live data, 02 freeze frame, 03 stored DTCs, 07 pending DTCs, 09 vehicle info (VIN).
ALLOWED_MODES = frozenset({"01", "02", "03", "07", "09"})

# Adapter setup/status commands only.
ALLOWED_AT = re.compile(
    r"^AT(Z|WS|D|I|RV|DPN?|E[01]|L[01]|S[01]|H[01]|SP[0-9A-C]|AT[0-2]|ST[0-9A-F]{2})$"
)
_HEX = re.compile(r"^(?:[0-9A-F]{2})+$")


class ForbiddenCommand(ValueError):
    pass


def check_command(raw: str) -> str:
    """Return the normalized command, or raise ForbiddenCommand."""
    if any(ch in raw for ch in "\r\n"):
        raise ForbiddenCommand("one command per call")
    command = raw.replace(" ", "").upper()
    if command.startswith("AT"):
        if ALLOWED_AT.fullmatch(command):
            return command
        raise ForbiddenCommand(f"AT command not allowed: {command}")
    if not _HEX.fullmatch(command):
        raise ForbiddenCommand(f"not an OBD command: {raw!r}")
    mode = command[:2]
    if mode == "04":
        raise ForbiddenCommand("Mode 04 (xóa mã lỗi) bị chặn: Car Neuron chỉ đọc xe")
    if mode not in ALLOWED_MODES:
        raise ForbiddenCommand(f"mode {mode} is not a read mode")
    return command
