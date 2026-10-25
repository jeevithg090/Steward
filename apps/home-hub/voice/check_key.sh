#!/usr/bin/env bash
# Checks the key in .env against ElevenLabs. Prints only a status, never the key.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
if [ -z "${ELEVENLABS_API_KEY:-}" ]; then echo "No key in .env yet. Run ./set_key.sh first."; exit 1; fi
# The key goes to curl on stdin, so it never shows up in the process list or shell history.
code=$(printf 'header = "xi-api-key: %s"\n' "$ELEVENLABS_API_KEY" \
  | curl -s -o /dev/null -w "%{http_code}" -K - https://api.elevenlabs.io/v1/convai/agents)
case "$code" in
  200) echo "200 OK: the key works and can reach ElevenAgents." ;;
  401) echo "401: ElevenLabs doesn't recognise this key (deleted, expired, or mistyped). Run ./set_key.sh again." ;;
  403) echo "403: the key works but lacks ElevenAgents access. Recreate it with ElevenAgents = Write." ;;
  000) echo "000: no connection to api.elevenlabs.io. Check the Wi-Fi." ;;
  *)   echo "$code: unexpected. Tell your guide this number." ;;
esac
