#!/usr/bin/env python3
"""Create or update Tempo's ElevenLabs agent from the files in this folder.

    python3 push_agent.py            # create (first run) or update (later runs)
    python3 push_agent.py --show     # print the live settings, change nothing
    python3 push_agent.py --dry-run  # print what would be sent, send nothing

Reads ELEVENLABS_API_KEY from ../.env and never prints it. On first run it saves
the new agent's ID into ../.env as ELEVENLABS_AGENT_ID (the ID is not a secret).
Only the standard library is used, so no install is needed.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"
API = "https://api.elevenlabs.io/v1/convai"


def read_env():
    env = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def save_env_value(name, value):
    lines = ENV.read_text().splitlines()
    out, done = [], False
    for line in lines:
        if line.startswith(name + "="):
            out.append(f"{name}={value}")
            done = True
        else:
            out.append(line)
    if not done:
        out.append(f"{name}={value}")
    tmp = ENV.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(ENV)


def strip_comments(obj):
    if isinstance(obj, dict):
        return {k: strip_comments(v) for k, v in obj.items() if not k.startswith("_")}
    return obj


def build_body():
    body = strip_comments(json.loads((HERE / "agent_config.json").read_text()))
    agent = body["conversation_config"]["agent"]
    agent["first_message"] = (HERE / "first_message.txt").read_text().strip()
    agent["prompt"]["prompt"] = (HERE / "system_prompt.md").read_text().strip()
    tool_ids = HERE / "tool_ids.json"  # written by push_tools.py
    if tool_ids.exists():
        agent["prompt"]["tool_ids"] = json.loads(tool_ids.read_text())
    return body


def call(method, path, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("xi-api-key", key)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:2000]
        sys.exit(f"ElevenLabs said {e.code} for {method} {path}:\n{detail}")


def summary(a):
    cc = a.get("conversation_config", {})
    ag, tts, turn = cc.get("agent", {}), cc.get("tts", {}), cc.get("turn", {})
    pr = ag.get("prompt", {})
    ps = a.get("platform_settings", {})
    priv, auth = ps.get("privacy", {}), ps.get("auth", {})
    tools = [k for k, v in (pr.get("built_in_tools") or {}).items() if v]
    rows = [
        ("Name", a.get("name")),
        ("Agent ID", a.get("agent_id")),
        ("LLM (brain)", pr.get("llm")),
        ("Voice model", tts.get("model_id")),
        ("Voice ID", tts.get("voice_id")),
        ("Main language", ag.get("language")),
        ("Extra languages", ", ".join((cc.get("language_presets") or {}).keys()) or "none"),
        ("System tools", ", ".join(tools) or "none"),
        ("Server tools", ", ".join(pr.get("tool_ids") or []) or "none"),
        ("Turn eagerness", turn.get("turn_eagerness")),
        ("Turn timeout (s)", turn.get("turn_timeout")),
        ("Max call length (s)", cc.get("conversation", {}).get("max_duration_seconds")),
        ("Save call audio", priv.get("record_voice")),
        ("Keep conversations (days)", priv.get("retention_days")),
        ("Authentication on", auth.get("enable_auth")),
        ("First message", (ag.get("first_message") or "")[:70] + "..."),
    ]
    width = max(len(r[0]) for r in rows)
    for k, v in rows:
        print(f"  {k.ljust(width)}  {v}")


def main():
    env = read_env()
    key = env.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("No ELEVENLABS_API_KEY in tempo-hub/voice/.env. Run ../set_key.sh first.")
    agent_id = env.get("ELEVENLABS_AGENT_ID")

    if "--show" in sys.argv:
        if not agent_id:
            sys.exit("No ELEVENLABS_AGENT_ID yet. Run without --show to create the agent.")
        summary(call("GET", f"/agents/{agent_id}", key))
        return

    body = build_body()
    if "--dry-run" in sys.argv:
        print(json.dumps(body, indent=2))
        return

    if agent_id:
        call("PATCH", f"/agents/{agent_id}", key, body)
        print(f"Updated agent {agent_id}.")
    else:
        agent_id = call("POST", "/agents/create", key, body)["agent_id"]
        save_env_value("ELEVENLABS_AGENT_ID", agent_id)
        print(f"Created agent {agent_id} and saved its ID to tempo-hub/voice/.env.")
    print("Live settings now:")
    summary(call("GET", f"/agents/{agent_id}", key))


if __name__ == "__main__":
    main()
