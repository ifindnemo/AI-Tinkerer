# Car Neuron — local backend MVP

Current backend: `main` commit `396e3da` (`feat: simplify vehicle agent demo flow`). This is a one-user local demo. Sensor/GPS data is synthetic; assessment, external weather and garage tools run on the backend. No frontend ML rules or canned agent replies are used in API mode.

## Run locally

Start Python from `backend/`:

```sh
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

Start Next.js from `frontend/`:

```sh
npm ci
npm run dev
```

Next.js defaults to `http://127.0.0.1:8000`; optional server-only `BACKEND_URL` overrides it. Keep service credentials in `backend/.env` and restart Python after changes. `NEXT_PUBLIC_AGENT_MODE=mock` explicitly selects the old browser-only demo instead of the default connected mode.

## API and cadence

- One sensor sample per second; exactly 15 samples per browser batch.
- Browser POST `/api/vehicle/telemetry` → Next.js forwards **one** POST `/api/telemetry/batch` to Python.
- The payload remains the sensor-only blackbox schema (`schemaVersion`, `batchId`, `vehicleId`, `source`, `sampleIntervalMs`, `recordCount`, `records`). Raw units stay raw; no unit reinterpretation or frontend weather/diagnosis is inserted.
- Backend validates records, strips `fault` before agent input, evaluates deterministic safety guardrails, and calls the agent with short-term incident memory. The old ML/sliding-window stage has been removed by the backend team.
- The frontend displays the returned `assessment` (severity, diagnosis, evidence, suspected faults, confidence, missing data, recommendations), tool weather, incident identity and memory context. Confidence is the agent's self-assessment, not a calibrated probability or health score.
- Readings continue while the agent works. If a call exceeds 15 seconds, the frontend skips completed batches while busy, reports the count, and resumes at the next full batch. Reply timing therefore includes backend/AI latency. It does not send overlapping requests or accumulate a backlog.
- Offline/scenario change/disposal invalidates pending UI responses. Already accepted backend work cannot be undone by cancelling a browser request. A failed POST is not automatically replayed; the next fresh batch may be sent normally.

The gateway is only a same-origin local adapter (no CORS changes or browser API keys). It validates the batch and caches a small number of identical submissions in memory. No accounts, deployment stack, background queues or production infrastructure were added.

## Confirmed actions

The frontend uses the new backend's existing API unchanged:

- `POST /api/incidents/{id}/action` prepares `book_appointment` or `remind_later`.
- The frontend renders the returned pending payload and requires a checkbox plus a separate final confirmation click.
- `POST /api/incidents/{id}/confirm` executes the pending ID.
- Booking now creates a one-hour Google Calendar event and then stores the appointment. The result includes `calendar_event`; the UI can open its returned Google Calendar link. This is not confirmation of availability by the garage.
- Reminder currently stores a database record; it does not imply scheduled notification delivery.
- Garage choices come only from the agent's returned `search_nearby_garages` trace. The old standalone `find_garage` action is no longer supported and has been removed from the connected UI.

The current backend has no pending-action status endpoint. The earlier temporary frontend-integration additions to Python were set aside before merging main and were not reapplied. On an uncertain confirmation outcome the frontend blocks automatic retry, including after reload, and asks the user to check Calendar/backend rather than risking duplicate writes. Unconfirmed review state stays in memory; editing clears consent. This is deliberately limited to the single-user demo.

## Google Calendar configuration

The backend uses its OAuth credential loader: configure `GOOGLE_CALENDAR_CREDENTIALS_FILE` or provide the expected `client_secret_*.json`, then authorize the account. A saved `backend/token.json` is used for refreshes. The standalone `GOOGLE_CALENDAR_ACCESS_TOKEN` variable is not consumed by this backend implementation. Keep all these files out of Git.

## Verification

- Frontend tests cover preservation of raw units, sensor whitelisting, invalid records, one native batch request, duplicate handling, visible failures and mismatched reply identities.
- Run backend tests from `backend/` with `python -m pytest tests -q`.
- `node scripts/verify-backend-integration.mjs` uses the real local batch/agent API and checks desktop/mobile, offline behavior and hydration. Booking POSTs are intercepted in that browser test; no real Calendar event is created.
