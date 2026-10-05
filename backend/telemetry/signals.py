"""Signal metadata shared by the profile, the detector and the agent context.

`agent_key` keeps the snake_case names the existing guardrails and prompt read
(`coolant_temp_c`, `battery_voltage`, …); camelCase would silently bypass them.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Signal:
    name: str
    pid: str  # Mode 01 command, as in supportedPids
    label: str
    unit: str
    agent_key: str
    digits: int = 1


SIGNALS: tuple[Signal, ...] = (
    Signal("rpm", "010C", "Vòng tua", "rpm", "rpm", 0),
    Signal("speed", "010D", "Tốc độ", "km/h", "speed", 0),
    Signal("engineLoad", "0104", "Tải động cơ", "%", "engine_load"),
    Signal("coolant", "0105", "Nước làm mát", "°C", "coolant_temp_c"),
    Signal("intake", "010F", "Nhiệt độ khí nạp", "°C", "intake_air_temp_c"),
    Signal("map", "010B", "Áp suất đường nạp (MAP)", "kPa", "map_kpa", 0),
    Signal("maf", "0110", "Lưu lượng khí nạp (MAF)", "g/s", "maf_g_s"),
    Signal("tps", "0111", "Vị trí bướm ga", "%", "tps"),
    Signal("stft1", "0106", "Fuel trim ngắn hạn B1", "%", "short_term_fuel_trim_pct"),
    Signal("ltft1", "0107", "Fuel trim dài hạn B1", "%", "long_term_fuel_trim_pct"),
    Signal("battery", "0142", "Điện áp hệ thống", "V", "battery_voltage", 2),
    Signal("oil", "015C", "Nhiệt độ dầu", "°C", "oil_temp_c"),
    Signal("fuel", "012F", "Mức nhiên liệu", "%", "fuel_percent"),
    Signal("ambient", "0146", "Nhiệt độ ngoài trời (cảm biến xe)", "°C", "ambient_air_temp_c"),
)
BY_NAME = {signal.name: signal for signal in SIGNALS}
BY_PID = {signal.pid: signal for signal in SIGNALS}


def split_supported(supported_pids: list[str]) -> tuple[list[str], list[str]]:
    """(signals the car reports, signals it does not), in display order."""
    pids = set(supported_pids)
    supported = [s.name for s in SIGNALS if s.pid in pids]
    missing = [s.name for s in SIGNALS if s.pid not in pids]
    return supported, missing


BY_AGENT_KEY = {signal.agent_key: signal for signal in SIGNALS}


def format_agent_value(agent_key: str, value: float) -> str:
    """'Vòng tua 2169 rpm' for evidence text."""
    signal = BY_AGENT_KEY.get(agent_key)
    if signal is None:
        return f"{agent_key} {value}"
    return f"{signal.label} {value:.{signal.digits}f} {signal.unit}"


def to_agent_record(signals: dict[str, float]) -> dict[str, float]:
    return {BY_NAME[name].agent_key: value for name, value in signals.items() if name in BY_NAME}
