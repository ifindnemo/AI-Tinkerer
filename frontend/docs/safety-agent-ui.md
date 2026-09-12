> Normal operation now uses the [periodic AutoLink Agent UI](periodic-agent-ui.md), with one simulated reply per 15-sample batch. The incident intervention workflow below remains available in the overheating scenario.

# Safety Agent UI — frontend demo

The vehicle dashboard now includes an incident panel beside the local 3D model. It displays current guidance, technical risk separately from workflow state, evidence, proposed actions, confirmation payloads and a deduplicated timeline. No LLM/backend integration or external service calls are performed.

## Demo walkthrough

1. Start in normal telemetry and press **Inject Overheating** in Safety Agent.
2. The mock source supplies moving-vehicle risk data; the panel displays WARNING and guidance.
3. **Tôi đang giảm tốc** records driver feedback only. Speed remains unchanged until a new simulated observation.
4. Open **Kịch bản demo**, then **Mô phỏng xe giảm tốc**. The new packet shows lower speed/RPM but higher temperature; the mock incident escalates and proposes a seeded safe stop.
5. Inspect the location-use payload; confirm or decline. No navigation tool runs until confirmation. A toggle can fail the next mock action; retry uses the same approved request ID/payload.
6. **Mô phỏng xe đã dừng** emits a stopped packet. This supersedes any unfinished navigation action and proposes rescue with explicit vehicle/location/incident sharing confirmation.
7. Confirm rescue. The delayed mock adapter returns a labelled example request ID and ETA; no rescue provider is contacted.
8. **Mô phỏng chuỗi hạ nhiệt** emits a shortened cooling sequence. The panel moves through STABILIZING to RESOLVED. DTC/Fault are retained: stabilization is not a repair confirmation.

The simulation controls only alter demo data; they do not control a real vehicle. Seeded safe-stop position/distance, ETA, risk rules and response sequence are illustrative, not a road-safety/navigation assessment. Telemetry and incident UI use the same packet. Simulation phases are scripted test inputs; elapsed cooling time is deliberately compressed.

## State and action integrity

- One incident ID per overheating run, shared with report/history/export.
- One-second packets preserve state, confirmed payload snapshots and UI selections.
- Timeline entries are keyed to avoid repeated warnings/actions per packet.
- Pending/failed/declined/succeeded action status is separate from incident state and severity.
- Double confirmation is ignored while pending. Success/failure only applies to the matching pending action.
- Stopping supersedes navigation. Reset/change-vehicle aborts tasks; stale completions cannot update a new incident.
- Offline disables actions and marks interrupted work unconfirmed; returning to the overheating scenario resumes that incident and can retry.
- Urgent incidents prioritize Safety Agent. The user now requests garage planning during incidents as well: the planner remains below the agent and requires explicit confirmation. See [thermal alerts and booking](thermal-alerts-and-booking.md).
- Incident state, timeline, consent and report history now restore from a versioned per-vehicle browser record. Interrupted pending actions require manual retry in the demo. Backend incident storage is still pending; see [adapter and recovery details](vehicle-session-adapter.md).

## Integration seams

- `src/lib/safety-agent.ts`: typed incident/action state and pure mock transitions. This is a frontend simulator, not a production safety/risk engine.
- `src/lib/mock-safety-tools.ts`: abortable mock tool execution, no network access.
- `src/components/safety-agent-panel.tsx`: presentation and explicit user-response events.
- `src/lib/vehicle-session/`: shared telemetry/incident snapshot, cancellation, report wiring and validated persistence behind an adapter contract.
- `src/components/garage.tsx`: dashboard presentation and adapter command wiring.

When backend APIs are defined, replace scripted observation transitions and mock executor with risk/incident/action events. Backend must enforce policy, idempotency, confirmation scope/expiry, authentication where needed and reconnection recovery. The client is not an authorization boundary. Confidence remains unavailable rather than fabricated.

Validation: `npm test`; `npm run lint`; `npm run build`; `BASE_URL=http://localhost:3000 node scripts/verify-agent-ui.mjs`.
