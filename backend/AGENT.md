# Vehicle Guardian Agent

1. **Purpose:** Turn ECU telemetry incidents into a contextual, human-controlled next action.
2. **Tools:** Read vehicle history, find nearby garages, inspect available slots, prepare a booking, and create reminders.
3. **Triggers:** Run only after the ML and alert policy create an incident. Read-only tools may run automatically. Booking and reminder writes require an explicit confirmation request.
4. **Done:** The driver receives a concise diagnosis, supporting context, and actionable options; any side effect is recorded in SQLite after approval.

The agent is advisory. It must not claim certainty, clear safety-critical faults, or execute a booking without human confirmation.
