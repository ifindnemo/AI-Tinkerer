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

## MVP scope

Appointment booking and reminders are intentionally omitted from the frontend MVP. The backend action endpoints remain owned by the backend team, but the Next.js gateway does not expose them and the dashboard does not call them. Google OAuth is not required for the current telemetry and assessment flow.

## Verification

- Frontend tests cover preservation of raw units, sensor whitelisting, invalid records, one native batch request, duplicate handling, visible failures and mismatched reply identities.
- Run backend tests from `backend/` with `python -m pytest tests -q`.
- `node scripts/verify-backend-integration.mjs` uses the real local batch/agent API and checks normal and overheating assessments, desktop/mobile layout, offline behavior and hydration.
