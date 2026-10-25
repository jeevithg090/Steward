#!/usr/bin/env bash
# Restart the Tempo tunnel so it ALSO serves the phone voice page (/voice/ -> token_server.py on :8788).
# Same public URL as start_tunnel.sh, so the ElevenLabs tool keeps working; it is down for ~3 seconds.
# Safety net: if the new tunnel doesn't come up on the static domain, or ngrok's request inspector is
# recording (it captured Authorization headers before), it is stopped and the plain tunnel is restored.
# Go back to the voice-less tunnel by hand with:  pkill -f "ngrok start" ; ./start_tunnel.sh
set -euo pipefail
cd "$(dirname "$0")"
VOICE="$(cd ../../tempo-hub/voice && pwd)"
URL=https://unreleasing-laree-nebulously.ngrok-free.dev

restore() {
  echo "✗ $1 Restoring the plain tunnel (no voice page)."
  pkill -f "ngrok start --all --config" 2>/dev/null || true
  sleep 1
  ./start_tunnel.sh || true
  exit 1
}

# 1. Token server (page + tokens) on 127.0.0.1:8788, detached.
if ! curl -sf -m 2 http://127.0.0.1:8788/voice/health >/dev/null; then
  nohup /usr/bin/python3 "$VOICE/token_server.py" >> "$HOME/Library/Logs/tempo-voice-token.log" 2>&1 < /dev/null &
  disown || true
  sleep 1
fi

# 2. Replace the running tunnel with the two-endpoint one (inspector off: agent.inspect_db_size -1).
pkill -f "ngrok http 8787" 2>/dev/null || true
pkill -f "ngrok start --all --config" 2>/dev/null || true
sleep 1
nohup ngrok start --all --config "$HOME/Library/Application Support/ngrok/ngrok.yml" --config "$PWD/ngrok-voice.yml" \
  --log "$HOME/Library/Logs/tempo-ngrok.log" >/dev/null 2>&1 < /dev/null &
disown || true

up=""
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' $URL/api/hello)" = "200" ] && { up=1; break; }
  sleep 0.5
done
[ -n "$up" ] || restore "The voice tunnel didn't come up on $URL (check ~/Library/Logs/tempo-ngrok.log)."

# 3. The inspector must not be recording. Prints only a count, never a request.
captured=$(curl -s -m 2 http://127.0.0.1:4040/api/requests/http 2>/dev/null \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("requests", [])))' 2>/dev/null || echo 0)
[ "$captured" = "0" ] || restore "ngrok's inspector recorded $captured request(s); it must be off."

printf '✓ hello: %s   voice page: %s   web app (should be 404): %s   inspector captures: %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' $URL/api/hello)" \
  "$(curl -s -o /dev/null -w '%{http_code}' $URL/voice/)" \
  "$(curl -s -o /dev/null -w '%{http_code}' $URL/)" "$captured"
echo "Phone link: python3 $VOICE/token_server.py --link   (copies it to the clipboard, never prints it)"
