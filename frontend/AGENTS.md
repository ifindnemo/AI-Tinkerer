<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project direction

Read [the team project brief](docs/project-brief.md) before planning or changing product behavior. It defines Vehicle Health Agent and the implementation priorities.

- Build an agent driven by continuous vehicle ECU data, starting with overheating, with multi-signal reasoning and evidence/confidence.
- Prioritize levels 1–2: scenario-based telemetry simulation, explainable diagnosis, user consent before actions, and one complete action workflow.
- The intended demo simulates the data source; downstream rules, AI calls, response handling and persistence should be real. The brief explicitly allows fixed garage lists, seeded history and simulated next-day controls as later simplifications. Clearly label these boundaries.
- Current frontend still uses mock analysis and browser-local history; do not present these as completed real AI/backend integration. Backend is handled by another teammate.
- Keep the user's local-only 3D asset requirement. BMW M2 is currently the only shipped car model.
- Prefer one complete, reliable flow. Defer levels 3–4 before compromising levels 1–2.

### EngineFaultDB interpretation (user confirmed 2026-09-12)

Fault 0 means no fault; 1, 2 and 3 mean fault present. Exact fault types and severity are not yet specified. See [dataset notes](docs/engine-fault-db.md). Preserve raw Excel values until units/scales are verified; do not infer overheating from this file, which lacks temperatures and fan state. Dashboard label summaries are not AI predictions. Booking currently uses fictional garages and explicit confirmation to save on the browser only.

### Single-vehicle realtime scope (user correction)

The XLSX is an example schema only. Never show dataset totals, class distributions, Excel browsing or an unidentified dataset vehicle in the product. Show only the selected vehicle’s streaming telemetry, fault status, diagnosis and garage workflow. Current source is a 1-second synthetic stream, not a live hardware connection or Excel replay.

### Backend architecture reference (2026-09-12)

Read [Vehicle Safety Agent architecture](docs/vehicle-safety-agent-architecture.md) when planning integration. This newer proposal prioritizes an overheating safety incident workflow over garage booking: monitor response, find a safe stop, obtain confirmation, request rescue, monitor stabilization. It uses one LLM agent; the Prediction & Rule Engine produces structured technical risk, severity, confidence and evidence. The LLM explains and orchestrates rather than diagnosing directly from raw telemetry.

Frontend should reflect backend incident state (`MONITORING`, `WARNING`, `WAITING_CONFIRMATION`, `ACTION_IN_PROGRESS`, `CRITICAL`, `STABILIZING`, `RESOLVED`) and vehicle motion state. Preserve per-vehicle/incident identity and pending confirmations across telemetry updates. Distinguish severity from workflow status. Navigation, rescue and sharing vehicle/location data need explicit confirmation; no direct vehicle control in MVP. Real garage booking is outside this proposed MVP.

This is architecture reference, not evidence that backend endpoints exist or these workflows are implemented. Current frontend still has local rule evaluation, synthetic telemetry and local demo garage appointments. Do not silently claim backend integration, actual rescue, confidence values or incident transitions. See [integration notes](docs/frontend-backend-integration.md).

### Safety Agent UI implemented with mocks

See [Safety Agent UI](docs/safety-agent-ui.md). The frontend now shares one incident/telemetry snapshot, has typed lifecycle/action states, confirmation cards, mock tool failure/retry/cancellation and a shortened overheating intervention demo. Driver acknowledgement alone does not alter telemetry. Urgent incidents prioritize safe stopping and rescue; garage planning is secondary. Do not call these backend/LLM results or real navigation/rescue.

### Session adapter and recovery

See [vehicle session adapter](docs/vehicle-session-adapter.md). Dashboard components consume a shared adapter; mock sampling, transitions and tool execution live behind it. Versioned per-vehicle browser storage restores incidents, timeline, history and consent. Reloading a pending action must not automatically execute it; the mock requires a manual retry with the original payload. Stored telemetry stays disconnected until a fresh packet. Keep corrupt records intact and show persistence errors. Future backend integration must reconcile unknown outcomes server-side before retrying.

### Filtered workbook range simulation

The user now authorizes using filtered XLSX ranges as references for the selected vehicle’s synthetic stream, with an explicit uncalibrated label. See [range simulation](docs/telemetry-range-simulation.md). Do not restore dataset browsing. Numeric source units for MAP/TPS/Speed are unknown: keep `raw` labels in the Excel-range mode. Temperature and load remain authored mocks; the Safety Agent intervention uses its own scenario packets. Do not infer Fault severity or overheating from the workbook.

### Thermal presentation

See [thermal alerts and booking](docs/thermal-alerts-and-booking.md) for the earlier design context. Highlight affected temperature cards and 3D sensor markers in red for the overheating demo, amber for moderate warmth, and neutral when offline; never infer heat from Fault labels or raw Excel ranges. Appointment and reminder UI is no longer part of the current MVP.

### Blackbox-only backend handoff

The user clarified that frontend produces one blackbox snapshot per second and batches 15 snapshots per 15 seconds; backend owns agent replies. At this stage, explicitly do not send requests or configure endpoints. Provide a downloadable sample JSON only. See [blackbox batching](docs/blackbox-batching.md). The shared JSON must contain sensor data and batch metadata only, never analysis, agent, incident or booking state.

### Periodic normal Agent UI

The user now requests simulated agent submission and a canned normal reply every completed 15-sample batch. See [periodic agent UI](docs/periodic-agent-ui.md). This local simulation is authorized; real backend/AI calls are still not connected. Keep response state separate from sensor-only blackbox exports. Replies update once per batch, not per sensor tick. Pause/cancel on offline, vehicle/scenario changes and disposal. Never overlay a normal fixture on active overheating; retain the incident workflow.

### Backend integration — current user scope

The user explicitly authorizes connecting the real API and wants a single-user local MVP. Backend has been refreshed from main `396e3da`; see [backend MVP integration](docs/backend-mvp-integration.md). This supersedes older no-network/ML integration notes. The default adapter sends 15 sensor records once to `/api/telemetry/batch` through Next.js, and renders the agent assessment on every successful response. The new backend accepts the frontend raw units, strips Fault labels, reads external weather and uses short-term memory; it no longer has an ML stage. Service keys stay exclusively in Python. The user removed booking and reminders from the frontend MVP, so do not render those controls or expose backend action/confirm routes through Next.js. Keep the backend team implementation unchanged and do not reapply the superseded local backend patches saved in Git stash. Avoid production infrastructure.
