#!/usr/bin/env bash
# Start Car Neuron locally: FastAPI backend (:8000) + Next.js frontend (:3000).
#   ./dev.sh          backend + frontend; the agent needs OPENAI_API_KEY in backend/.env
#   ./dev.sh --mock   frontend only, with the browser-simulated agent as the default
# Ctrl+C stops everything. Ports: BACKEND_PORT / FRONTEND_PORT. Python: PYTHON.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${FRONTEND_PORT:-3000}
PYTHON=${PYTHON:-python3}
MOCK=0

usage() { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; }
for arg in "$@"; do
  case $arg in
    --mock) MOCK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;32m[dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dev]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2; exit 1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

port_busy "$FRONTEND_PORT" && die "Port $FRONTEND_PORT is already in use. Stop that process or set FRONTEND_PORT."
command -v npm >/dev/null || die "npm is not installed."

if (( ! MOCK )); then
  port_busy "$BACKEND_PORT" && die "Port $BACKEND_PORT is already in use. Stop that process or set BACKEND_PORT."
  VENV="$ROOT/backend/.venv"
  if [[ ! -x "$VENV/bin/python" ]]; then
    command -v "$PYTHON" >/dev/null || die "$PYTHON not found. Set PYTHON=/path/to/python3."
    say "Creating backend/.venv"
    "$PYTHON" -m venv "$VENV"
  fi
  # Reinstall only when requirements.txt changes.
  STAMP="$VENV/.requirements.sha256"
  WANT=$(sha256sum "$ROOT/backend/requirements.txt" | cut -d' ' -f1)
  if [[ ! -f "$STAMP" || $(cat "$STAMP") != "$WANT" ]]; then
    say "Installing backend requirements"
    "$VENV/bin/python" -m pip install --quiet --upgrade pip
    "$VENV/bin/python" -m pip install --quiet -r "$ROOT/backend/requirements.txt"
    echo "$WANT" > "$STAMP"
  fi
  if [[ ! -f "$ROOT/backend/.env" ]]; then
    cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
    warn "Created backend/.env from .env.example. Add your API keys there."
  fi
  grep -Eq '^OPENAI_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]+' "$ROOT/backend/.env" \
    || warn "OPENAI_API_KEY is empty in backend/.env: the agent will return errors. Use the Mock toggle in the UI or ./dev.sh --mock."
  grep -Eq '^LOCATIONIQ_ACCESS_TOKEN[[:space:]]*=[[:space:]]*[^[:space:]]+' "$ROOT/backend/.env" \
    || warn "LOCATIONIQ_ACCESS_TOKEN is empty: the nearby-garage step will fail (the agent still answers)."
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  say "Installing frontend dependencies"
  (cd "$ROOT/frontend" && npm ci)
fi

# Stop every child (uvicorn reloader, Next.js workers) when either side exits or on Ctrl+C.
trap 'trap - EXIT INT TERM; kill 0 2>/dev/null' EXIT INT TERM

if (( ! MOCK )); then
  say "Starting backend on http://127.0.0.1:$BACKEND_PORT"
  (cd "$ROOT/backend" && exec "$VENV/bin/python" -m uvicorn main:app --reload --timeout-graceful-shutdown 3 --port "$BACKEND_PORT") &
  for _ in $(seq 1 30); do
    curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 && break
    kill -0 $! 2>/dev/null || die "Backend exited during startup. See the log above."
    sleep 1
  done
  curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 || die "Backend did not answer /health within 30 s."
fi

MODE=$([[ $MOCK == 1 ]] && echo mock || echo backend)
say "Starting frontend on http://localhost:$FRONTEND_PORT (default agent: $MODE; the API/Mock toggle in the dashboard overrides it)"
say "Pages: / (landing) · /garage (dashboard) · /film (intro film)"
(cd "$ROOT/frontend" && BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" NEXT_PUBLIC_AGENT_MODE="$MODE" \
  exec node_modules/.bin/next dev --hostname 0.0.0.0 --port "$FRONTEND_PORT") &

wait -n
warn "A service stopped; shutting down the other one."
