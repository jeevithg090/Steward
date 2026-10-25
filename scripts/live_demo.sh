#!/usr/bin/env bash
# The live GPU demo (plan.md §13, docs/gpu-demo.md): our own model on a RunPod Serverless GPU,
# the Gateway on this machine, a public tunnel to it, and the web app on Vercel pointed at it.
#
#   scripts/live_demo.sh          tunnel → Vercel deploy → Gateway (port 8100) → seed → wake the GPU
#   scripts/live_demo.sh --stop   stop the Gateway and the tunnel this script started
#
# Needs, in TEMPO_LIVE_DIR (default ../.tempo-live, outside the repo) a `.env` with:
#   RUNPOD_API_KEY=...        RunPod → Settings → API Keys
#   RUNPOD_ENDPOINT_ID=...    the Serverless endpoint running deploy/runpod/worker.gpu-demo.env
#   ELEVENLABS_API_KEY=...    optional: Tempo's real voice
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
stop_pid() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null && { pkill -TERM -P "$(cat "$1")" 2>/dev/null || true; kill -TERM "$(cat "$1")" 2>/dev/null || true; }; rm -f "$1"; }

mkdir -p "$LIVE_DIR"
LIVE_DIR="$(cd "$LIVE_DIR" && pwd)"
[ "$LIVE_DIR" != "$ROOT" ] || die "TEMPO_LIVE_DIR must not be the repo (its .env would be read)."

if [ "${1:-}" = "--stop" ]; then
  stop_pid "$LIVE_DIR/gateway.pid"
  stop_pid "$LIVE_DIR/tunnel.pid"
  say "Stopped the live Gateway and its tunnel. The Vercel site stays up but can no longer reach anything."
  exit 0
fi
[ -z "${1:-}" ] || die "unknown option '$1' (use --stop, or nothing)"

for tool in uv npx curl cloudflared openssl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed (cloudflared: brew install cloudflared)."
done
ENV_FILE="$LIVE_DIR/.env"
[ -f "$ENV_FILE" ] || die "no $ENV_FILE: put RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID there (docs/gpu-demo.md)."
grep -q '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" && die "$ENV_FILE sets DATABASE_URL; the demo must not write to a hosted database."
grep -q '^RUNPOD_API_KEY=.' "$ENV_FILE" || die "$ENV_FILE has no RUNPOD_API_KEY."
grep -q '^RUNPOD_ENDPOINT_ID=.' "$ENV_FILE" || die "$ENV_FILE has no RUNPOD_ENDPOINT_ID."
chmod 600 "$ENV_FILE"
curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1 && die "something already answers on $GATEWAY; run scripts/live_demo.sh --stop first."

# A fresh demo token per run: it ends up in the public bundle, so it must not be devtoken.
TOKEN="$(openssl rand -hex 16)"
umask 077; printf '%s\n' "$TOKEN" >"$LIVE_DIR/token"; umask 022

# 1. The tunnel: a public https address (with WebSockets) for the Gateway's port.
say "1/5 Opening a Cloudflare quick tunnel to port $PORT ..."
stop_pid "$LIVE_DIR/tunnel.pid"
: >"$LIVE_DIR/tunnel.log"
cloudflared tunnel --no-autoupdate --url "$GATEWAY" >"$LIVE_DIR/tunnel.log" 2>&1 &
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
ORIGINS="$(printf '%s\n' "$ALIASES" "$DEPLOYMENT" | grep . | sort -u | paste -sd, -),http://localhost:3000"
say "    $SITE"

# 3. The Gateway: cloud-gpu, the models live, the data recorded; WebAuthn bound to the site.
say "3/5 Starting the Gateway on $GATEWAY (models live on the RunPod GPU, data recorded) ..."
stop_pid "$LIVE_DIR/gateway.pid"
(
  cd "$LIVE_DIR"
  TEMPO_DEPLOY=cloud-gpu TEMPO_MODELS=live TEMPO_MODE=replay TEMPO_DEMO=1 PAYMENT_CHECK_AFTER_S=0 \
    TEMPO_API_TOKEN="$TOKEN" TEMPO_PORT="$PORT" WEB_ORIGINS="$ORIGINS" PUBLIC_URL="$TUNNEL" \
    MESH_RP_ID="${SITE#https://}" TEMPO_HOME="$ROOT" CHECKPOINT_DIR=checkpoints MESH_FILE=mesh.json \
    exec uv run --project "$ROOT" --no-sync tempo-gateway >"$LIVE_DIR/gw.log" 2>&1
) &
echo $! >"$LIVE_DIR/gateway.pid"
for _ in $(seq 1 60); do curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf -m 2 "$GATEWAY/health" >/dev/null 2>&1 || die "the Gateway did not start; see $LIVE_DIR/gw.log"

# 4. The demo's people.
say "4/5 Seeding Margaret, Amir and the three callers ..."
TEMPO_API_TOKEN="$TOKEN" GATEWAY_URL="$GATEWAY" uv run --project "$ROOT" --no-sync python "$ROOT/scripts/seed.py" \
  | grep -E '^(Amir|Margaret|Broadband):' || die "seeding failed"

# 5. Wake the GPU (a cold Serverless worker loads the model first), through the Gateway's own
#    model client, so this also proves the key and the endpoint.
say "5/5 Waking the GPU (a cold worker can take a few minutes the first time) ..."
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
  GPU:      RunPod Serverless endpoint $(sed -n 's/^RUNPOD_ENDPOINT_ID=//p' "$ENV_FILE")
  Stop:     scripts/live_demo.sh --stop   (then set the endpoint's active workers back to 0)
MSG
