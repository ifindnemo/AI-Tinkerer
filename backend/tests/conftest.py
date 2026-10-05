"""Tests must never touch backend/vehicle_guardian.db or call external services.

This runs before any test module imports `store`, so the module-level stores
point at a throw-away file.
"""

import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="car-neuron-tests-"), "test.db")
os.environ["EXTERNAL_TOOLS"] = "off"
