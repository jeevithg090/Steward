#!/usr/bin/env python3
"""Create/update Tempo's server tools in ElevenLabs and attach them to the agent.

    python3 push_tools.py

1. Makes sure each ElevenLabs workspace secret in tools_config.json "secrets" exists, holding
   prefix + the named .env value (e.g. "Bearer <TEMPO_HUB_DEVICE_TOKEN>"). Values are read from ../.env
   and sent only to ElevenLabs; they're never printed. Existing secrets are reused, not overwritten
   (to change a value, use rotate_hub_token.py or delete the secret in ElevenLabs first).
2. Creates or updates each webhook tool, pointing at TEMPO_PUBLIC_HUB_URL + its path.
3. Saves the tool IDs to tool_ids.json and re-pushes the agent so it uses them.

Sends credentials to ElevenLabs, so a person runs it.
"""
import json
import sys
from pathlib import Path

import push_agent as pa

HERE = Path(__file__).resolve().parent


def load_config():
    return pa.strip_comments(json.loads((HERE / "tools_config.json").read_text()))


def ensure_secrets(key, env, specs):
    existing = {s.get("name"): s["secret_id"] for s in pa.call("GET", "/secrets", key).get("secrets", [])}
    ids = {}
    for name, spec in specs.items():
        if name in existing:
            print(f"Secret '{name}' already exists; reusing it.")
            ids[name] = existing[name]
            continue
        value = env.get(spec["env"])
        if not value:
            sys.exit(f"Missing {spec['env']} in tempo-hub/voice/.env (needed for secret '{name}').")
        ids[name] = pa.call("POST", "/secrets", key,
                            {"type": "new", "name": name, "value": spec.get("prefix", "") + value})["secret_id"]
        print(f"Created secret '{name}'.")
    return ids


def tool_body(tool, base_url, secret_ids):
    t = json.loads(json.dumps(tool))
    if t["type"] != "webhook":  # client tools run in the app: no URL, no secrets
        return {"tool_config": t}
    schema = t["api_schema"]
    schema["url"] = base_url.rstrip("/") + schema.pop("path")
    headers = schema.get("request_headers", {})
    for h, v in list(headers.items()):
        if isinstance(v, str) and v.startswith("$SECRET:"):
            headers[h] = {"secret_id": secret_ids[v.split(":", 1)[1]]}
    return {"tool_config": t}


def main():
    env = pa.read_env()
    key, base_url = env.get("ELEVENLABS_API_KEY"), env.get("TEMPO_PUBLIC_HUB_URL")
    missing = [n for n in ("ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "TEMPO_PUBLIC_HUB_URL") if not env.get(n)]
    if missing:
        sys.exit("Missing in tempo-hub/voice/.env: " + ", ".join(missing))

    cfg = load_config()
    secret_ids = ensure_secrets(key, env, cfg["secrets"])

    existing = {t["tool_config"]["name"]: t["id"] for t in pa.call("GET", "/tools", key).get("tools", [])}
    ids = []
    for tool in cfg["tools"]:
        body = tool_body(tool, base_url, secret_ids)
        name = tool["name"]
        if name in existing:
            pa.call("PATCH", f"/tools/{existing[name]}", key, body)
            ids.append(existing[name])
            print(f"Updated tool '{name}'.")
        else:
            ids.append(pa.call("POST", "/tools", key, body)["id"])
            print(f"Created tool '{name}'.")

    (HERE / "tool_ids.json").write_text(json.dumps(ids, indent=2) + "\n")
    print("Attaching tools to the agent...")
    pa.main()


if __name__ == "__main__":
    main()
