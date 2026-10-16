"""Car Neuron gateway.

    export CAR_NEURON_DEVICE_ID=dev_...  CAR_NEURON_TOKEN=cnd_...   # from backend/scripts/create_device.py
    python -m car_neuron_gateway --source obd --port /dev/ttyUSB0 --fixed-location 16.0878,108.221
    python -m car_neuron_gateway --source fake-elm --scenario overheat
    python -m car_neuron_gateway --source sim --scenario misfire --fast --duration 120 --dry-run
"""

import argparse
import json
import os
import sys
from pathlib import Path

from car_neuron_gateway.clock import FakeClock, RealClock
from car_neuron_gateway.elm327 import Elm327
from car_neuron_gateway.fake_elm import FakeElm327
from car_neuron_gateway.gps import FixedLocation, NmeaGps
from car_neuron_gateway.runner import run
from car_neuron_gateway.scenarios import PROFILES, SCENARIOS
from car_neuron_gateway.sources import ObdSource, SimSource
from car_neuron_gateway.transport import LoopbackTransport, SerialTransport
from car_neuron_gateway.uploader import Uploader


def _location(args):
    if args.gps_port:
        return NmeaGps(args.gps_port)
    if args.fixed_location:
        lat, lon = (float(part) for part in args.fixed_location.split(","))
        return FixedLocation(lat, lon)
    print("Cảnh báo: không có GPS; thời tiết và tìm garage sẽ không chạy.", file=sys.stderr)
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Car Neuron OBD gateway")
    parser.add_argument("--source", choices=["obd", "fake-elm", "sim"], default="obd")
    parser.add_argument("--port", help="adapter: /dev/ttyUSB0, /dev/rfcomm0 or socket://host:port")
    parser.add_argument("--baud", type=int, default=38400)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="normal")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="full")
    parser.add_argument("--server", default=os.getenv("CAR_NEURON_SERVER", "http://127.0.0.1:8000"))
    parser.add_argument("--ingest-path", default="/api/ingest/batch")
    parser.add_argument("--gps-port", help="NMEA GPS serial port")
    parser.add_argument("--fixed-location", help="lat,lon used when there is no GPS (labelled fixed)")
    parser.add_argument("--duration", type=int, help="seconds to run (default: until Ctrl+C)")
    parser.add_argument("--batch-size", type=int, default=5, help="samples per batch (≈ seconds of delay on the dashboard)")
    parser.add_argument("--fast", action="store_true", help="simulated time, no waiting (fake-elm/sim)")
    parser.add_argument("--dry-run", action="store_true", help="print batches instead of sending")
    parser.add_argument("--spool", default=str(Path.home() / ".car-neuron" / "spool"))
    args = parser.parse_args(argv)

    if args.source == "obd" and not args.port:
        parser.error("--port is required for --source obd")
    if not 1 <= args.batch_size <= 60:
        parser.error("--batch-size must be between 1 and 60")
    if args.fast and args.source == "obd":
        parser.error("--fast only works with fake-elm or sim")
    device_id = os.getenv("CAR_NEURON_DEVICE_ID", "dev_dry_run" if args.dry_run else "")
    token = os.getenv("CAR_NEURON_TOKEN", "")
    if not args.dry_run and not (device_id and token):
        parser.error("set CAR_NEURON_DEVICE_ID and CAR_NEURON_TOKEN (backend/scripts/create_device.py)")

    clock = FakeClock() if args.fast else RealClock()
    if args.source == "obd":
        source = ObdSource(Elm327(SerialTransport(args.port, args.baud)))
    elif args.source == "fake-elm":
        fake = FakeElm327(SCENARIOS[args.scenario](), clock, args.profile)
        source = ObdSource(Elm327(LoopbackTransport(fake)))
    else:
        source = SimSource(SCENARIOS[args.scenario](), clock, args.profile)

    if args.dry_run:
        def send(batch: dict) -> str:
            print(json.dumps(batch, ensure_ascii=False))
            return "printed"
        log = lambda message: print(message, file=sys.stderr)  # noqa: E731
    else:
        uploader = Uploader(args.server, token, Path(args.spool), args.ingest_path)
        send = uploader.send
        log = lambda message: print(message, flush=True)  # noqa: E731  (visible under nohup)

    try:
        outcomes = run(
            source, send, clock, device_id, args.source, _location(args), args.duration, log, args.batch_size
        )
    except KeyboardInterrupt:
        return 0
    log(f"Xong: {dict(outcomes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
