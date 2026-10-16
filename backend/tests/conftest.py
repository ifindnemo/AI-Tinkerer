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
os.environ["BLAZE_VOICE_PREFERENCE_FILE"] = os.path.join(os.path.dirname(os.environ["DATABASE_PATH"]), "voice_preference.json")
