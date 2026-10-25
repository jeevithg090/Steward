#!/usr/bin/env python3
"""One-command check of every hop on the phone voice path. Prints no secrets, no questions, no answers.

    python3 tempo-hub/phone/check_voice_path.py

  iPhone Safari -> ElevenLabs agent -> ask_tempo tool -> ngrok tunnel -> hub /api/ask -> local model -> spoken reply
Checks: hub, Ollama, token server, the public tunnel (and that the private parts are 404), that ngrok's request
inspector is off, Remote Login for the SSH Shortcut, then summarises the newest ElevenLabs call (did ask_tempo run).
Stdlib only.
"""
import json
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUBLIC = "https://unreleasing-laree-nebulously.ngrok-free.dev"
OK, BAD = "✅", "❌"


def get(url, timeout=6):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tempo-check"}), timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return None, b""


def line(ok, what, detail=""):
    print(f"{OK if ok else BAD} {what}" + (f"  ({detail})" if detail else ""))


def main():
    s, _ = get("http://127.0.0.1:8787/api/hello")
    line(s == 200, "Hub on this Mac (:8787)", "start it: cd tempo-hub && ./run.sh" if s != 200 else "")

    s, body = get("http://127.0.0.1:11434/api/ps")
    loaded = [m.get("name") for m in json.loads(body).get("models", [])] if s == 200 else []
    line(s == 200 and any("qwen2.5:7b" in (n or "") for n in loaded), "Local model loaded (Ollama)",
         ", ".join(loaded) or "run: cd tempo-hub && python3 scripts/model_check.py --warm")

    s, body = get("http://127.0.0.1:8788/voice/health")
    h = json.loads(body) if s == 200 else {}
    line(s == 200 and h.get("agent") and h.get("phone_key"), "Voice token server (:8788)",
         "agent + phone key set" if s == 200 else "start: oxford-model-only/tunnel/start_tunnel_with_voice.sh")

    s, _ = get(PUBLIC + "/api/hello", timeout=10)
    line(s == 200, "Public tunnel reaches the hub", PUBLIC)
    s, _ = get(PUBLIC + "/voice/", timeout=10)
    line(s == 200, "Phone page is public over https", "tunnel without /voice? run start_tunnel_with_voice.sh" if s != 200 else "")
    for path in ("/", "/api/devices", "/api/profile"):
        s, _ = get(PUBLIC + path, timeout=10)
        line(s == 404, f"Private stays private: {path} -> {s}")

    try:
        socket.create_connection(("127.0.0.1", 22), timeout=2).close()
        line(True, "Remote Login on (SSH Shortcut can reach this Mac on the same Wi-Fi)")
    except OSError:
        line(False, "Remote Login off (only needed for the SSH Shortcut)")

    # ngrok's inspector must stay off: it recorded Authorization headers and answers. Count only.
    s, body = get("http://127.0.0.1:4040/api/requests/http")
    captured = len(json.loads(body).get("requests", [])) if s == 200 else 0
    line(captured == 0, f"ngrok inspector not recording ({captured} captured)",
         "restart with start_tunnel.sh / start_tunnel_with_voice.sh (both turn it off)" if captured else "")

    last_call()


def last_call():
    """The newest ElevenLabs call: did ask_tempo run, did it fail. No transcript text is printed."""
    env = {}
    try:
        for l in (HERE.parent / "voice" / ".env").read_text().splitlines():
            k, sep, v = l.partition("=")
            if sep and not k.startswith("#"):
                env[k.strip()] = v.strip()
    except OSError:
        return
    key, agent = env.get("ELEVENLABS_API_KEY"), env.get("ELEVENLABS_AGENT_ID")
    if not (key and agent):
        return
    def el(path):
        req = urllib.request.Request("https://api.elevenlabs.io/v1/convai" + path, headers={"xi-api-key": key})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    try:
        convs = el(f"/conversations?agent_id={agent}&page_size=1").get("conversations", [])
        if not convs:
            print("\nNo ElevenLabs calls yet.")
            return
        d = el(f"/conversations/{convs[0]['conversation_id']}")
    except Exception:
        print("\n(couldn't read the last call from ElevenLabs)")
        return
    md = d.get("metadata") or {}
    calls = [c for t in d.get("transcript", []) for c in (t.get("tool_calls") or [])]
    results = [r for t in d.get("transcript", []) for r in (t.get("tool_results") or [])]
    errors = sum(1 for r in results if r.get("is_error"))
    when = time.strftime("%H:%M:%S", time.localtime(md.get("start_time_unix_secs", 0)))
    print(f"\nLast call {when}: status={d.get('status')}, {md.get('call_duration_secs')} s, "
          f"tool calls: {', '.join(c.get('tool_name', '?') for c in calls) or 'none'}, tool errors: {errors}")
    if md.get("termination_reason"):
        print(f"   ended: {md['termination_reason']}")
    print("   Full transcript (in this terminal only): python3 tempo-hub/voice/agent/last_call.py")

if __name__ == "__main__":
    main()
