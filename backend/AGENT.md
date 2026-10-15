# Vehicle Guardian Agent

1. **Purpose:** Evaluate a validated ECU telemetry batch directly and suggest safe next actions without an ML prediction stage.
2. **Skill:** Load `skills/chan-doan-dong-co/SKILL.md` into the agent instructions so the diagnostic knowledge is actually available at runtime.
3. **Tools:** Read outside temperature at the final batch coordinate and maintenance history. For every final warning/critical assessment with valid GPS, ensure one nearby-garage lookup within 5 km and return up to five results ordered by distance.
4. **Memory:** Load active short-term incident memory from SQLite before each run. Create or refresh memory only for warning/critical assessments, and expire it using the configured TTL.
5. **Safety:** Deterministic backend guardrails set a minimum severity that the model cannot downgrade.
   Stable data from the built-in simulator is also normalized after inference so ordinary coolant temperature or fan state alone cannot become a model-only thermal alert; this ceiling never overrides a triggered safety guardrail.
6. **Actions:** Booking and reminder writes stay outside the agent and require explicit confirmation through the API.
7. **Output:** Return a structured assessment with severity, suspected faults, evidence, confidence, missing data, diagnosis, and recommendations.
8. **Language:** The browser sends `lang` (`vi` default, or `en`) with each blackbox batch and each driver batch (`backend/lang.py`). It only chooses the wording of the agent's text and of the spoken alert; severity, mandatory steps and every safety filter are identical in both languages. There is one agent per language (the instructions end with an output-language rule), the deterministic texts (rules, Vehicle Guardian policy, guardrail reasons, rule-only fallback) have English versions, and the filters that stop the LLM from telling a driver who must stop to carry on (`unsafe_for_stop`, `states_the_stop`, `suggests_garage_trip`) check both languages. Voice: each language has its own Blaze voice (`BLAZE_SPEAKER_ID`, `BLAZE_SPEAKER_ID_EN`); a language without a voice is text-only, never read by another language's voice. The OBD device path and the DTC knowledge base stay Vietnamese.

The agent is advisory. It must not claim certainty, clear safety-critical faults, or execute a booking without human confirmation.
