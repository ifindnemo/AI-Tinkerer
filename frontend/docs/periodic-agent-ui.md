# Periodic normal-operation Agent UI

The default normal-driving view now shows AutoLink Agent beside the local 3D vehicle. Each complete batch of 15 one-second blackbox records is passed to a local mock response controller. It simulates sending for 300 ms and analysis until 900 ms, then displays a canned normal-operation reply with recommendations. With foreground one-second sampling, replies arrive approximately at 15.9s, 30.9s, 45.9s: the response cadence is 15 seconds, with a short illustrative processing delay after each batch.

The UI distinguishes collecting, sending, analyzing, ready and paused states. A 15-segment progress indicator shows the next collection window. The first recommendation is withheld until a full batch has been processed. Each reply includes its receipt time, the exact batch time window, three observations and two suggestions. Sensor updates do not replace the reply every second. The latest reply stays visible while the next batch is processed, and up to five completed replies appear in an expandable history.

This is a frontend mock, not an LLM call or network request. Response wording is intentionally prewritten for normal operation, while observation numbers are drawn from a frozen copy of the associated batch. IDs link the displayed reply to the selected vehicle and batch. No fabricated confidence percentage is shown. The outgoing/downloadable blackbox JSON remains sensor-only; replies are separate state.

The controller refuses incomplete, wrong-vehicle, faulted or hot-coolant batches. Normal responses are only scheduled in the normal scenario. Environmental/overheating scenarios retain the existing Safety Agent workflow instead of showing a normal fixture over an active warning. Changing scenario resets the incomplete batch; offline and disposal cancel in-flight mock responses. A prior reply shown offline is explicitly labelled historical and rendered neutrally. Resuming requires a new full batch. Reload starts a fresh response session; existing incident and booking persistence is unchanged.

## Files

- `src/lib/periodic-agent/mock.ts`: typed reply/cycle state, canned normal response, delay, deduplication and cancellation.
- `src/lib/vehicle-session/mock-adapter.ts`: submits each new complete batch once and coordinates scenario/lifecycle changes.
- `src/components/vehicle-agent-panel.tsx`: normal Agent UI and fallback to the existing incident panel.
- `src/components/garage.tsx`: client-only dynamic mount with the stable SSR placeholder.

The implementation intentionally provides no backend endpoint. When the backend response contract is available, replace the local controller with an adapter for authoritative replies while retaining the batch/vehicle identity and cancellation rules.

Validation: `npm test`; `npm run lint`; `npm run build`; `node scripts/verify-periodic-agent.mjs`; `node scripts/verify-hydration.mjs`. Browser coverage verifies two actual response cycles, the intermediate phases, one-second telemetry independence, mobile layout, offline cancellation, overheating priority and no POST requests.
