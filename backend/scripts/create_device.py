"""Register a gateway device and print its token once.

    cd backend && .venv/bin/python scripts/create_device.py --vehicle bmw-m2 --label laptop
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")  # DATABASE_PATH is read when the store is imported

from telemetry.db import telemetry_store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--vehicle", required=True, help="vehicle id, e.g. bmw-m2")
    parser.add_argument("--label", default="", help="a name for this gateway")
    args = parser.parse_args()

    device = telemetry_store.create_device(args.vehicle, args.label)
    print(f"device_id: {device['id']}")
    print(f"token:     {device['token']}")
    print("Save the token now; only its hash is stored.")


if __name__ == "__main__":
    main()
