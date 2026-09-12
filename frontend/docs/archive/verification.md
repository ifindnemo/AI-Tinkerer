# Verification — 2026-09-11

- `npm run lint`: passed.
- `npm test`: 7 tests passed (normal, environmental heat, engine fault priority, rapid rise, offline/stale data, invalid sensors, cancellation).
- `npm run build`: passed with TypeScript and static route generation.
- `BASE_URL=http://localhost:3001 node scripts/verify-ui.mjs`: passed against the production server.
- Chromium checks: GLB successfully rendered; paint selection; auto rotation/reset; all four analysis scenarios; JSON download; history; telemetry table; scenario change cancelling pending analysis; theme selection; dialog/Escape; desktop and 390px mobile; no horizontal overflow; no page errors.
- Desktop and mobile screenshots visually reviewed. Mobile camera framing adjusted to fit the full vehicle.

Preview images: `screenshots/desktop.png`, `screenshots/mobile.png`, `screenshots/engine-analysis.png`, `screenshots/midnight.png`.

Scope: local mocked frontend. No physical OBD device, real weather service, backend integration, or real diagnostic accuracy validation was performed.

## Multi-vehicle update

- Final lint, TypeScript/production build: passed. Unit suite: 11 tests passed, including EV/BMS cases and vehicle identities.
- Production multi-vehicle browser test passed: 7 catalog entries, brand/search filters, every one of the 6 remote models emitted the official `viewerready` signal, and actual pointer dragging changed the Civic 3D rendering.
- EV normal, environmental heat, traction overheating and offline scenarios passed. Switching vehicles cancelled an in-flight analysis; JSON exports and history retained the correct vehicle. EV tables did not expose ICE oil/fuel channels. Mobile had no horizontal page overflow. No page errors in the full browser run.
- Additional failure test: blocked Sketchfab SDK request produced a visible error; unblocking and pressing Retry recovered to an actual ready viewer. SDK fetch timeout releases its shared promise so retries can start a new load.
- Online tests used real accelerated WebGL: ANGLE / Intel Mesa, with Chromium flags `--enable-gpu --use-gl=angle --use-angle=gl`. Sketchfab rejected the initial software WebGL test with `No Hardware Support for Webgl`; no fabricated ready state was used. CI without a GPU cannot validate hosted rendering the same way.
- Camera initialization now skips the host fly-in animation and brings the authored camera closer on wide screens. Author credits and native viewer UI remain.
- Artifacts: screenshots/multi-garage.png, screenshots/vf3-garage.png, screenshots/civic-garage.png, screenshots/multi-mobile.png, and remote-viewer-checks.json.
