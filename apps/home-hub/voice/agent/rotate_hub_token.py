#!/usr/bin/env python3
"""Swap the hub token the voice agent uses, without ever printing it.

    python3 rotate_hub_token.py --env-only   # copy tempo-hub/data/voice_agent.token into ../.env only
    python3 rotate_hub_token.py              # ...and update the ElevenLabs secret "tempo_hub_token"

The ElevenLabs step sends the token to ElevenLabs, so a person runs it, not an assistant.
The tool references the secret by ID, so updating the secret's value needs no tool change.
"""
import json
import sys
from pathlib import Path

import push_agent as pa

HERE = Path(__file__).resolve().parent
TOKEN_FILE = HERE.parents[1] / "data" / "voice_agent.token"


def main():
    token = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else ""
    if not token:
        sys.exit(f"No token in {TOKEN_FILE}.")
    pa.save_env_value("TEMPO_HUB_DEVICE_TOKEN", token)
    print("Saved the new hub token into tempo-hub/voice/.env.")
    if "--env-only" in sys.argv:
        return

    env = pa.read_env()
    key = env["ELEVENLABS_API_KEY"]
    name = "tempo_hub_token"
    assert name in pa.strip_comments(json.loads((HERE / "tools_config.json").read_text()))["secrets"]
    secrets = pa.call("GET", "/secrets", key).get("secrets", [])
    match = [s for s in secrets if s.get("name") == name]
    if not match:
        sys.exit(f"No ElevenLabs secret named '{name}'. Run push_tools.py instead.")
    pa.call("PATCH", f"/secrets/{match[0]['secret_id']}", key,
            {"type": "update", "name": name, "value": f"Bearer {token}"})
    print(f"Updated the ElevenLabs secret '{name}'. The ask_tempo tool now uses the new token.")


if __name__ == "__main__":
    main()
