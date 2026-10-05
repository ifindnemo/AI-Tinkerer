# Car Neuron

Car Neuron is a frontend prototype for exploring vehicle health through an interactive 3D car and simulated blackbox data.

Built with Next.js, React, TypeScript, and Three.js, it features a local BMW M2 model, adjustable camera views, and clickable sensor hotspots. Mock analysis compares vehicle temperatures with environmental conditions to explain potential overheating and suggest next steps.

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
