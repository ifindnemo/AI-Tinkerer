# Car Neuron Systems

Car Neuron System is an embedded vehicle health agent that acts as the vehicle’s nervous system: it continuously senses operational signals, detects abnormal conditions, explains what they mean, and helps the driver take the next appropriate action.

Our MVP focuses on an overheating scenario. A simulated vehicle black box streams ECU telemetry and GPS coordinates into the system. Rather than reacting to one threshold alone, the agent evaluates multiple signals together, including MAP, TPS, engine force and power, RPM, fuel consumption, speed, AFR and emissions data, alongside coolant temperature, cooling-fan status, and diagnostic trouble codes. It identifies whether the evidence indicates a genuine vehicle-health risk, assigns a severity level and confidence, and clearly explains the reasoning to the driver.

When a warning or critical issue is detected, Car Neuron System does not act without consent. It asks the driver whether they would like assistance, then uses the vehicle’s GPS position to filter a fixed garage catalogue by proximity, presents relevant options, and confirms an in-app service appointment. The system also displays sample maintenance history to show whether a similar issue has occurred before.

The project is uniquely suited to the vehicle environment because its core value depends on live in-vehicle context: ECU telemetry, diagnostic signals, vehicle history, and location. Without those signals, it would be only a generic chatbot; inside the vehicle, it becomes a proactive health agent that can detect risks before they develop into costly breakdowns.

Technically, the application uses Next.js for the driver-facing dashboard and agent experience, Python with FastAPI for backend services and diagnostic orchestration, and browser local storage for persistence of maintenance history and in-app state. Simulated black-box telemetry provides controlled normal and overheating scenarios, while simulated GPS coordinates support proximity-based garage recommendations. A large language model (Inworld Router or OpenAI, chosen in `backend/.env`) turns structured diagnostic evidence into clear driver language. Deterministic safety rules set the minimum severity and the mandatory steps, and the model cannot lower them; any action that reaches outside the app needs the driver's explicit confirmation. The telemetry source is simulated for safe testing; the diagnosis pipeline, LLM interaction, persistence, location-based filtering, and user-action workflow are implemented as functional parts of the product.

## MVP implementation

The MVP uses simulated blackbox data and a local Python backend for one demo user.
The frontend sends one validated telemetry batch to `POST /api/telemetry/batch`.
The backend removes the demo-only `fault` label, applies deterministic safety
guardrails, and sends the complete batch directly to an OpenAI Agents SDK agent.
The agent loads the checked-in engine-diagnostics skill and can read outside
temperature, maintenance history, and nearby garages. Warning and critical
incidents receive short-term SQLite memory; calendar and reminder writes still
require an explicit confirmation request.

## Run locally

```sh
./dev.sh          # backend (:8000) + frontend (:3000); needs OPENAI_API_KEY in backend/.env
./dev.sh --mock   # frontend only, browser-simulated agent
```

The first run creates `backend/.venv` and installs dependencies. Pages:

- `http://localhost:3000/` — landing page (what the agent does, real vs simulated boundary)
- `http://localhost:3000/garage` — the dashboard: the 3D car (the main thing on the page) with live telemetry below it, and on the right the **Vehicle Guardian card** (a large "what to do now" banner, the six facts of the brief: speed, coolant, driver state, eye closure, safety alert, recommendation, the agent's words, then the camera) above the blackbox agent panel
- `http://localhost:3000/driver` — the driver-attention camera on its own (see below)
- `http://localhost:3000/film` — a 90-second intro film with vehicle health, the driver camera, chapters and MP4 download
  (`?clean=1` hides the page chrome, `?t=30` opens paused at second 30)

In the dashboard, the top bar switches the agent source (API / Mock) and the interface language (VI / EN).

## Running the demo

```sh
./demo.sh            # production build, real LLM from backend/.env, listens on 127.0.0.1 only
./demo.sh --rules    # no LLM and no paid service anywhere: rule-only answers (offline fallback)
backend/.venv/bin/python backend/scripts/llm_preflight.py   # one tiny LLM call: provider, model, latency
```

Open `http://localhost:3000/garage?presenter=1&reset=1` (`reset=1` clears rehearsal leftovers in the browser).
Pick the scenario **Nóng nhẹ, đang chạy (kịch bản camera)** (a car at about 65 km/h with coolant held near
106 °C, above the 105 °C warning line and below the 120 °C mandatory stop), turn on the camera and close your
eyes for two to three seconds. Step by step, fallbacks and the checklist: [docs/demo-runbook.md](docs/demo-runbook.md).
The product brief behind it: [docs/README_VEHICLE_GUARDIAN_CAMERA.md](docs/README_VEHICLE_GUARDIAN_CAMERA.md).

## Live OBD mode (device)

The dashboard's **OBD** switch shows data streamed from an OBD gateway through the backend
(`POST /api/ingest/batch` → SQLite → server-sent events). Without a car, the gateway's fake ELM327
plays a scenario (`normal`, `city`, `overheat`, `misfire`, `lean`); that data is labelled simulated.

```sh
./dev.sh                                   # backend + frontend
cd backend && .venv/bin/python scripts/create_device.py --vehicle bmw-m2 --label laptop
export CAR_NEURON_DEVICE_ID=dev_...  CAR_NEURON_TOKEN=cnd_...
cd gateway && .venv/bin/python -m car_neuron_gateway --source fake-elm --scenario overheat \
  --server http://localhost:3000 --ingest-path /api/ingest --fixed-location 10.8023,106.7311
```

Then open `http://localhost:3000/garage` and press **OBD** (`?presenter=1` hides the source switch).
The analysis runs at the start of a trip, on detector findings or new DTCs, and every 5 minutes.
Set `AGENT_MODE=rules` and `EXTERNAL_TOOLS=off` in `backend/.env` for a demo without OpenAI or LocationIQ.
See [gateway/README.md](gateway/README.md) and [docs/ke-hoach-demo-18-10.md](docs/ke-hoach-demo-18-10.md).

## Driver attention camera (`/driver`)

`http://localhost:3000/driver` watches the driver with the webcam. Face analysis (MediaPipe) runs in the
browser; only structured events (face presence, eye-closure time, head direction, attention state,
confidence) are posted to `POST /api/driver/events`. No video or image is sent, stored or given to the agent.
Rules set the severity (drowsy, distracted, no face); the agent only rewords the alert and falls back to
the rule text without a valid OpenAI key. "Xem mô phỏng" plays labelled scenarios without a camera, and
`?debug=1` shows the raw model values for tuning. Browsers only allow the camera on HTTPS or localhost.
The module does not control the vehicle, call emergency services or claim automotive safety certification.
