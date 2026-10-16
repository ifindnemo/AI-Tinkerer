"""Tests must never touch backend/vehicle_guardian.db or call external services.

This runs before any test module imports `store`, so the module-level stores
point at a throw-away file.
"""

import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="car-neuron-tests-"), "test.db")
os.environ["EXTERNAL_TOOLS"] = "off"
# Never speak through the real Blaze account from tests. load_dotenv() does not override variables
# that are already set, so these empty values win over backend/.env; tests that need voice set fakes.
os.environ["BLAZE_API_TOKEN"] = ""
os.environ["BLAZE_SPEAKER_ID"] = ""
os.environ["BLAZE_SPEAKER_ID_EN"] = ""
# English has a built-in default voice (Helen), so a test that sets a fake token could still reach Blaze:
# point every Blaze call at a closed local port instead.
os.environ["BLAZE_BASE_URL"] = "http://127.0.0.1:9"
os.environ["BLAZE_VOICE_PREFERENCE_FILE"] = os.path.join(os.path.dirname(os.environ["DATABASE_PATH"]), "voice_preference.json")
