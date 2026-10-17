"""Tests must never touch backend/vehicle_guardian.db or call external services.

This runs before any test module imports `store`, so the module-level stores
point at a throw-away file.
"""

import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="car-neuron-tests-"), "test.db")
os.environ["EXTERNAL_TOOLS"] = "off"
# The older voice tests pin the brief wording; the full wording and the repeat window have tests of their own.
os.environ["ALERT_VOICE_DETAIL"] = "brief"
os.environ["ALERT_REPEAT_SECONDS"] = "45"
os.environ["TOOL_CACHE_SECONDS"] = "0"  # tests stub the lookups and count their calls; the cache has its own tests
# Same for the LLM: a key in backend/.env must never make a test reach a real provider.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["LLM_REASONING_EFFORT"] = ""  # load_dotenv does not override a set (even empty) variable
# Never speak through the real Blaze account from tests. load_dotenv() does not override variables
# that are already set, so these empty values win over backend/.env; tests that need voice set fakes.
os.environ["BLAZE_API_TOKEN"] = ""
os.environ["BLAZE_SPEAKER_ID"] = ""
os.environ["BLAZE_SPEAKER_ID_EN"] = ""
os.environ["BLAZE_AUDIO_SPEED_EN"] = ""  # a speed set in backend/.env must not change what the tests expect
# English has a built-in default voice (Helen), so a test that sets a fake token could still reach Blaze:
# point every Blaze call at a closed local port instead.
os.environ["BLAZE_BASE_URL"] = "http://127.0.0.1:9"
os.environ["BLAZE_VOICE_PREFERENCE_FILE"] = os.path.join(os.path.dirname(os.environ["DATABASE_PATH"]), "voice_preference.json")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_alert_history_between_tests():
    """What was spoken (and when) is process memory; one test's alert must not silence the next one's."""
    import voice

    voice.clear_all_alert_history()
    yield
    voice.clear_all_alert_history()

