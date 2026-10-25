#!/usr/bin/env bash
# One command for the demo (plan.md §6; the long form is docs/demo.md): the Gateway from a
# scratch folder, seeded with the demo's people, and the web app on http://localhost:3000.
#
#   scripts/demo.sh                  Gateway + seed + web app; Ctrl-C stops both
#   scripts/demo.sh --gateway-only   Gateway + seed, left running; --stop ends it
#   scripts/demo.sh --stop           stop the Gateway this script started
#
# The Gateway is started from TEMPO_DEMO_DIR (default: ../.tempo-demo, next to the repo), never
# from inside the repo: it reads `.env` from its working directory, and the repo's `.env` may
# point DATABASE_URL at a hosted database. A Gateway that already answers on the port is reused
# and is never stopped by this script.
#
# TEMPO_DEMO_PORT (default 8000). On 8000 the Gateway is `tempo-gateway` (tempo_gateway.main:run:
# 127.0.0.1:8000 with the 30-second scheduler, as in production). Any other port runs
# `uvicorn tempo_gateway.main:build --factory`, which has no scheduler: the Watchdog's timers fire
# only when something calls POST /scheduler/tick (Mission Control's "Check the payment now" does).
# Use another port only to run beside a demo that already holds 8000; the web app is then started
# with VITE_GATEWAY_URL pointing at it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="${TEMPO_DEMO_DIR:-$ROOT/../.tempo-demo}"
PORT="${TEMPO_DEMO_PORT:-8000}"
TOKEN="${TEMPO_API_TOKEN:-devtoken}"
GATEWAY="http://127.0.0.1:$PORT"
WEB="http://localhost:3000"

usage() {
  cat <<EOF
Usage: scripts/demo.sh [--gateway-only | --stop | --help]

  (no option)      Gateway from a scratch folder, seeded, then the web app on $WEB (Ctrl-C stops both)
  --gateway-only   Gateway + seed only, left running; stop it later with --stop
  --stop           stop the Gateway this script started (reads $DEMO_DIR/gateway.pid)

Environment: TEMPO_DEMO_DIR (default ../.tempo-demo), TEMPO_DEMO_PORT (default 8000),
TEMPO_API_TOKEN (default devtoken). Never starts the Gateway from inside the repo.
EOF
}

MODE=full
case "${1:-}" in
  "") ;;
  --gateway-only) MODE=gateway ;;
  --stop) MODE=stop ;;
  -h | --help) usage; exit 0 ;;
  *) echo "demo.sh: unknown option '$1'" >&2; usage >&2; exit 2 ;;
esac

say() { printf '%s\n' "$*"; }
die() { printf 'demo.sh: %s\n' "$*" >&2; exit 1; }
healthy() { curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1; }

# End a process and whatever it spawned (`uv run` keeps the server as its child).
stop_tree() {
  local pid="$1"
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
}

mkdir -p "$DEMO_DIR"
DEMO_DIR="$(cd "$DEMO_DIR" && pwd)"
PID_FILE="$DEMO_DIR/gateway.pid"
LOG="$DEMO_DIR/gw.log"
[ "$DEMO_DIR" != "$ROOT" ] || die "TEMPO_DEMO_DIR must not be the repo itself (its .env would be read)."

if [ "$MODE" = stop ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    pid="$(cat "$PID_FILE")"
    stop_tree "$pid"
    say "Stopped the Gateway this script started (PID $pid)."
  else
    say "No Gateway started by this script is running (nothing live in $PID_FILE)."
  fi
  rm -f "$PID_FILE"
  exit 0
fi

for tool in uv npm curl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed; the demo needs uv, npm and curl."
done
[ -d "$ROOT/.venv" ] || die "no .venv in $ROOT; run 'make setup' (or 'uv sync') once first."
[ ! -e "$DEMO_DIR/.env" ] || say "Warning: $DEMO_DIR/.env exists and the Gateway will read it."

STARTED=0
GW_PID=""
cleanup() {
  if [ "$STARTED" = 1 ] && [ -n "$GW_PID" ]; then
    if kill -0 "$GW_PID" 2>/dev/null; then
      stop_tree "$GW_PID"
      say "Stopped the Gateway (PID $GW_PID)."
    fi
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if healthy; then
  say "A Gateway already answers at $GATEWAY/health: using it (this script will not stop it)."
else
  if [ -f "$PID_FILE" ] && ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then rm -f "$PID_FILE"; fi
  if [ "$PORT" = 8000 ]; then
    CMD=(uv run --project "$ROOT" --no-sync tempo-gateway)
  else
    CMD=(uv run --project "$ROOT" --no-sync uvicorn tempo_gateway.main:build --factory --host 127.0.0.1 --port "$PORT")
  fi
  say "Starting the Gateway from $DEMO_DIR (no .env there) on $GATEWAY; log: $LOG"
  (
    cd "$DEMO_DIR"
    TEMPO_API_TOKEN="$TOKEN" TEMPO_DEMO=1 TEMPO_MODE=replay PAYMENT_CHECK_AFTER_S=0 \
      WEB_ORIGINS="http://localhost:3000,http://127.0.0.1:3000" TEMPO_HOME="$ROOT" \
      CHECKPOINT_DIR=checkpoints MESH_FILE=mesh.json \
      exec "${CMD[@]}" >"$LOG" 2>&1
  ) &
  GW_PID=$!
  STARTED=1
  echo "$GW_PID" >"$PID_FILE"
  for _ in $(seq 1 60); do
    healthy && break
    kill -0 "$GW_PID" 2>/dev/null || { tail -n 20 "$LOG" >&2; die "the Gateway exited; see $LOG"; }
    sleep 1
  done
  healthy || { tail -n 20 "$LOG" >&2; die "no answer from $GATEWAY/health after 60 s; see $LOG"; }
  say "The Gateway is up (PID $GW_PID)."
fi

# Is a reused Gateway already seeded? (Seeding twice would duplicate the demo's missions.)
seeded_state() {
  local out code body
  out="$(curl -s -m 5 -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$GATEWAY/missions" 2>/dev/null)" || { echo unknown; return; }
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  case "$code" in
    200) if [ "$(printf '%s' "$body" | tr -d '[:space:]')" = "[]" ]; then echo empty; else echo seeded; fi ;;
    401 | 403) echo denied ;;
    *) echo unknown ;;
  esac
}

seed() {
  say "Seeding the demo's people (scripts/seed.py: Amir paid; Margaret's claim and broadband case waiting; her memories; three callers) ..."
  (cd "$DEMO_DIR" && TEMPO_API_TOKEN="$TOKEN" GATEWAY_URL="$GATEWAY" uv run --project "$ROOT" --no-sync python "$ROOT/scripts/seed.py")
}

if [ "$STARTED" = 1 ]; then
  seed
else
  case "$(seeded_state)" in
    seeded) say "That Gateway already has missions: not seeding it again." ;;
    denied) say "That Gateway refuses the token '$TOKEN' (set TEMPO_API_TOKEN to its token): not seeding; the web app will not reach it either." ;;
    *) seed ;;
  esac
fi

say ""
say "Tempo demo"
say "  Gateway  $GATEWAY   (health: $GATEWAY/health; bearer: $TOKEN)"
if [ "$MODE" = gateway ]; then
  say "  Web app  not started (--gateway-only): 'cd apps/web && npm run dev' puts it on $WEB"
else
  say "  Web app  $WEB   (the chat is the front door; every page is in the sidebar)"
fi
say ""
say "The beats (plan.md §6; docs/demo.md has the long form):"
say "   1. Type: my 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40"
say "   2. Yes: Tempo asked once, with the Proof Trace and the Court's votes inline"
say "   3. Mission Control: Check the payment now"
say "   4. Money arrived; the ledger ticks"
say "   5. Ask: what do you remember?"
say "   6. Paste the HMRC text: Tempo warns"
say "   7. Read this letter: the sample letter, what it says, what to do by when"
say "   8. The broadband card: waiting on purpose, then jump the clock 31 days"
say "   9. The Passport card on the mission"
say "  10. Who's calling? Margaret, Dilip and Joan"
say ""

if [ "$MODE" = gateway ]; then
  if [ "$STARTED" = 1 ]; then
    say "The Gateway keeps running (PID $GW_PID; $PID_FILE). Stop it with: scripts/demo.sh --stop"
    trap - EXIT # leave it running
  fi
  exit 0
fi

cd "$ROOT/apps/web"
if [ ! -d node_modules ]; then
  say "Installing the web app's dependencies (npm ci) ..."
  npm ci
fi
if [ "$STARTED" = 1 ]; then
  say "Starting the web app on $WEB; Ctrl-C stops it and the Gateway."
else
  say "Starting the web app on $WEB; Ctrl-C stops it (the Gateway you already had stays up)."
fi
VITE_GATEWAY_URL="$GATEWAY" VITE_TEMPO_TOKEN="$TOKEN" npm run dev
