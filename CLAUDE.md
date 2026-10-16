# Car Neuron

Vehicle health and driver-attention agent: a blackbox/OBD stream and a webcam feed one vehicle agent that explains what is wrong and what to do next. CEO demo on **2026-10-18**. The user works on frontend and backend alone and writes in Vietnamese: answer in Vietnamese.

## Read first

- `frontend/AGENTS.md`: product scope and the rules for every feature (camera, Vehicle Guardian, voice, agent robot, OBD mode). This Next.js is **16**, with breaking changes: read `frontend/node_modules/next/dist/docs/` before writing frontend code. `frontend/CLAUDE.md` imports it.
- `backend/AGENT.md`: what the vehicle agent may and may not do.
- `docs/tong-ket-11-10.md`: latest summary and open items. `docs/ke-hoach-demo-18-10.md`: the demo plan. `docs/handover-driver-camera.md`: camera internals.

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI + SQLite. `agent/` vehicle agent (OpenAI Agents SDK), `analysis/` detector + worker for OBD data, `driver/` camera rules, Guardian policy, registry and driver agent, `voice.py` / `stt.py` Blaze TTS/STT, `llm_provider.py` Inworld or OpenAI |
| `frontend/` | Next.js 16 / React 19. Routes `/` home, `/garage` dashboard (Mock, API, OBD modes), `/driver` camera, `/film` intro video. Pure logic in `src/lib/`, tests in `tests/`, browser checks in `scripts/verify-*.mjs` |
| `gateway/` | OBD-II reader (real ELM327 or `--source fake-elm`) that uploads to the backend |
| `skills/` | Diagnostic skill loaded into the vehicle agent's instructions |
| `frontend/src/vendor/robot-heads/` | Reviewed third-party source (MIT). Do not edit for app behaviour; see its README |

## Run

```sh
./dev.sh                     # backend :8000 + frontend :3000 (dev)
./dev.sh --mock              # frontend only, browser-simulated agent
./demo.sh                     # demo: production build, localhost only, no reload; --rules = no LLM and no paid services
cd frontend && npx next build && npx next start   # the same by hand: a demo is always a production build
cd backend && AGENT_MODE=rules .venv/bin/python -m uvicorn main:app --port 8000   # no LLM calls (batch, OBD and driver wording)
backend/.venv/bin/python backend/scripts/llm_preflight.py   # one tiny LLM call: provider, model, latency
```

Demo address: `/garage?presenter=1&reset=1` (`reset=1` clears rehearsal leftovers in the browser). Steps and fallbacks: `docs/demo-runbook.md`.

The 3D garage needs GPU WebGL; on a software-rendered browser it stalls the page. `pkill -f` matches its own shell here: find PIDs with `ss -ltnp` and kill by PID.

## Verify before saying done

```sh
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm test && npx eslint src scripts tests && npx tsc --noEmit -p .
BASE_URL=http://127.0.0.1:3000 node scripts/verify-driver-ui.mjs        # rules-only backend
BASE_URL=http://127.0.0.1:3000 MODE=backend node scripts/verify-garage-camera.mjs   # add EXPECT_VOICE=1 with Blaze set up
```

Also `verify-navigation`, `verify-camera-switch` and `verify-motion` for UI changes. After agent, voice or camera changes (real backend, a few minutes each): `verify-plan` (same car, different plan with a drowsy driver) and `verify-voice-once` (each car alert spoken once per episode; restart the backend first for a fresh episode). `verify-session-recovery` is stale: it looks for an "Inject Overheating" button that no longer exists.

## Rules

- **Secrets:** service keys live only in `backend/.env` (Python). Never print its values, never put a key in a `NEXT_PUBLIC_` variable, a URL or a commit. Variables by name: `INWORLD_API_KEY`, `LLMMODEL`, `OPENAI_API_KEY`, `BLAZE_API_TOKEN`, `BLAZE_BASE_URL`, `BLAZE_SPEAKER_ID`, `BLAZE_SPEAKER_ID_EN`, `BLAZE_TTS_LANGUAGE_EN`, `BLAZE_TTS_MODEL_EN`, `LOCATIONIQ_ACCESS_TOKEN`, `GOOGLE_CALENDAR_*`, `AGENT_MODE`, `EXTERNAL_TOOLS`, `COOLANT_WARN_C`, `BATCH_AGENT_TIMEOUT_SECONDS`, `LLM_REQUEST_TIMEOUT_SECONDS`, `LOG_LEVEL`.
- **Tests never call paid services:** `backend/tests/conftest.py` blanks the Blaze variables and turns external tools off; keep it that way.
- **Privacy:** camera frames stay in the browser. Only structured attention events reach the backend (the schema forbids extra fields). Never send frames, landmarks or blobs.
- **Safety:** deterministic rules set severity and the mandatory steps; the LLM only words them and can never lower them or tell a driver who must stop to continue. Alerts and the horn never wait for the LLM or the network.
- **Honesty:** label simulated data everywhere on the pages. The one exception is the model's own prompts and input: by the user's decision (2026-10-16) they never mention simulation and the agent treats the data as real (`backend/agent/realism.py` cleans what reaches the LLM; the rules still read the real `source`). No claims of vehicle control, emergency calls or automotive safety certification. The gateway never sends OBD Mode 04 (clear codes), and there is no clear-codes control.
- **Git:** commit or push only when the user asks. `main` is the shared branch.
