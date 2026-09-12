# Single-vehicle live dashboard

The XLSX is a schema example only. The product shows the selected car's current telemetry, fault state, diagnosis, history and service appointments. No dataset counts, class distribution, Excel sample explorer or unidentified dataset vehicle is shown.

A local synthetic source emits a packet every second. Fields include RPM, MAP, TPS, engine load, fuel consumption, speed, cooling/oil/environment temperatures, fan, DTC and Fault. These are generated demo values with explicitly selected units; they are not rescaled or replayed XLSX rows. The stationary-car demo varies RPM/load while speed remains zero. Fault 0 means no fault; injected overheating uses a nonzero flag. This does not define the general meaning of Fault 1/2/3 beyond fault present.

The existing rules assess each received packet automatically. A stable episode ID preserves the booking form across packet updates. History records scenario episodes rather than every sample; history is filtered to the selected car. Export uses the current telemetry/report pair. Charts plot at most 30 received samples, not fixed decorative paths.

Offline stops packet receipt, retains the last received timestamp, hides live measurements and clears the current report/booking offer. Recovery resumes new packets. Switching scenario/car clears old chart samples and unconfirmed forms. Confirmed demo appointments remain stored locally per vehicle.

This is realtime simulation, not a hardware connection or AI backend. Replace the synthetic emitter with the teammate's API/WebSocket subscription, including schema validation, stale-connection handling and cleanup; garage bookings still require backend integration.

Checks: `npm test`, `npm run lint`, `npm run build`, `BASE_URL=http://localhost:3000 node scripts/verify-live-dashboard.mjs`.
