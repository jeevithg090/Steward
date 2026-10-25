#!/usr/bin/env bash
# The live GPU demo (plan.md §13, docs/gpu-demo.md): our own model on a RunPod Serverless GPU,
# the Gateway on this machine, a public tunnel to it, and the web app on Vercel pointed at it.
#
#   scripts/live_demo.sh          tunnel → Vercel deploy → Gateway (port 8100) → wake the GPU → seed
#   scripts/live_demo.sh --stop   stop the Gateway and the tunnel this script started
#   scripts/live_demo.sh --restart-gateway
#                                 a clean, freshly seeded Gateway on the same tunnel and site
#                                 (after `make live-test`; clears missions and paired devices)
#
# The AI behind the jurors, small talk and photos (TEMPO_LIVE_DEPLOY, else TEMPO_DEPLOY in the .env):
#   cloud-gpu   our own model on a RunPod Serverless GPU   (needs RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID)
#   cloud-apis  Gemini and OpenRouter's free models        (needs GEMINI_API_KEY; OPENROUTER_API_KEY optional)
# Switch the running demo without touching the tunnel or the site:
#   TEMPO_LIVE_DEPLOY=cloud-apis scripts/live_demo.sh --restart-gateway     (make live-switch MODE=apis)
# The keys live in TEMPO_LIVE_DIR (default ../.tempo-live, outside the repo) in `.env`, with
# ELEVENLABS_API_KEY for Tempo's real voice.
# The keys stay on this machine: the Gateway calls RunPod and ElevenLabs; nothing secret goes to
# Vercel. The Vercel build gets only the tunnel's address and a fresh demo token, which is public
# by design (anyone with the site can drive this demo Gateway): stop it after the demo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DIR="${TEMPO_LIVE_DIR:-$ROOT/../.tempo-live}"
PORT="${TEMPO_LIVE_PORT:-8100}"
PROJECT="${TEMPO_LIVE_PROJECT:-tempo-live}"
GATEWAY="http://127.0.0.1:$PORT"

say() { printf '%s\n' "$*"; }
die() { printf 'live_demo.sh: %s\n' "$*" >&2; exit 1; }
# Stop a process this script started, and whatever it spawned (`uv run` keeps the server as its
# child). uvicorn's graceful shutdown waits for open WebSockets (the live site keeps one), so give
# it ten seconds, then force it: a lingering old Gateway would answer the new one's health check.
stop_pid() {
  local pid
  [ -f "$1" ] || return 0
  pid="$(cat "$1")"
  if kill -0 "$pid" 2>/dev/null; then
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    pkill -KILL -P "$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$1"
}

# Run a command in a session of its own, so it outlives whatever started this script (a terminal,
# make, or an agent's shell whose process group is ended when the command returns).
detached() { exec python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@"; }

# The live Gateway's port must be free before a new Gateway starts; a stray live Gateway there is
# ours (the port is the live demo's own) and is stopped, anything else is an error.
free_port() {
  local pid
  for _ in $(seq 1 20); do
    pid="$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"  # none: lsof exits 1
    [ -z "$pid" ] && return 0
    if ps -o command= -p "$pid" | grep -q 'tempo[-_]gateway'; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 0.5
      kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
    else
      die "port $PORT is held by something else: $(ps -o command= -p "$pid" | cut -c1-80)"
    fi
  done
  die "port $PORT did not come free"
}

mkdir -p "$LIVE_DIR"
LIVE_DIR="$(cd "$LIVE_DIR" && pwd)"
[ "$LIVE_DIR" != "$ROOT" ] || die "TEMPO_LIVE_DIR must not be the repo (its .env would be read)."

# Which AI: TEMPO_LIVE_DEPLOY, else the last run's (live.json), else TEMPO_DEPLOY in the .env, else the GPU.
choose_deploy() {
  local chosen="${TEMPO_LIVE_DEPLOY:-}"
  [ -n "$chosen" ] || chosen="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('deploy',''))" "$LIVE_DIR/live.json" 2>/dev/null || true)"
  [ -n "$chosen" ] || chosen="$(sed -n 's/^TEMPO_DEPLOY=//p' "$LIVE_DIR/.env" 2>/dev/null | tail -1)"
  case "${chosen:-cloud-gpu}" in
    gpu | cloud-gpu) DEPLOY=cloud-gpu ;;
    apis | cloud-apis) DEPLOY=cloud-apis ;;
    *) die "TEMPO_LIVE_DEPLOY must be cloud-gpu or cloud-apis, not '$chosen'" ;;
  esac
  case "$DEPLOY" in
    cloud-gpu)
      grep -q '^RUNPOD_API_KEY=.' "$LIVE_DIR/.env" || die "cloud-gpu needs RUNPOD_API_KEY in $LIVE_DIR/.env"
      grep -q '^RUNPOD_ENDPOINT_ID=.' "$LIVE_DIR/.env" || die "cloud-gpu needs RUNPOD_ENDPOINT_ID in $LIVE_DIR/.env" ;;
    cloud-apis)
      grep -q '^GEMINI_API_KEY=.' "$LIVE_DIR/.env" || die "cloud-apis needs GEMINI_API_KEY in $LIVE_DIR/.env" ;;
  esac
}

record_deploy() {  # remember the AI in live.json, so --restart-gateway keeps it
  python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["deploy"]=sys.argv[2]; json.dump(d, open(p, "w"), indent=2)' "$LIVE_DIR/live.json" "$DEPLOY"
}

# A cold Serverless worker loads the model before it takes a job (2 to 6 minutes), each juror gives
# up after JUROR_TIMEOUT_S, and with RunPod's default 5 s idle timeout a warm worker soon leaves:
# so on cloud-gpu the GPU answers just before anything is seeded. The key goes to curl on stdin.
wake_gpu() {
  [ "$DEPLOY" = "cloud-gpu" ] || return 0
  local id started body
  id="$(sed -n 's/^RUNPOD_ENDPOINT_ID=//p' "$LIVE_DIR/.env" | tail -1)"
  { grep -q '^RUNPOD_API_KEY=.' "$LIVE_DIR/.env" && [ -n "$id" ]; } \
    || die "cloud-gpu needs RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in $LIVE_DIR/.env"
  say "    Waking the GPU first (a cold worker loads the model; up to 15 minutes) ..."
  started=$(date +%s)
  while [ $(( $(date +%s) - started )) -lt 900 ]; do
    body="$(sed -n 's/^RUNPOD_API_KEY=\(.*\)$/header = "Authorization: Bearer \1"/p' "$LIVE_DIR/.env" | tail -1 \
      | curl -s -m 300 -K - -H 'Content-Type: application/json' \
          "https://api.runpod.ai/v2/$id/openai/v1/chat/completions" \
          -d '{"model":"tempo-private","messages":[{"role":"user","content":"Say ok."}],"max_tokens":3}' \
      || true)"
    case "$body" in *'"choices"'*) say "    The GPU answered after $(( $(date +%s) - started )) s"; return 0 ;; esac
    sleep 5
  done
  die "the GPU did not answer in 15 minutes; see the RunPod console (endpoint $id)"
}

ensure_vapid() {  # $1 site. Web Push needs a VAPID key pair: made once, kept in the private .env
  grep -q '^VAPID_PRIVATE_KEY=.' "$LIVE_DIR/.env" && return 0
  uv run --project "$ROOT" --no-sync python "$ROOT/scripts/gen_vapid.py" >>"$LIVE_DIR/.env"
  printf 'VAPID_SUBJECT=%s\n' "$1" >>"$LIVE_DIR/.env"
  chmod 600 "$LIVE_DIR/.env"
}

start_gateway() {  # $1 token, $2 tunnel, $3 site, $4 origins
  ensure_vapid "$3"
  # The site first: the pairing QR and Face ID use the first origin, and a per-deploy URL sits
  # behind Vercel's login.
  local origins
  origins="$(printf '%s\n' "$3" "$(printf '%s' "$4" | tr ',' '\n' | grep -vxF "$3")" | grep . | paste -sd, -)"
  stop_pid "$LIVE_DIR/gateway.pid"
  free_port
  rm -rf "$LIVE_DIR/checkpoints" "$LIVE_DIR/mesh.json" "$LIVE_DIR/missions.json"
  (
    cd "$LIVE_DIR"
    TEMPO_DEPLOY="$DEPLOY" TEMPO_MODELS=live TEMPO_MODE=replay TEMPO_DEMO=1 PAYMENT_CHECK_AFTER_S=0 \
      TEMPO_API_TOKEN="$1" TEMPO_PORT="$PORT" WEB_ORIGINS="$origins" PUBLIC_URL="$2" \
      MESH_RP_ID="${3#https://}" TEMPO_HOME="$ROOT" CHECKPOINT_DIR=checkpoints MESH_FILE=mesh.json \
      detached uv run --project "$ROOT" --no-sync tempo-gateway >"$LIVE_DIR/gw.log" 2>&1
  ) &
  echo $! >"$LIVE_DIR/gateway.pid"
  for _ in $(seq 1 60); do curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1 || die "the Gateway did not start; see $LIVE_DIR/gw.log"
  wake_gpu  # last, so the seeded courts follow the GPU's answer within a second or two
  TEMPO_API_TOKEN="$1" GATEWAY_URL="$GATEWAY" uv run --project "$ROOT" --no-sync python "$ROOT/scripts/seed.py" \
    | grep -E '^(Amir|Margaret|Broadband):' || die "seeding failed"
}

field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$LIVE_DIR/live.json" "$1"; }

if [ "${1:-}" = "--restart-gateway" ]; then
  { [ -f "$LIVE_DIR/live.json" ] && [ -f "$LIVE_DIR/token" ]; } || die "no live demo has run yet (no $LIVE_DIR/live.json); run make live-demo"
  choose_deploy
  say "Restarting the live Gateway ($DEPLOY) with a clean, seeded state (same tunnel, site and token) ..."
  start_gateway "$(cat "$LIVE_DIR/token")" "$(field tunnel)" "$(field site)" "$(field origins)"
  record_deploy
  say "Ready: $(field site)  (AI: $DEPLOY)"
  exit 0
fi

if [ "${1:-}" = "--stop" ]; then
  stop_pid "$LIVE_DIR/gateway.pid"
  stop_pid "$LIVE_DIR/tunnel.pid"
  say "Stopped the live Gateway and its tunnel. The Vercel site stays up but can no longer reach anything."
  exit 0
fi
[ -z "${1:-}" ] || die "unknown option '$1' (use --stop, --restart-gateway, or nothing)"

for tool in uv npx curl cloudflared openssl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed (cloudflared: brew install cloudflared)."
done
ENV_FILE="$LIVE_DIR/.env"
[ -f "$ENV_FILE" ] || die "no $ENV_FILE: put RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID there (docs/gpu-demo.md)."
grep -q '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" && die "$ENV_FILE sets DATABASE_URL; the demo must not write to a hosted database."
choose_deploy
chmod 600 "$ENV_FILE"
curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1 && die "something already answers on $GATEWAY; run scripts/live_demo.sh --stop first."

# A fresh demo token per run: it ends up in the public bundle, so it must not be devtoken.
TOKEN="$(openssl rand -hex 16)"
umask 077; printf '%s\n' "$TOKEN" >"$LIVE_DIR/token"; umask 022

# 1. The tunnel: a public https address (with WebSockets) for the Gateway's port.
say "1/5 Opening a Cloudflare quick tunnel to port $PORT ..."
stop_pid "$LIVE_DIR/tunnel.pid"
: >"$LIVE_DIR/tunnel.log"
(detached cloudflared tunnel --no-autoupdate --url "$GATEWAY" >"$LIVE_DIR/tunnel.log" 2>&1) &
echo $! >"$LIVE_DIR/tunnel.pid"
TUNNEL=""
for _ in $(seq 1 60); do
  TUNNEL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LIVE_DIR/tunnel.log" | head -1 || true)"
  [ -n "$TUNNEL" ] && break
  sleep 1
done
[ -n "$TUNNEL" ] || die "the tunnel gave no address in 60 s; see $LIVE_DIR/tunnel.log"
say "    $TUNNEL"

# 2. The web app on Vercel, built against the tunnel (a separate project from the showcase).
say "2/5 Deploying the web app to Vercel project '$PROJECT' ..."
DEPLOY_LOG="$LIVE_DIR/vercel.log"
(cd "$ROOT/apps/web" && npx --yes vercel deploy --prod --yes --project "$PROJECT" --create-if-missing \
  --build-env "VITE_GATEWAY_URL=$TUNNEL" --build-env "VITE_TEMPO_TOKEN=$TOKEN" --build-env "VITE_TEMPO_SHOWCASE=0") \
  >"$DEPLOY_LOG" 2>&1 || die "Vercel deploy failed; see $DEPLOY_LOG"
DEPLOYMENT="$(grep -oE "https://$PROJECT-[a-z0-9]+-[a-z0-9-]+\.vercel\.app" "$DEPLOY_LOG" | head -1 || true)"
[ -n "$DEPLOYMENT" ] || die "no deployment URL in $DEPLOY_LOG"
ALIASES="$(cd "$ROOT/apps/web" && npx --yes vercel inspect "$DEPLOYMENT" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | grep -v "$DEPLOYMENT" | sort -u || true)"
SITE="$(printf '%s\n' "$ALIASES" | awk 'length { print length, $0 }' | sort -n | head -1 | cut -d' ' -f2)"
SITE="${SITE:-$DEPLOYMENT}"
ORIGINS="$(printf '%s\n' "$SITE" "$ALIASES" "$DEPLOYMENT" | grep . | awk '!seen[$0]++' | paste -sd, -),http://localhost:3000"
say "    $SITE"

# The run's facts, for `make live-test` and --restart-gateway (no secrets: the token has its own file).
python3 -c 'import json, sys
path, site, tunnel, origins, port, project, deployment = sys.argv[1:]
json.dump({"site": site, "tunnel": tunnel, "origins": origins, "port": int(port), "project": project,
           "deployment": deployment, "gateway": "http://127.0.0.1:" + port}, open(path, "w"), indent=2)' \
  "$LIVE_DIR/live.json" "$SITE" "$TUNNEL" "$ORIGINS" "$PORT" "$PROJECT" "$DEPLOYMENT"

# 3 and 4. The Gateway (cloud-gpu, the models live, the data recorded; WebAuthn bound to the
# site), then the demo's people.
say "3/5 Starting the Gateway on $GATEWAY ($DEPLOY: the models live, the data recorded) ..."
say "4/5 ... and seeding Margaret, Amir and the three callers"
start_gateway "$TOKEN" "$TUNNEL" "$SITE" "$ORIGINS"
record_deploy

# 5. Wake the GPU (a cold Serverless worker loads the model first), through the Gateway's own
#    model client, so this also proves the key and the endpoint.
say "5/5 Asking the model once (a cold GPU worker can take a few minutes the first time) ..."
started=$(date +%s)
woke="$(curl -s -m 600 -X POST "$GATEWAY/chat" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"user_id":"u_warmup","text":"hello"}' | python3 -c 'import json,sys; print(json.load(sys.stdin).get("reply",""))' 2>/dev/null || true)"
health="$(curl -s -m 5 "$GATEWAY/health")"
say "    $(( $(date +%s) - started )) s; the model said: ${woke:-nothing (see $LIVE_DIR/gw.log)}"
say "    /health: $(printf '%s' "$health" | python3 -c 'import json,sys; h=json.load(sys.stdin); print("simulated:", ", ".join(h["simulated"]), "| model:", (h.get("model") or {}).get("processor", "none"))')"

cat <<MSG

Tempo, live
  Open:     $SITE
  Gateway:  $TUNNEL  (this machine, port $PORT; log $LIVE_DIR/gw.log)
  AI:       $DEPLOY  (switch: TEMPO_LIVE_DEPLOY=cloud-apis scripts/live_demo.sh --restart-gateway)
  Stop:     scripts/live_demo.sh --stop   (on the GPU, also set the endpoint's active workers to 0)
MSG
