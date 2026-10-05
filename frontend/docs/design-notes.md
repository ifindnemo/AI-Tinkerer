# AutoLink — frontend design notes

User priority: interactive car model first; Next.js frontend only; mock blackbox data is explicitly authorized. No existing design system or files were present.

Visual reference: https://github.com/alchaincyf/huashu-design/blob/master/SKILL.md and its typography reference, retrieved 2026-09-11. The user asked to consult the skill, rather than replace the application workflow with its standalone HTML prototype process. Adopted: real product asset, content-led hierarchy, restrained palette, readable typography, interaction verification. The three-direction approval workflow is not used for this ongoing Next.js implementation. Three optional palettes are available in demo settings; they are not presented as independently approved designs.

Composition: a garage workspace with a large car stage, a narrow context column, sensor cards, and a contextual analysis panel. The car is the visual focus. Be Vietnam Pro supports Vietnamese text. Muted green is the AutoLink concept accent, not a BMW brand claim. The actual BMW badges are embedded in the model.

Assumptions: desktop first but mobile usable; all user-facing prose Vietnamese; no backend contract supplied; the mock service is isolated for replacement. No real GPS/weather lookups and no cloud LLM calls. Scores, diagnostic thresholds, charts and location are illustrative, not manufacturer specifications. Mini charts are decorative sample trends, not streamed measurements.

Model: 2023 BMW M2 Coupé (G87), not the requested optional Competition F87. File metadata identifies author Outlaw Games and license CC BY-NC 4.0. Source, license and download mirror are recorded in public/models/ATTRIBUTION.md. No performance specs are claimed in the interface.

## Multi-vehicle extension

The user subsequently requested VinFast, Honda, and newer 2025–2026 vehicles. Added a searchable, brand-filtered 7-vehicle gallery. The six new assets use their supported Sketchfab viewers because local downloads were either unavailable or required authentication. No model was relabeled as another car. VF9 year remains unknown; Prelude 2026 is explicitly marked low-poly. See vehicle-assets.md for provenance. Mock data now follows ICE/hybrid/EV context and each report records its vehicle. Hybrid assessment currently covers combustion sensors only.

## UI rework (2026-10-04)

The user picked a light, minimalist direction (over a dark automotive or HUD style) and asked for three surfaces:

- **Landing `/`** — hero with a still render of the M2 and live-looking chips driven by the demo overheating ramp; the "fixed threshold is too late" chart drawn from `overheatCoolant`; how it works; multi-signal reasoning examples; an explicit simulated vs real boundary; a film teaser. Everything numeric is labelled as an illustration of the demo scenario.
- **Dashboard `/garage`** — sidebar replaced by a sticky app bar; one vehicle bar carries identity, live status and the scenario select; the health banner sits above a two-column grid (3D car and telemetry on the left, agent panel on the right; on phones: car → agent → numbers). Text is at least 11 px (previously 7–9 px in places) and numbers use tabular figures.
- **Film `/film`** — an 80-second, 8-scene motion graphic on a 1920 × 1080 stage, rendered as a pure function of time so it can be paused, scrubbed, jumped by chapter, screenshotted at `?t=` and recorded without chrome (`?clean`, key C). No audio. It shows the guardrail, tool calls and early warning, but no booking.

Tokens live in `globals.css` (`--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--warn`, `--danger`, …). Be Vietnam Pro stays the only typeface. The renders in `public/brand/` come from the bundled GLB (see `public/models/ATTRIBUTION.md`).
