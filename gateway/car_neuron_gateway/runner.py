"""The 1 Hz loop: read → trip → batch → upload."""

from collections import Counter
from collections.abc import Callable

from car_neuron_gateway.batcher import Batcher
from car_neuron_gateway.clock import utc
from car_neuron_gateway.trip import TripTracker

STATUS_EVERY = 5  # s: MIL and DTC count (0101) along with the slow PIDs
DTC_EVERY = 30  # s: full DTC read even when the status did not change


def groups_for(tick: int) -> set[str]:
    groups = {"fast"}
    if tick % 5 == 0:
        groups.add("slow")
    if tick % 30 == 0:
        groups.add("rare")
    return groups


def run(
    source,
    send: Callable[[dict], str],
    clock,
    device_id: str,
    source_name: str,
    location=None,
    duration: int | None = None,
    log: Callable[[str], None] = print,
    batch_size: int = 5,
) -> Counter:
    """Run for `duration` seconds (forever if None). Returns upload outcomes."""
    vehicle = source.connect()
    log(f"Đã nhận xe: VIN {vehicle['vin'] or 'không đọc được'}, {len(vehicle['supportedPids'])} PID")
    batcher = Batcher(device_id, source_name, vehicle, size=batch_size)
    trips = TripTracker()
    outcomes: Counter = Counter()
    last_status = None

    def deliver(batches: list[dict]) -> None:
        for batch in batches:
            result = send(batch)
            outcomes[result] += 1
            log(f"lô {batch['tripId']}#{batch['seq']}: {len(batch['records'])} mẫu, {result}")

    start = clock.now()
    tick = 0
    try:
        while duration is None or tick < duration:
            signals = source.read(groups_for(tick))
            at = utc(clock.now())
            trip_id = trips.update(at, signals.get("rpm"))
            if trip_id is None:
                deliver(batcher.flush())
            else:
                dtc = None
                if tick % STATUS_EVERY == 0:
                    status = source.status()
                    if status != last_status or tick % DTC_EVERY == 0:
                        dtc = source.read_dtc(at)
                        last_status = status
                record = {"capturedAt": at.isoformat(), "signals": signals}
                if location and (point := location.location()):
                    record["location"] = point
                deliver(batcher.add(trip_id, at, record, dtc))
            tick += 1
            clock.sleep_until(start + tick)
    finally:
        deliver(batcher.flush())
    return outcomes
