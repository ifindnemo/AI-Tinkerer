# Local-only verification — 2026-09-11

- Lint and production build passed.
- All 12 unit tests passed, including heat attribution, stale/offline data, cancellation, synthetic EV/hybrid profiles and rejection of unknown vehicle IDs.
- Production browser catalog check passed with all external-origin requests blocked: BMW GLB rendered, zero external requests, zero iframes, removed cars absent, search/reset passed, no page errors.
- Full UI regression passed: paint, rotation/reset, four analysis scenarios, JSON export, history, telemetry table, cancellation, themes, dialogs and mobile without horizontal overflow.
- Local garage screenshot visually checked: `screenshots/local-garage.png`. Desktop/mobile screenshots refreshed by UI regression.

Only BMW M2 Coupé 2023 is currently shipped. Historical multi-vehicle research and online-viewer results are in `archive` and do not describe the current app. All analysis remains mocked; no backend or physical blackbox was tested.

## 3D focus update

- Compact catalog and local rendered thumbnail; taller 3D stage.
- Five camera presets verified with actual rendered-image changes.
- Both hotspots verified for neutral, good, watch, critical and disconnected states; detail readings and explanation match active telemetry/analysis.
- Hiding/showing markers and 390px mobile checked; no page errors.
- Lint, production build and 12 unit tests passed.
- Screenshots: `screenshots/3d-insights.png`, `screenshots/3d-mobile.png`.

## EngineFaultDB and garage workflow — 2026-09-12

- Imported summary of all 55,999 Excel rows, preserving raw numeric values, column ranges, provenance hash and three samples per class.
- Applied user-confirmed Fault mapping: 0 no fault; 1/2/3 fault present, exact type unknown. Dataset labels are not displayed as model predictions or health scores.
- Lint, production build and all 17 unit tests passed.
- Browser workflow passed with external requests blocked: Excel group/sample navigation; no-fault repair gating; specialty-based suggestions; opt-in, select, edit, review and confirm; no writes before confirmation; reload persistence; duplicate rejection; cancellation; correct dataset/vehicle identity; scenario changes clearing pending forms; mobile without horizontal overflow; no page errors.
- Screenshots reviewed: `dataset-booking.png`, `health-dashboard.png`, `service-mobile.png` under screenshots.
- An initial browser run failed because production server started before build completed. Restarting after build completion resolved this; the full workflow above passed against production.
- No real garage contact, booking availability checks, trained fault classifier, live ECU connection or backend persistence was tested or claimed.

## Single-vehicle realtime correction

The Excel file is now reference-only and its dashboard has been removed from the product. Verified automatic two-second per-car telemetry/assessment, sample-derived sparklines, offline timestamp freeze, resumed packets, vehicle-only history and appointments, and booking form persistence while packets arrive. Browser regression also covers camera presets, consent, booking reload/cancel and mobile overflow. A first-load timestamp hydration mismatch was found and fixed with a deterministic pre-stream state. Final lint/build and 19 unit tests passed; final browser run had no page errors. Current screenshots: `live-vehicle-dashboard.png` and `live-vehicle-mobile.png`.

## Safety Agent UI

- Final lint/build and all 25 unit tests passed.
- Browser agent regression passed with external requests blocked: warning, acknowledgement vs observed response, escalation, decline/reopen, explicit confirmation, mock failure/retry, navigation outcome, rescue payload and confirmation, stabilization/resolution, timeline deduplication, interrupted request cancellation, reconnect and scenario reset, mobile layout; no page errors.
- Existing realtime/dashboard regression also passed, including camera presets, sample charts, live readings, offline handling, per-car history, persistent garage demo bookings and cancellation. Garage regression now uses environmental monitoring because urgent overheating routes through Safety Agent.
- Reviewed desktop consent and mobile screenshots. Mobile capture waits for the resized WebGL canvas to render; model is visible.
- Artifacts: screenshots/agent-consent.png, screenshots/agent-resolved.png, screenshots/agent-mobile.png.
- Scope: scripted frontend agent and abortable local tool mocks. No LLM, backend incident storage, real navigation, data sharing or rescue requests were executed.

## Agent hydration attribute mismatch

- User reported `Inject Overheating` disabled-attribute mismatch. Three fresh browser loads before the change returned `disabled=""` in server HTML and no warning, so the exact original trigger was not reproduced.
- Safety Agent is now a client-only dynamic component with a deterministic SSR loading panel. Telemetry-dependent controls mount on the client instead of hydrating server button attributes. Dashboard SSR remains enabled; no suppressHydrationWarning was added.
- Regression now listens to console hydration warnings as well as pageerror. `scripts/verify-hydration.mjs` passed: no-JavaScript server placeholder, four client loads including delayed script delivery and different timezone, correct online/offline disabled state and working injection. No hydration warnings/page errors.
- Final lint and production build passed.
- Reference: https://nextjs.org/docs/messages/react-hydration-error (selectively disabling SSR) and installed Next.js lazy-loading guide.
