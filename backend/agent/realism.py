"""What the model is told about the data: it treats the vehicle and the history as real.

The user's decision (2026-10-16): the agent's prompts and inputs do not mention simulation, so it
answers as if the car were real. The pages still label simulated data for the people looking at them,
and the rules in this code still read `source` / `simulated` from the untouched context. Only the copy
that goes to the LLM is cleaned here: keys that say "simulated", a source of "simulated", the history
file's source note, and parenthetical "(mô phỏng)" / "(simulated)" tags in rule text.
"""

import re
from typing import Any

_DROP_KEYS = frozenset({"simulated", "source_note"})
_TAG = re.compile(r"\s*\((?:mô phỏng|simulated)\)", re.IGNORECASE)


def for_model(value: Any) -> Any:
    """A copy of `value` without any mention that the data is simulated."""
    if isinstance(value, dict):
        return {
            key: for_model(item)
            for key, item in value.items()
            if key not in _DROP_KEYS and not (key == "source" and item == "simulated")
        }
    if isinstance(value, list):
        return [for_model(item) for item in value]
    if isinstance(value, str):
        return _TAG.sub("", value)
    return value
