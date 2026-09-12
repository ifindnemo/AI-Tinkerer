> Update: the frontend mock incident UI and consent workflow are now implemented; see [Safety Agent UI](safety-agent-ui.md). Backend integration remains pending. The dashboard now uses a [session adapter with browser recovery](vehicle-session-adapter.md). The original gap assessment below is historical.

# Frontend / backend alignment

Reference: [Vehicle Safety Agent architecture](vehicle-safety-agent-architecture.md), supplied by the user on 2026-09-12. It describes a proposed architecture, not a finalized HTTP/WebSocket contract.

## Main shift

The core loop is safety intervention during one overheating incident: risk event → brief guidance → monitor vehicle response → escalate/de-escalate → safe stop → confirmed rescue → stabilization/resolution. Garage booking is secondary; real garage booking is explicitly outside the MVP.

## Frontend responsibilities

- Display live data for the selected vehicle and backend-provided risk evidence, severity and confidence. Do not generate an AI diagnosis or invent a confidence percentage in the browser.
- Show vehicle motion state separately from incident lifecycle and technical risk severity. `HIGH` severity and `WARNING` incident status are not the same field.
- Present concise current guidance plus a timeline of monitoring results and actions. Do not reset the incident or pending form for every new telemetry packet.
- Collect accept/decline responses for proposed navigation, rescue and location/diagnostic sharing. Show what the user is authorizing. Reading context, monitoring and finding safe stops can proceed without that external-action confirmation.
- Show pending, successful and failed tool outcomes accurately. Do not interpret a button click as confirmed rescue.
- Keep the local 3D model and hotspots; bind them to the same vehicle/incident snapshot as the alert panel.

## Contract details still to agree

The supplied document has illustrative JSON, but does not define routes, transport, streaming envelope or confirmation API. Before integration, agree vehicle_id and incident_id propagation, event sequence/timestamps, telemetry units, stale/disconnect handling, lifecycle transitions, action/request IDs, confirmation expiry, idempotency and reconnect recovery. Do not infer service endpoints from tool names.

## Current implementation gap

Current frontend simulates telemetry every two seconds, runs local rules and stores demo garage appointments in localStorage. It does not yet implement backend risk events, the seven-state incident lifecycle, motion-aware safety guidance, monitored intervention, safe-stop proposals or rescue requests. The reference was read and recorded; no application behavior was changed as part of this review.
