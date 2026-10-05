# Car Neuron Systems

Car Neuron System is an embedded vehicle health agent that acts as the vehicle’s nervous system: it continuously senses operational signals, detects abnormal conditions, explains what they mean, and helps the driver take the next appropriate action.

Our MVP focuses on an overheating scenario. A simulated vehicle black box streams ECU telemetry and GPS coordinates into the system. Rather than reacting to one threshold alone, the agent evaluates multiple signals together, including MAP, TPS, engine force and power, RPM, fuel consumption, speed, AFR and emissions data, alongside coolant temperature, cooling-fan status, and diagnostic trouble codes. It identifies whether the evidence indicates a genuine vehicle-health risk, assigns a severity level and confidence, and clearly explains the reasoning to the driver.

When a warning or critical issue is detected, Car Neuron System does not act without consent. It asks the driver whether they would like assistance, then uses the vehicle’s GPS position to filter a fixed garage catalogue by proximity, presents relevant options, and confirms an in-app service appointment. The system also displays sample maintenance history to show whether a similar issue has occurred before.

The project is uniquely suited to the vehicle environment because its core value depends on live in-vehicle context: ECU telemetry, diagnostic signals, vehicle history, and location. Without those signals, it would be only a generic chatbot; inside the vehicle, it becomes a proactive health agent that can detect risks before they develop into costly breakdowns.

Technically, the application uses Next.js for the driver-facing dashboard and agent experience, Python with FastAPI for backend services and diagnostic orchestration, and browser local storage for persistence of maintenance history and in-app state. Simulated black-box telemetry provides controlled normal and overheating scenarios, while simulated GPS coordinates support proximity-based garage recommendations. GPT-5.6-sol interprets structured diagnostic evidence into clear driver language, determines severity, and coordinates the consent-based action flow. The telemetry source is simulated for safe testing; the diagnosis pipeline, LLM interaction, persistence, location-based filtering, and user-action workflow are implemented as functional parts of the product.

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
- `http://localhost:3000/garage` — the dashboard: 3D car, live telemetry and the agent panel
- `http://localhost:3000/film` — an 80-second self-running motion graphic for pitches or screen recording
  (`?clean=1` hides the page chrome, `?t=30` opens paused at second 30)

In the dashboard, the top bar switches the agent source (API / Mock) and the interface language (VI / EN).

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
