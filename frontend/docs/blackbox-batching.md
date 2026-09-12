# Blackbox sample batch for backend testing

The current handoff is **docs/blackbox-batch-15-samples.json**, a plain payload with exactly 15 sensor records, one second apart. It replaces the previous broad frontend/agent contract export. The file contains an illustrative normal-driving sequence for the selected BMW; `source: simulated` makes its origin explicit.

## Payload

- `schemaVersion`: 1.
- `batchId`: unique identity for the whole batch (future backend deduplication).
- `vehicleId`: the selected vehicle, shared by all records.
- `source`: `simulated` for the current frontend.
- `sampleIntervalMs`: 1000.
- `recordCount`: 15.
- `records`: 15 chronological blackbox snapshots with their own ISO timestamps.

Each record explicitly selects RPM, MAP, TPS, engine load, consumption, speed, coolant/oil/intake temperature, auxiliary battery voltage, fuel level, fan duty, Fault, DTC and GPS coordinates. Optional unavailable channels use null. Units are attached to each record, so authored scenario units cannot be confused with uncalibrated Excel-range values. MAP/TPS/Speed remain raw in the Excel-range demo. Fault 0 means no fault; 1/2/3 only mean a fault is present, without specifying diagnosis or severity.

No agent replies, analysis, health score, risk, incident, booking, weather-derived ambient temperature, UI scenario or derived temperature trend is sent in this payload. Backend processing and the subsequent agent response belong to the backend team. Local agent demonstrations remain labelled mocks while that response integration is pending.

## Frontend timing

The vehicle adapter now updates on a 1000 ms timer. The initial visual preview and manual simulation controls do not count toward a batch. Timer samples at t+1s through t+15s produce the first batch; t+16s through t+30s produce the next. On a normally scheduled browser timer, each completed batch therefore represents 15 seconds of collection; its first and last timestamps span 14 seconds.

The frontend currently **makes no backend request**. A completed batch in the normal scenario also triggers a [local simulated agent reply](periodic-agent-ui.md); that reply is never included in the exported JSON. It keeps only the latest completed batch and lets the user download it with **JSON 15 mẫu**. This is an in-memory preview, not a durable upload queue. A reload starts a new collection window; the separate incident/booking recovery remains unchanged.

Offline clears an incomplete window. Duplicated or too-close timestamps are not counted; invalid packets and long gaps restart collection. Browser timers can be throttled in background tabs, so there is no claim of hard realtime scheduling or invented catch-up readings. The exported test fixture uses exact one-second timestamp intervals.

Regenerate the one-file sample with `npx tsx scripts/export-blackbox-sample.ts`. Tests: `npm test`, `npm run lint`, `npm run build`, `node scripts/verify-blackbox-batch.mjs`.
