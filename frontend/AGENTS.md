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

### Demo improvements (2026-10-03)

The user requested: a gradual connected overheating ramp (95 → 105 → 115°C, fan 0%, flat load, moving car) so the agent warns before the backend 120°C rule; an early 5-sample first batch after a scenario change; a service-history card and tool-step list from `tool_trace`, with evidence opened on warning/critical; a runtime API/Mock toggle as an offline fallback; `./dev.sh` at the repo root; and a VI/EN interface toggle. See [backend MVP integration](docs/backend-mvp-integration.md). These are frontend-only; the backend is unchanged. UI strings use `useLang().t(vi, en)` in components and `tr(vi, en)` for text generated outside React.

### UI rework, landing page and intro film (2026-10-04)

The user chose a light, minimalist direction and asked for a reworked dashboard layout plus a landing page and a motion-graphic page. Routes: `/` landing (`components/home`), `/garage` dashboard (`components/garage.tsx`), `/film` intro film (`components/film`). See [design notes](docs/design-notes.md).

- Dashboard: no sidebar; sticky app bar (tabs, film link, API/Mock, VI/EN, settings, help), a vehicle bar with live status and the scenario select, then car + telemetry on the left and the agent panel on the right. Keep the class names and `data-testid`s used by `scripts/*.mjs`. All colours are tokens in `globals.css`; Studio/Midnight/Blueprint themes only override tokens. The illustrative fixed-coordinate map was removed. The vehicle library renders only when more than one car ships.
- Landing and film use CSS Modules and the shared tokens. Their numbers come from `overheatCoolant` / `overheatSecondAt` in `lib/live-telemetry.ts`; keep them labelled as an illustration of the demo scenario, never as guaranteed agent timing. Do not show booking or consent-to-book in either page.
- The film is a pure function of time (`components/film/timeline.ts`, tested in `tests/film-timeline.test.ts`): scenes render from their local second on a 1920 × 1080 stage. `?t=` opens paused at a second, `?clean` hides chrome for recording.
- The BMW renders in `public/brand/` derive from the CC BY-NC model; keep the Outlaw Games credit visible on pages that use them.

### Live OBD device mode and CEO demo (2026-10-04)

This section supersedes earlier scope notes where they conflict. The user now builds a production demo for 18/10/2026 (plan: [../docs/ke-hoach-demo-18-10.md](../docs/ke-hoach-demo-18-10.md)), works on frontend and backend alone, and allows changes to both. Booking is back in scope (to be rebuilt; the old confirm flow locked forever after any error).

- `AgentMode` has a third value, `"device"`. `components/garage.tsx` renders `components/live/live-garage.tsx` for it and the unchanged classic dashboard for `backend`/`mock`; never pass `"device"` to `createVehicleSessionAdapter`.
- Device data comes from an SSE store (`lib/device/stream.ts`, pure reducers in `lib/device/state.ts`) through `app/api/vehicle/stream/[id]`. A `snapshot` event replaces the state; samples are queued and played out at 1 Hz; slow PIDs use the newest value within 60 s (`latestValues`).
- Signals a car does not report stay `NaN`/absent and render as "—". Never fill them with plausible defaults (OBD has no fan PID; `thermalLevel` treats `fan === 0` as overheating evidence).
- Label simulated device data (`trip.simulated`) everywhere; the 3D BMW is illustrative and must not name the connected car.
- The gateway only reads the car: its allowlist blocks Mode 04 (clear DTCs). Do not add a clear-codes control.
- `?presenter=1` hides the data-source switch.
