# Vehicle session adapter and browser recovery

The dashboard consumes a single `VehicleSessionAdapter` through `useVehicleSession`. The shipped implementation is mock-only: a synthetic one-second telemetry stream (normal/hot-weather operating channels use [filtered Excel reference ranges](telemetry-range-simulation.md)), scripted incident transitions and delayed local tool results. No backend endpoints, LLM calls, real navigation or rescue requests are implemented.

## Integration boundary

- `src/lib/vehicle-session/types.ts` defines snapshots, driver commands, lifecycle and storage contracts.
- `src/lib/vehicle-session/index.ts` is the composition point for selecting an implementation.
- `src/lib/vehicle-session/mock-adapter.ts` owns sampling, incident transitions, report/history updates, task cancellation and persistence. Components do not invoke the mock engine or mock tools directly.
- `src/hooks/use-vehicle-session.ts` subscribes with `useSyncExternalStore` and starts/disposes the selected vehicle's adapter.
- `src/lib/vehicle-session/repository.ts` validates versioned browser records before restoration.

Snapshots include connection state, current telemetry, recent chart samples, analysis, report history, incident/action/timeline and recovery feedback. Driver commands exclude tool success/failure events; the adapter owns those outcomes. `setScenario` and `setFailNext` are demo controls, not vehicle-control commands. A backend adapter must leave simulation controls unavailable in a real connection mode.

Constructors and server snapshots never read browser storage, start timers or generate random identifiers. The initial server snapshot is stable and disconnected; browser initialization restores state before accepting new stream packets. Disposing an adapter stops timers and aborts local pending tasks. Late completions are scoped to the matching incident/action.

## Persistence behavior

One record per vehicle is saved under `autolink.vehicle-session.v1.<vehicleId>` in localStorage. It contains the active scenario/incident, phase, acknowledgement, confirmation payload, action result, deduplicated timeline, last telemetry packet, simulation tick and up to 20 report episodes. One report episode is updated across packets instead of adding a history row every second. Chart samples restart after reload.

- Waiting and declined proposals retain their exact action ID and payload. Reload is not consent.
- Pending is saved synchronously before the mock tool starts. On reload, an interrupted pending action becomes failed with an explicit unknown-outcome message; no action automatically runs again. Manual retry uses the same approved action ID/payload.
- Successful outcomes and resolved incidents restore without repeating a tool call or timeline entry. Resolution still retains Fault/DTC requiring inspection.
- Restored telemetry is disconnected until the first new mock packet. Offline sessions remain offline, preserving the last packet timestamp. Historical reports are available, but no cached report is presented as a current live assessment.
- Stored vehicle/incident identities, schema version, enum values, numerical fields and array limits are checked. Invalid/incompatible data is preserved; the current visit runs in memory and shows a warning rather than overwriting the original record. Storage access/quota failures also surface in the UI.
- Changing demo scenarios begins a new episode; reconnecting from offline to the engine scenario resumes its incident. Records for other vehicles remain separate.

This is same-browser persistence, not a server incident archive or cross-device sync. Clearing site data removes saved sessions. Multiple tabs are not coordinated; the last writer wins. The existing fictional garage booking store is separate.

## Backend handoff

The current adapter interface is a frontend boundary, not a finalized wire protocol. Agree transport, event sequence/versioning, identity, units, stale timeouts, confirmation expiry and action-result lookup with the backend team. A real adapter must consume authoritative risk and incident events instead of running `observeIncident` or local diagnosis rules. It must reconcile interrupted requests with server state and enforce server-side idempotency before offering a resend. Browser records and UI confirmation alone are not authorization or proof of an external action's outcome.

Validation: `npm test`, `npm run lint`, `npm run build`, `node scripts/verify-session-recovery.mjs`, `node scripts/verify-hydration.mjs`, `node scripts/verify-agent-ui.mjs`, `node scripts/verify-live-dashboard.mjs`. Browser scripts accept `BASE_URL` (default `http://localhost:3000`).

The adapter now also collects 15 one-second blackbox records for local JSON download. This buffer is not included in persisted incident state, and no backend request is performed. See [blackbox batching](blackbox-batching.md).
