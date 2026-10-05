"""Vehicle position: a USB GPS speaking NMEA, or a fixed point labelled as such."""

import threading
import time
from functools import reduce


class FixedLocation:
    def __init__(self, lat: float, lon: float):
        self.point = {"lat": lat, "lon": lon, "fixed": True}

    def location(self) -> dict:
        return dict(self.point)


def _degrees(value: str, hemisphere: str, width: int) -> float:
    degrees = int(value[:width]) + float(value[width:]) / 60
    return round(-degrees if hemisphere in ("S", "W") else degrees, 6)


def parse_nmea(sentence: str) -> dict | None:
    """Position from a valid RMC (status A) or GGA (fix > 0) sentence, else None."""
    sentence = sentence.strip()
    if not sentence.startswith("$") or "*" not in sentence:
        return None
    body, checksum = sentence[1:].rsplit("*", 1)
    if f"{reduce(lambda acc, ch: acc ^ ord(ch), body, 0):02X}" != checksum.upper():
        return None
    fields = body.split(",")
    try:
        if fields[0].endswith("RMC") and fields[2] == "A":
            return {"lat": _degrees(fields[3], fields[4], 2), "lon": _degrees(fields[5], fields[6], 3)}
        if fields[0].endswith("GGA") and fields[6] not in ("", "0"):
            return {"lat": _degrees(fields[2], fields[3], 2), "lon": _degrees(fields[4], fields[5], 3)}
    except (IndexError, ValueError):
        return None
    return None


class NmeaGps:
    """Reads a serial GPS in the background; positions older than 5 s are not used."""

    def __init__(self, port: str, baudrate: int = 9600, max_age: float = 5.0):
        import serial  # pyserial

        self.serial = serial.serial_for_url(port, baudrate=baudrate, timeout=1)
        self.max_age = max_age
        self._fix: tuple[float, dict] | None = None
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            line = self.serial.readline().decode("ascii", "ignore")
            if point := parse_nmea(line):
                self._fix = (time.monotonic(), point)

    def location(self) -> dict | None:
        if self._fix and time.monotonic() - self._fix[0] <= self.max_age:
            return dict(self._fix[1])
        return None
