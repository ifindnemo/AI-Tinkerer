"""Two-byte DTC encoding (SAE J2012) and Mode 03/07 reply parsing."""

LETTERS = "PCBU"


def decode_dtc(first: int, second: int) -> str:
    return f"{LETTERS[first >> 6]}{(first >> 4) & 0x3}{first & 0xF:X}{second:02X}"


def encode_dtc(code: str) -> bytes:
    letter = LETTERS.index(code[0])
    return bytes([(letter << 6) | (int(code[1]) << 4) | int(code[2], 16), int(code[3:5], 16)])


def parse_dtc_message(message: bytes) -> list[str]:
    """Codes from one 43/47 reply. CAN replies carry a count byte (odd payload length);
    older protocols pad to three codes with zeros."""
    payload = message[1:]
    if len(payload) % 2 == 1:
        count = payload[0]
        payload = payload[1 : 1 + 2 * count]
    return [
        decode_dtc(payload[i], payload[i + 1])
        for i in range(0, len(payload) - 1, 2)
        if payload[i] or payload[i + 1]
    ]
