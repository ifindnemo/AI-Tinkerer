# robot-heads (vendored)

Source of [fayazara/robot-heads](https://github.com/fayazara/robot-heads) at commit `58ebf64` (npm 0.3.0), MIT
licence in `LICENSE`. Vendored instead of installed from npm: the package was first published on
2026-10-09, so the reviewed code is pinned here and later releases cannot reach the demo unreviewed.

Local changes, both in `RobotHead.tsx`: `"use client"` at the top (Next.js App Router), and the eyes
follow the pointer anywhere on the page instead of only within 700 px (the user asked for it on
2026-10-11; `tv/sim.ts` already clamps the resulting angles). Use it through
`components/agent/agent-dock.tsx`; do not edit these files for app behaviour.
