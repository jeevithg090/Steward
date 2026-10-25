#!/usr/bin/env bash
# Restart the ONE ngrok agent that serves both the hub (POST /api/ask) and the phone page (/voice/*), so that a
# changed ngrok-voice.yml takes effect (ngrok reads the policy once, at start). The free static domain stays the
# same, so phone links and the ElevenLabs tools keep working. The tunnel is down for about 5 seconds.
#
#   oxford-model-only/tunnel/restart_voice_tunnel.sh
#
# A person runs this (Claude's auto mode isn't allowed to start ingress tunnels).
set -euo pipefail
cd "$(dirname "$0")"
LOG="$HOME/Library/Logs/tempo-ngrok.log"
BASE="$HOME/Library/Application Support/ngrok/ngrok.yml"
VOICE="$PWD/ngrok-voice.yml"
for pid in $(pgrep -x ngrok || true); do
  echo "stopping ngrok pid $pid"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  kill -0 "$pid" 2>/dev/null && { echo "ngrok pid $pid did not exit; not starting another."; exit 1; }
done
nohup /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec { "ngrok" } @ARGV or die "ngrok: $!\n"' \
  ngrok start --all --config "$BASE" --config "$VOICE" --log "$LOG" >/dev/null 2>&1 < /dev/null &
disown || true
for _ in $(seq 1 40); do
  if curl -sf -m 3 -H "ngrok-skip-browser-warning: 1" https://unreleasing-laree-nebulously.ngrok-free.dev/voice/health >/dev/null 2>&1; then
    echo "tunnel is up: https://unreleasing-laree-nebulously.ngrok-free.dev (voice page and agents reachable)"
    exit 0
  fi
  sleep 0.5
done
echo "The tunnel didn't answer within 20 s. Last log lines:"; tail -5 "$LOG"; exit 1
