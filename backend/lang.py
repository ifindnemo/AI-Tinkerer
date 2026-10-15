"""The language the agent writes and speaks in. Vietnamese is the default everywhere.

The browser sends `lang` ("vi" or "en") with each blackbox batch and each driver batch. It only
chooses the wording: severity, mandatory steps and the safety filters are the same in both.
"""

from typing import Any, Literal

Lang = Literal["vi", "en"]
DEFAULT: Lang = "vi"


def normalize(value: Any) -> Lang:
    """Anything that is not clearly English is Vietnamese, so a bad value never breaks a request."""
    return "en" if str(value or "").strip().lower().startswith("en") else "vi"


def pick(lang: str, vi: str, en: str) -> str:
    return en if lang == "en" else vi


def number(value: float, lang: str, digits: int = 1) -> str:
    """Decimal comma in Vietnamese, point in English."""
    text = f"{value:.{digits}f}"
    return text.replace(".", ",") if lang != "en" else text
