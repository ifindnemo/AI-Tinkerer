"""Offline VIN hints: manufacturer from the WMI, model year from position 10.

Both are estimates. The year code repeats every 30 years, so the most recent
year not after next year is chosen; the user can correct the profile.
"""

from datetime import datetime, timezone

# Only well-established WMIs; anything else is shown as "Chưa xác định".
WMI_MAKES: dict[str, str] = {
    "WBA": "BMW", "WBS": "BMW M", "WBY": "BMW i",
    "WDB": "Mercedes-Benz", "WDD": "Mercedes-Benz", "W1K": "Mercedes-Benz", "W1N": "Mercedes-Benz",
    "WAU": "Audi", "WVW": "Volkswagen", "WV1": "Volkswagen", "WV2": "Volkswagen", "WP0": "Porsche",
    "WF0": "Ford", "1FA": "Ford", "1FM": "Ford", "1FT": "Ford", "1G1": "Chevrolet",
    "VF1": "Renault", "VF3": "Peugeot", "VF7": "Citroën", "ZFA": "Fiat",
    "YV1": "Volvo", "SAJ": "Jaguar", "SAL": "Land Rover",
    "JHM": "Honda", "JH4": "Acura", "JM1": "Mazda", "JMZ": "Mazda",
    "JN1": "Nissan", "JN8": "Nissan", "KMH": "Hyundai", "KNA": "Kia", "KND": "Kia",
    "JT": "Toyota", "JS": "Suzuki", "KL": "GM Korea",
}
_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789"  # 1980 … 2009, then repeats from 2010


def make_from_vin(vin: str | None) -> str | None:
    if not vin:
        return None
    return WMI_MAKES.get(vin[:3]) or WMI_MAKES.get(vin[:2])


def model_year_from_vin(vin: str | None, today: datetime | None = None) -> int | None:
    if not vin or len(vin) != 17 or vin[9] not in _YEAR_CODES:
        return None
    first = 1980 + _YEAR_CODES.index(vin[9])
    latest_allowed = (today or datetime.now(timezone.utc)).year + 1
    candidates = [first + 30 * n for n in range(4) if first + 30 * n <= latest_allowed]
    return candidates[-1] if candidates else None
