"""The agent proposes an appointment; only the driver's confirmation saves it."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.orchestrator import VehicleAgent
from agent.tools.openai_tools import VEHICLE_TOOLS
from booking import build_proposal, ics_for
from routes import router
from schemas import Severity, VehicleAssessment
from store import store

NOW = datetime(2026, 10, 16, 3, 0, tzinfo=timezone.utc)  # 10:00 in Ho Chi Minh City
GARAGE = "Garage Minh Khoa"


def _search_trace() -> list[dict]:
    return [{"tool": "search_nearby_garages", "arguments": {}, "result": {"options": [
        {"name": GARAGE, "address": "12 Nguyễn Huệ", "distance_km": 1.2, "latitude": 10.77, "longitude": 106.7},
    ]}}]


def _proposal_trace(**arguments) -> list[dict]:
    arguments = {"garage_name": GARAGE, "days_from_now": 1, "hour": 9, **arguments}
    return [*_search_trace(), {"tool": "propose_booking", "arguments": arguments, "result": {"proposed": True}}]


def _assessment(severity=Severity.WARNING) -> VehicleAssessment:
    return VehicleAssessment(severity=severity, diagnosis="Nhiệt độ tăng.", evidence=["108°C"], confidence=0.7,
                             recommendations=["Kiểm tra hệ thống làm mát."])


def _persist(trace, severity=Severity.WARNING, vehicle="booking-car", **context) -> dict:
    telemetry_context = {"vehicle_id": vehicle, "records": [], **context}
    return VehicleAgent.persist_assessment(telemetry_context, _assessment(severity), trace, {}, None)


def test_the_agent_has_the_tools_it_needs() -> None:
    assert {tool.name for tool in VEHICLE_TOOLS} == {
        "get_external_environment_context", "get_maintenance_history", "search_nearby_garages", "propose_booking",
    }


def test_proposal_uses_the_garage_time_zone_and_a_found_garage() -> None:
    proposal = build_proposal(GARAGE, 1, 9, _search_trace(), now=NOW)
    assert proposal["garage_id"] == GARAGE
    assert proposal["slot"] == "2026-10-17T09:00:00+07:00"
    assert proposal["distance_km"] == 1.2


@pytest.mark.parametrize("name,days,hour,why", [
    ("Garage bịa", 1, 9, "garage_name"),
    (GARAGE, 0, 9, "days_from_now"),
    (GARAGE, 15, 9, "days_from_now"),
    (GARAGE, 1, 7, "hour"),
    (GARAGE, 1, 18, "hour"),
])
def test_proposal_rejects_what_the_agent_may_not_invent(name, days, hour, why) -> None:
    with pytest.raises(ValueError, match=why):
        build_proposal(name, days, hour, _search_trace(), now=NOW)


def test_a_proposal_waits_for_confirmation_and_is_not_repeated() -> None:
    first = _persist(_proposal_trace(), vehicle="car-a")
    pending = first["pending_action"]
    assert pending["status"] == "pending_confirmation" and pending["action_type"] == "book_appointment"
    assert pending["payload"]["garage_id"] == GARAGE
    assert first["appointment"] is None
    # The next batch proposes again (even a different slot): the driver keeps seeing the same one.
    second = _persist(_proposal_trace(days_from_now=3, hour=15), vehicle="car-a")
    assert second["pending_action"]["id"] == pending["id"]
    # And it stays visible when the agent no longer proposes it.
    third = _persist(_search_trace(), vehicle="car-a")
    assert third["pending_action"]["id"] == pending["id"]


def test_no_proposal_without_a_found_garage_or_for_a_stop_now_alert() -> None:
    assert _persist([{"tool": "propose_booking", "arguments": {"garage_name": "x", "days_from_now": 1, "hour": 9},
                      "result": {"proposed": True}}], vehicle="car-b")["pending_action"] is None
    assert _persist(_proposal_trace(), severity=Severity.CRITICAL, vehicle="car-c")["pending_action"] is None
    assert _persist(_proposal_trace(), vehicle="car-d", driver_policy_raised=True)["pending_action"] is None


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app)


def test_confirming_saves_the_appointment_and_offers_an_ics_file(client, monkeypatch) -> None:
    monkeypatch.delenv("BOOKING_BACKEND", raising=False)
    result = _persist(_proposal_trace(), vehicle="car-e")
    incident_id, pending = result["incident"]["id"], result["pending_action"]
    # Nothing is saved before the confirmation.
    assert store.appointment_for_incident(incident_id) is None

    confirmed = client.post(f"/api/incidents/{incident_id}/confirm", json={"pending_action_id": pending["id"]})
    assert confirmed.status_code == 200
    appointment = confirmed.json()["result"]
    assert appointment["garage_id"] == GARAGE and appointment["calendar"] == "local" and appointment["calendar_event"] is None
    # Confirming twice is refused, and the next analysis reports the saved appointment, not a new proposal.
    assert client.post(f"/api/incidents/{incident_id}/confirm", json={"pending_action_id": pending["id"]}).status_code == 409
    again = _persist(_proposal_trace(), vehicle="car-e")
    assert again["pending_action"] is None and again["appointment"]["id"] == appointment["id"]

    calendar = client.get(f"/api/appointments/{appointment['id']}/calendar.ics")
    assert calendar.status_code == 200 and calendar.headers["content-type"].startswith("text/calendar")
    assert "BEGIN:VEVENT" in calendar.text and f"UID:{appointment['id']}@car-neuron" in calendar.text
    assert f"LOCATION:{GARAGE}" in calendar.text and "not been contacted" in calendar.text
    assert client.get("/api/appointments/apt_missing/calendar.ics").status_code == 404


def test_a_slot_that_has_passed_cannot_be_confirmed(client) -> None:
    result = _persist(_proposal_trace(), vehicle="car-f")
    incident_id, pending = result["incident"]["id"], result["pending_action"]
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    with store.connect() as connection:
        connection.execute("UPDATE pending_actions SET payload_json = ? WHERE id = ?",
                           (f'{{"garage_id": "{GARAGE}", "slot": "{past}"}}', pending["id"]))
    assert client.post(f"/api/incidents/{incident_id}/confirm", json={"pending_action_id": pending["id"]}).status_code == 409


def test_ics_escapes_text_and_uses_utc() -> None:
    text = ics_for({"id": "apt_1", "incident_id": "inc_1", "vehicle_id": "v", "garage_id": "A, B; C",
                    "slot": "2026-10-17T09:00:00+07:00", "created_at": "2026-10-16T03:00:00Z"})
    assert "DTSTART:20261017T020000Z" in text and "DTEND:20261017T030000Z" in text
    assert "LOCATION:A\\, B\\; C" in text and text.endswith("\r\n")
