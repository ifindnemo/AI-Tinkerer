# Vehicle Guardian Agent

1. **Purpose:** Evaluate a validated ECU telemetry batch directly and suggest safe next actions without an ML prediction stage.
2. **Skill:** Load `skills/chan-doan-dong-co/SKILL.md` into the agent instructions so the diagnostic knowledge is actually available at runtime.
3. **Tools:** Read outside temperature at the final batch coordinate, read maintenance history, and find nearby garages only when an issue is suspected.
4. **Memory:** Load active short-term incident memory from SQLite before each run. Create or refresh memory only for warning/critical assessments, and expire it using the configured TTL.
5. **Safety:** Deterministic backend guardrails set a minimum severity that the model cannot downgrade.
6. **Actions:** Booking and reminder writes stay outside the agent and require explicit confirmation through the API.
7. **Output:** Return a structured assessment with severity, suspected faults, evidence, confidence, missing data, diagnosis, and recommendations.

The agent is advisory. It must not claim certainty, clear safety-critical faults, or execute a booking without human confirmation.
