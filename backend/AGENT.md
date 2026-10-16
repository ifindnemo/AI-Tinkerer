# Vehicle Guardian Agent

1. **Purpose:** Evaluate a validated ECU telemetry batch directly and suggest safe next actions without an ML prediction stage.
2. **Skill:** Load `skills/chan-doan-dong-co/SKILL.md` into the agent instructions so the diagnostic knowledge is actually available at runtime.
3. **Tools:** Read outside temperature at the final batch coordinate and maintenance history. For every final warning/critical assessment with valid GPS, ensure one nearby-garage lookup within 5 km and return up to five results ordered by distance.
4. **Memory:** Load active short-term incident memory from SQLite before each run. Create or refresh memory only for warning/critical assessments, and expire it using the configured TTL.
5. **Safety:** Deterministic backend guardrails set a minimum severity that the model cannot downgrade.
   Stable data from the built-in simulator is also normalized after inference so ordinary coolant temperature or fan state alone cannot become a model-only thermal alert; this ceiling never overrides a triggered safety guardrail.
6. **Actions:** the agent may call `propose_booking` (garage copied from this run's `search_nearby_garages`, a day offset 1–14 and an hour 8–17 in `GOOGLE_CALENDAR_TIME_ZONE`). That only creates a pending action (`booking.py`, `VehicleAgent._booking_state`): nothing is saved until the driver confirms through `POST /api/incidents/{id}/confirm`, and it is never proposed on a critical alert or for a drowsy driver in a moving car. A confirmed appointment is kept in the database and offered as `GET /api/appointments/{id}/calendar.ics` (`BOOKING_BACKEND=google` makes a Google Calendar event instead). Reminder writes stay outside the agent.
7. **Output:** Return a structured assessment with severity, suspected faults, evidence, confidence, missing data, diagnosis, and recommendations.
8. **Language:** The browser sends `lang` (`vi` default, or `en`) with each blackbox batch and each driver batch (`backend/lang.py`). It only chooses the wording of the agent's text and of the spoken alert; severity, mandatory steps and every safety filter are identical in both languages. There is one agent per language (the instructions end with an output-language rule), the deterministic texts (rules, Vehicle Guardian policy, guardrail reasons, rule-only fallback) have English versions, and the filters that stop the LLM from telling a driver who must stop to carry on (`unsafe_for_stop`, `states_the_stop`, `suggests_garage_trip`) check both languages. Voice: each language has its own Blaze voice (`BLAZE_SPEAKER_ID`, `BLAZE_SPEAKER_ID_EN`); a language without a voice is text-only, never read by another language's voice. The OBD device path and the DTC knowledge base stay Vietnamese.

The agent is advisory. It must not claim certainty, clear safety-critical faults, or execute a booking without human confirmation.

## Plan: car and driver together (`agent/plan.py`)

Every warning or critical result carries a `plan`, decided by rules from the car's level and the live camera summary (the LLM does not choose it):

| Car | Driver (live camera) | Plan | Appointment proposal |
|---|---|---|---|
| warning | none / attentive / unknown | `garage_when_convenient`: ease off, nearest or usual garage | allowed |
| warning | distracted | `focus_then_garage`: look at the road first | allowed |
| warning (or critical raised only by the driver) | drowsy | `rest_then_decide`: stop and rest; rested and alert → drive gently to the nearest garage; still tired → pick-up or roadside assistance | never |
| critical (the car itself) | any | `stop_and_get_help` / `stop_rest_and_get_help`: stop, engine off, do not drive; tow to the nearest garage or a pick-up | never |

The plan's `spoken` sentence replaces the spoken garage list; the popup shows its title and options. Advice only: Car Neuron never calls anyone.
