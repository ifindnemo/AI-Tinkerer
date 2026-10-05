import asyncio
import threading

from telemetry.stream import GENERIC_ERROR, Broker, event_stream, redact


def test_redact_hides_keys_and_tool_errors() -> None:
    payload = {
        "url": "https://us1.locationiq.com/v1/nearby?key=pk.abc123&lat=1",
        "note": "used sk-proj-ABCDEFGHIJKLMNOPQRST",
        "result": {"error": "401 for https://x?access_token=secret"},
        "ok": {"error": None},
    }
    clean = redact(payload)
    assert "pk.abc123" not in clean["url"] and "key=[redacted]" in clean["url"]
    assert "sk-proj" not in clean["note"]
    assert clean["result"]["error"] == GENERIC_ERROR
    assert clean["ok"]["error"] is None


def test_events_published_from_another_thread_reach_the_subscriber() -> None:
    async def scenario():
        broker = Broker()
        queue = broker.subscribe("car")
        thread = threading.Thread(target=broker.publish, args=("car", "samples", {"n": 1}))
        thread.start()
        thread.join()
        message = await asyncio.wait_for(queue.get(), timeout=1)
        broker.unsubscribe("car", queue)
        return message, broker.subscriber_count("car")

    message, remaining = asyncio.run(scenario())
    assert message == {"event": "samples", "data": {"n": 1}} and remaining == 0


def test_stream_sends_snapshot_then_events_and_unsubscribes() -> None:
    async def scenario():
        broker = Broker()
        disconnected = asyncio.Event()

        async def load_snapshot():
            broker.publish("car", "trip", {"id": "t1"})  # published while the snapshot loads
            return {"vehicle_id": "car", "secret": "?key=abc"}

        async def is_disconnected():
            return disconnected.is_set()

        stream = event_stream(broker, "car", load_snapshot, is_disconnected, heartbeat=0.05)
        chunks = [await stream.__anext__() for _ in range(3)]
        assert broker.subscriber_count("car") == 1
        ping = await stream.__anext__()
        disconnected.set()
        rest = [chunk async for chunk in stream]
        return chunks, ping, rest, broker.subscriber_count("car")

    chunks, ping, rest, remaining = asyncio.run(scenario())
    assert chunks[0].startswith("retry:")
    assert chunks[1].startswith("event: snapshot\n") and "abc" not in chunks[1]
    assert chunks[2] == 'event: trip\ndata: {"id":"t1"}\n\n'
    assert ping == ": ping\n\n" and rest == [] and remaining == 0
