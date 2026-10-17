#!/usr/bin/env bash
# Car Neuron demo launcher: production build, nothing exposed beyond this machine.
#   ./demo.sh            real agent (LLM from backend/.env), production build, localhost only
#   ./demo.sh --rules    no LLM and no paid services anywhere: rule-only answers (offline fallback)
#   ./demo.sh --rebuild  rebuild the frontend even if a build exists
#   ./demo.sh --prewarm  first speak the fixed alert lines once (about 15 paid Blaze TTS calls, cached on disk), so the
#                        demo never waits for them; skipped with --rules or when Blaze is not configured
#   ./demo.sh --keep     keep the last run's state (default: voice clips, transcripts, incidents and
#                        appointments are cleared so every run starts like the first; the old database is
#                        copied to backend/var/last-run.db)
# Unlike dev.sh there is no hot reload (saving a file cannot restart the backend in the middle of the demo),
# and both servers listen on 127.0.0.1 only. Ctrl+C stops everything. Ports: BACKEND_PORT / FRONTEND_PORT.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${FRONTEND_PORT:-3000}
RULES=0 REBUILD=0 KEEP=0 PREWARM=0
for arg in "$@"; do
  case $arg in
    --rules) RULES=1 ;;
    --rebuild) REBUILD=1 ;;
    --prewarm) PREWARM=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;32m[demo]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[demo]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[demo]\033[0m %s\n' "$*" >&2; exit 1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
env_set() { grep -Eq "^$1[[:space:]]*=[[:space:]]*[^[:space:]]+" "$ROOT/backend/.env" 2>/dev/null; }

VENV="$ROOT/backend/.venv"
[[ -x "$VENV/bin/python" ]] || die "backend/.venv is missing. Run ./dev.sh once (it creates it), then stop it."
[[ -d "$ROOT/frontend/node_modules" ]] || die "frontend/node_modules is missing. Run ./dev.sh once (it installs it), then stop it."
command -v node >/dev/null || die "node is not installed."
port_busy "$FRONTEND_PORT" && die "Port $FRONTEND_PORT is already in use."
port_busy "$BACKEND_PORT" && die "Port $BACKEND_PORT is already in use."

# Preflight: say what will run, without ever printing a key.
say "Python $("$VENV/bin/python" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))'), Node $(node --version)"
if (( RULES )); then
  export AGENT_MODE=rules EXTERNAL_TOOLS=off
  warn "Rules mode: no LLM, no LocationIQ. Answers are labelled 'Đánh giá theo luật'."
else
  if env_set OPENROUTER_API_KEY; then
    or_model=$(grep -E '^OPENROUTER_MODEL' "$ROOT/backend/.env" | cut -d= -f2- | tr -d ' "' || true)
    say "LLM: OpenRouter (${or_model:-deepseek/deepseek-v4.1-flash})"
  elif env_set INWORLD_API_KEY; then say "LLM: Inworld ($(grep -E '^LLMMODEL' "$ROOT/backend/.env" | cut -d= -f2- | tr -d ' ' || true))"
  elif env_set OPENAI_API_KEY; then say "LLM: OpenAI"
  else warn "No OPENROUTER_API_KEY, INWORLD_API_KEY or OPENAI_API_KEY in backend/.env: every answer will fall back to rules after the timeout. Use --rules."; fi
  env_set BLAZE_API_TOKEN && env_set BLAZE_SPEAKER_ID && say "Voice: Blaze configured" || warn "Voice: Blaze is not configured, so alerts are silent (the horn and the text still work)."
  env_set LOCATIONIQ_ACCESS_TOKEN || warn "LocationIQ token is empty: the nearby-garage step is skipped."
  case "${AGENT_PREFETCH_TOOLS:-0}" in 1|true|yes|on) say "Agent: weather, history and garages are looked up before the model runs (AGENT_PREFETCH_TOOLS)" ;; esac
  say "Tip: ./backend/.venv/bin/python backend/scripts/llm_preflight.py measures one real LLM call (a few tokens)."
fi

if (( PREWARM )); then
  if (( RULES )); then warn "--prewarm ignored: rules mode makes no paid calls."
  elif ! { env_set BLAZE_API_TOKEN && env_set BLAZE_SPEAKER_ID; }; then warn "--prewarm skipped: Blaze is not configured."
  else
    # Typing --prewarm is the opt-in for the paid calls. A failure only costs the saved first-play time.
    say "Pre-warming the fixed alert lines (paid Blaze TTS, about 15 calls, cached in backend/var/voice-cache)"
    (cd "$ROOT/backend" && CAR_NEURON_ALLOW_PAID_TTS=1 "$VENV/bin/python" scripts/prewarm_voice.py | tail -n 3) \
      && say "Pre-warm done. Preview any time: backend/.venv/bin/python backend/scripts/prewarm_voice.py --dry-run" \
      || warn "Pre-warm did not finish: the demo still works, the first play of a line is just slower."
  fi
fi

if (( ! KEEP )); then
  rm -rf "$ROOT/backend/var/voice" "$ROOT/backend/var/conversations" 2>/dev/null || true
  # Incidents, proposals and appointments from a rehearsal would show up in the demo ("appointment saved",
  # an open incident): start clean. The maintenance history (a JSON file) and OBD trips are not touched.
  DB_NAME=$(grep -E '^DATABASE_PATH=' "$ROOT/backend/.env" 2>/dev/null | cut -d= -f2- | tr -d ' "' || true)
  DB_NAME=${DB_NAME:-vehicle_guardian.db}
  [[ $DB_NAME = /* ]] && DB=$DB_NAME || DB="$ROOT/backend/$DB_NAME"
  if [[ -f "$DB" ]]; then
    mkdir -p "$ROOT/backend/var" && cp "$DB" "$ROOT/backend/var/last-run.db"
    "$VENV/bin/python" - "$DB" <<'PY' && say "Cleared the last run's incidents and appointments (copy in backend/var/last-run.db)"
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for table in ("appointments", "reminders", "pending_actions", "incident_memories", "incidents"):
        if table in names:
            db.execute(f"DELETE FROM {table}")
PY
  fi
fi

if (( REBUILD )) || [[ ! -f "$ROOT/frontend/.next/BUILD_ID" ]]; then
  say "Building the frontend (production)"
  (cd "$ROOT/frontend" && NEXT_PUBLIC_AGENT_MODE=backend npx next build >/dev/null) || die "next build failed. Run 'cd frontend && npx next build' to see why."
fi

trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM

say "Starting the backend on 127.0.0.1:$BACKEND_PORT (no reload)"
(cd "$ROOT/backend" && exec "$VENV/bin/python" -m uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT" --timeout-graceful-shutdown 3) &
backend_pid=$!
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 && break
  kill -0 $! 2>/dev/null || die "The backend exited during startup. See the log above."
  sleep 1
done
curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 || die "The backend did not answer /health within 30 s."

say "Starting the frontend on 127.0.0.1:$FRONTEND_PORT"
(cd "$ROOT/frontend" && BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" exec node_modules/.bin/next start --hostname 127.0.0.1 --port "$FRONTEND_PORT") &
frontend_pid=$!
for _ in $(seq 1 20); do
  curl -sf -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/garage" 2>/dev/null && break
  sleep 1
done
VOICE=$(curl -sf "http://127.0.0.1:$FRONTEND_PORT/api/voice/clips?session=bmw-m2" 2>/dev/null | grep -o '"enabled":[a-z]*' || echo "voice: unknown")
say "Ready ($VOICE). Open in Chrome or Edge:"
say "  http://localhost:$FRONTEND_PORT/garage?presenter=1&reset=1"
say "Checklist: docs/demo-runbook.md. Ctrl+C stops everything."
# wait -n needs bash 4.3. macOS ships bash 3.2, where that option exits the script and the trap stops both servers.
while kill -0 "$frontend_pid" 2>/dev/null && kill -0 "$backend_pid" 2>/dev/null; do
  sleep 1
done
warn "A service stopped; shutting down the other one."
