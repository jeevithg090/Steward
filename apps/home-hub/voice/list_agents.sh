#!/usr/bin/env bash
# Lists your ElevenLabs agents (name + ID). Never prints the key.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
printf 'header = "xi-api-key: %s"\n' "$ELEVENLABS_API_KEY" \
  | curl -s -K - "https://api.elevenlabs.io/v1/convai/agents?page_size=30" \
  | python3 -c '
import json, sys
agents = json.load(sys.stdin).get("agents", [])
for a in agents:
    print(a.get("name"), a.get("agent_id"), sep="\t")
if not agents:
    print("No agents yet.")
'
