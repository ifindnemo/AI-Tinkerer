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

### Driver attention camera, `/driver` (2026-10-11)

The user now focuses the demo on a webcam-based driver-attention module; the blackbox/OBD dashboard stays as it is. Design direction: a professional motion-graphic feel, minimal, not "AI-looking".

- Privacy is the product promise: MediaPipe FaceLandmarker runs in the browser from vendored assets in `public/mediapipe/` (no CDN). Only `DriverEvent` JSON (face presence, eye-closure duration and 30 s ratio, head direction, attention state, confidence) is posted to `/api/driver/events`; the backend schema forbids extra fields, so no image can pass. Never send frames, landmarks or blobs, and never draw a face-mesh dot cloud.
- Pure logic lives in `lib/driver/` (`features.ts` geometry, `attention.ts` tracker, `calibration.ts`, `simulation.ts`), tested in `tests/driver-*.test.ts`. `hooks/use-driver-monitor.ts` orchestrates; frame-rate visuals read `LiveChannel` in `requestAnimationFrame`, React state updates about 5 times per second.
- Immediate severity and sound also run locally (`lib/driver/safety.ts`), matching `backend/driver/rules.py`; never wait for the API/LLM to warn. The agent may reword the summary, while severity, evidence and safety recommendations remain deterministic. A prolonged closure (≥ 2.5 s) holds the critical alert for 60 s; any reliable drowsy reading holds a warning for 20 s. Show current observation separately from a held alert. Motion now follows the simulated ECU speed (see Vehicle Guardian below).
- Yaw > 0 means the driver turned toward their own left; the preview and the drawing are mirrored. This sign is reasoned and unit-tested on synthetic landmarks, but not yet checked on a real turned head: confirm it with `/driver?debug=1` on the demo camera. If turning left shows "Sang phải", negate `yaw` in `headPose()` (`lib/driver/features.ts`); labels, compass and drawing all derive from it.
- Demo from `next build && next start`: in `next dev`, MediaPipe's "INFO … XNNPACK" `console.error` shows a "1 Issue" badge (harmless, dev only).
- Simulation is labelled everywhere and each scenario starts a new backend session. The camera needs a secure context (HTTPS or localhost).
- Keep the footer line: prototype, no vehicle control, no emergency calls, no automotive safety certification.
- Browser regression: `BASE_URL=http://127.0.0.1:3000 node scripts/verify-driver-ui.mjs` against a rules-only backend. See the 11/10 update in `../docs/handover-driver-camera.md` for camera cancellation, frozen-frame handling, and the optional face-video fixture.
- All four routes share `components/site/site-header.tsx`: Home, Garage, Driver, Intro film, and one language switch. Garage passes its tabs/source/settings as the optional second row; do not recreate page-specific primary navigation. Check `scripts/verify-navigation.mjs` for VI/EN, mobile and both garage modes.

### Vehicle Guardian flow on `/driver` (2026-10-11)

The user now focuses the demo on one flow (brief: README_VEHICLE_GUARDIAN_CAMERA): the camera is an extra sense for the vehicle agent, not a standalone product. Blink → nothing; prolonged closure → `low_attention`; the safety policy sounds at once because the car is moving; the agent explains with ECU + camera + maintenance history and recommends the nearest safe stop instead of a distant garage; the driver opens their eyes and confirms, the response is recorded, and the vehicle warning stays.

- Policy: `backend/driver/guardian.py` (`decide()` is pure) with the browser mirror `lib/guardian/policy.ts`. Both are tested against `backend/driver/guardian_cases.json`; change the table and both sides together. Vehicle thresholds are the existing ones only: warning at `COOLANT_WARN_C` (105 °C default, `analysis.detector.thresholds()`), mandatory stop at 120 °C (`agent/safety.py`). The brief's 103 °C was an example value.
- ECU data is simulated in the browser (`lib/guardian/ecu.ts`: normal/warm/overheat/parked, default warm) and labelled everywhere; speed ≥ 5 km/h replaces the old manual "Xe đang chạy" switch. Batches carry `context.vehicle` and, after a confirmation, `context.acknowledgedAt` (the `capturedAt` of the confirming event). Without `vehicle` the endpoint behaves exactly as before.
- Confirmation is a downgrade path, so the backend checks it against the session's own events (open eyes, facing forward, reliable, after a low-attention event, no relapse). It caps the driver alert at warning and stops the horn; it never touches the vehicle level or an overheat stop. An unanswered driver alert escalates to critical after 10 s.
- The camera chip and lens show the driver's severity; the Guardian board, agent card and mobile banner show the combined one. A warm engine alone is visual only; the horn is for the driver's alertness and for a mandatory stop.
- Maintenance history is the seeded, simulated file for `bmw-m2`; it is context, never a cause. The agent writes only the explanation (rejected if it tells a driver who must stop to continue); steps always come from the policy, so the flow is complete with `AGENT_MODE=rules`.
- Camera inside the blackbox dashboard (2026-10-11, revised; see the 2026-10-14 section below): `components/driver/garage-camera.tsx` sits at the top of the insights column of `/garage` (API and OBD modes). It watches on the device and posts only when the driver's alert rises or the driver confirms (`alertsOnly`), never continuously; each post carries the last minute of events and `context.vehicleId`. The backend keeps that alert per vehicle for 60 s (`backend/driver/registry.py`), and the next blackbox analysis sees it as `driver_attention`; nothing is re-analysed because of it. `VehicleAgent._apply_driver_policy` requires the nearest safe stop for a low-attention driver in a moving car and marks `driver_policy_raised`.
- Voice (feat/voice + 2026-10-11): driver alerts are spoken in the agent's words (`DriverService._speak` waits for the LLM up to `DRIVER_AGENT_TIMEOUT_SECONDS`, else the rule text; one clip per episode), car alerts from both blackbox paths are spoken unless only the driver raised them, and a warning is skipped after a recent critical for the same vehicle. Blaze clips are listed at `/api/voice/clips?session=<vehicle id>` and played by `hooks/use-voice-alerts.ts` inside the agent dock (muted with the camera sound toggle). Voice needs `BLAZE_API_TOKEN` and `BLAZE_SPEAKER_ID` (a `voice_id` from Blaze `GET /v1/voices`; the demo uses `HN-Nar-Nu-PhuongLy`) in `backend/.env`. Blaze's `/download` answers 425 while audio is processing and has no status route; `voice.py` polls it. `backend/tests/conftest.py` blanks the Blaze variables so tests never call the real account. Browser check with voice: `EXPECT_VOICE=1 MODE=backend node scripts/verify-garage-camera.mjs`.
- Agent robot (2026-10-11): `components/agent/agent-dock.tsx` puts a round `robot-heads` robot (vendored, reviewed MIT source in `src/vendor/robot-heads`, do not edit it for app behaviour) bottom-right on `/garage` (API and OBD, not Mock) and `/driver`. Pages publish into `lib/agent/presence.ts` (camera, car agent phase/severity, alert words); `robotState`/`advance` there are pure and tested in `tests/agent-presence.test.ts`. The dock owns voice playback (`useVoiceAlerts`, session = vehicle id `bmw-m2`; `/driver` now sends `vehicleId` too) and shows every alert in a bubble, sound or not; "Xem chi tiết" scrolls to `#car-agent` / `#driver-agent`. It never replaces the horn, cards or the mobile alert bar (it sits above that bar). A click opens a quick panel (last alert, replay, the dock's own mute kept in local storage, details; Escape or a click outside closes it); an alert that timed out unseen leaves a badge; after 90 s with no input and nothing happening it naps, and wakes with a smile. Its eyes follow the pointer anywhere on the page (the one local change to the vendored code). Without a GPU (software WebGL) the robot holds still faces except while speaking: animating next to the 3D car there stretched navigation from 0.2 s to 10 s.
- LLM provider (2026-10-11): with `INWORLD_API_KEY` set, both agents use Inworld Router (OpenAI-compatible Chat Completions, model from `LLMMODEL`) via `backend/llm_provider.py`; otherwise OpenAI as before. Keys stay in Python.

### Intro film update (2026-10-11)

The user requested the original 60-second video from `brag-output`, extended to 90 seconds with the driver camera. This supersedes the old 80-second browser animation described above. `/film` now plays the actual local `public/film/car-neuron-90s.mp4` (1920 × 1080, 30 fps), with native controls and subtitles. Chapter metadata in `components/film/timeline.ts` follows the MP4; never run a separate animation clock. Keep `?t=`, `?clean`, keyboard shortcuts, the shared navigation, model/music credits and demo disclosures. Sound starts on user playback; `?autoplay=1` is muted and respects reduced motion. The old React scenes and unused scene CSS were removed. Source is deterministic HyperFrames HTML; see [film handover](../docs/intro-film-90s.md) and its source ZIP.

### Garage Vehicle Guardian card (2026-10-14)

The user chose `/garage` (blackbox + camera, API mode, real LLM) as the one demo stage, with the brief in `docs/README_VEHICLE_GUARDIAN_CAMERA.md`, and decided that the **3D car stays the main thing on the page**. Final layout (the user's words, 2026-10-14): a **2 × 2 grid**, the first column wide — cell 1 the 3D car, cell 2 (column 2, row 1) the camera container, cell 3 (row 2, column 1) the blackbox information, cell 4 (row 2, column 2) the agent information. A full-width band above the car and a "camera column that also holds the agent" were tried and rejected.

- `components/garage.tsx` builds the grid (`.overview-quad` in `globals.css`, areas `car camera / data agent`, `.quad-*` cells); a slim one-line status strip (`health-overview-slim`, keeps the simulated-data label) sits above it. Without the backend (mock mode) there is no camera cell and the agent spans both rows, as before. From 1080 px down it is one column: car, camera, Guardian facts, agent, numbers. The car cell stretches to the camera cell's height (`CarViewer` follows its container through a `ResizeObserver`).
- `components/driver/garage-camera.tsx` owns the camera cell and fills the other two cells through portals (`factsSlot`, `agentSlot`: DOM nodes in `quad-data` and `quad-agent`, kept as state in `garage.tsx`). Camera cell, running: `ActionBanner` (what to do now, large, from the policy's action) → lens → `GuardianBoard part="controls"` (confirm button, horn row) → note → camera settings (a `<details>`, open only while idle). Blackbox cell: `GuardianBoard part="facts" wide` (the six rows of the brief in three columns, each with its source) above the telemetry. Agent cell: `AgentCard` (`agent-card.tsx`: the agent's words, the policy's steps, an honest label for who wrote the text) above the blackbox agent panel. While idle or calibrating the lens is on top (its progress is in it). The camera stays mounted when another tab is open (the overview pane is only hidden), so switching tabs never stops it. The live OBD garage uses the same card. Keep the testids (`board-*`, `guardian-*` — `guardian-board` is the facts part, `guardian-controls` the controls —, `garage-camera-*`, `action-banner`). Short screens (≤ 820 px tall) compact the strip, the banner and the lens so the confirm button stays on the first screen at 1366 × 768.
- Scenario `warm` ("Nóng nhẹ, đang chạy"): about 65 km/h, coolant held near 106.5 °C (above the 105 warning line, below the 120 stop), no DTC. It is the README scenario; the `engine` ramp crosses 120 °C after 42 s, which is the mandatory-stop story.
- The horn: `muteHorn` covers the alert it was pressed on and is lifted by a higher driver level, a mandatory engine stop or the end of the alert (`muteStillHolds`, tested); it also mutes the robot's voice. "Thử còi" plays the warning tone whatever the mute. The saved `sound` setting still persists, so the idle card shows it.
- Because the garage camera posts only on a rising alert, a reply that still carries the rule text (`fallbackReason: "pending"`) is asked again up to four times (4.5 s apart) to pick up the agent's wording and keep the driver summary fresh (it goes stale after 60 s). The backend also treats a closure after a lapsed alert as a new episode (`DriverService._alert_lapsed`), otherwise the second closure would read as "unanswered".
- The robot is small and tucked into the corner on `/garage` and `/driver` (`AgentDock quietOver`), and its bubble is drawn only while the camera card (`quietRatio` 0.1) or the Guardian board is on screen; it stays in the DOM for screen readers. After a driver confirmation the robot says the car is still warning while the engine is.
- `?reset=1` on `/garage` and `/driver` clears the app's `localStorage` keys (`lib/demo-reset.ts`) and reloads without the parameter.
- Backend: `/api/telemetry/batch` honours `AGENT_MODE=rules` and falls back to rules on an LLM error or after `BATCH_AGENT_TIMEOUT_SECONDS` (reply carries `engine` and `fallback_reason`); a coolant at or above the warning line for the last 8 samples sets a warning floor (`analysis.rules.batch_policy`), because rule R1 needs 20 s of history and a batch holds at most 15.
