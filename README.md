# AutoLink Garage

AutoLink Garage is a frontend prototype for exploring vehicle health through an interactive 3D car and simulated blackbox data.

Built with Next.js, React, TypeScript, and Three.js, it features a local BMW M2 model, adjustable camera views, and clickable sensor hotspots. Mock analysis compares vehicle temperatures with environmental conditions to explain potential overheating and suggest next steps.

The MVP uses simulated blackbox data and a local Python backend for one demo user.
The frontend sends one validated telemetry batch to `POST /api/telemetry/batch`.
The backend removes the demo-only `fault` label, applies deterministic safety
guardrails, and sends the complete batch directly to an OpenAI Agents SDK agent.
The agent loads the checked-in engine-diagnostics skill and can read outside
temperature, maintenance history, and nearby garages. Warning and critical
incidents receive short-term SQLite memory; calendar and reminder writes still
require an explicit confirmation request.
