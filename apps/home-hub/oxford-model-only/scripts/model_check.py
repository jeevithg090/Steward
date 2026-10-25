#!/usr/bin/env python3
"""Is the local model ready for Tempo? One command, green/red answer.

    python3 scripts/model_check.py           # check only
    python3 scripts/model_check.py --warm    # load the model first and pin it in memory (keep_alive -1)

Checks: Ollama answers, the model is downloaded and loaded, a first token comes back fast, an
OpenAI-format tool call round trip works (the same endpoint the hub uses), the hub's /api/ask answers
with the model rather than its fallback, whether anything restarts Ollama by itself, and that Ollama is
not reachable from the Wi-Fi. Stdlib only. Exit code 0 when nothing is red. See MODEL.md.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

TOKEN_CACHE = os.path.expanduser("~/.cache/tempo/model-check-token")
COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
MARK = {"ok": ("\033[32m", "PASS"), "warn": ("\033[33m", "WARN"), "fail": ("\033[31m", "FAIL")}
results: list[tuple[str, str]] = []


def report(status: str, name: str, detail: str = "") -> bool:
    color, word = MARK[status]
    tag = f"{color}{word}\033[0m" if COLOR else word
    print(f"  {tag}  {name}" + (f" - {detail}" if detail else ""), flush=True)
    results.append((status, name))
    return status == "ok"


def http(method: str, url: str, body=None, token: str = "", timeout: float = 30):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def first_token_seconds(ollama: str, model: str, keep_alive) -> float:
    body = {"model": model, "stream": True, "messages": [{"role": "user", "content": "Reply with the word OK."}],
            "options": {"temperature": 0, "num_predict": 5}}
    if keep_alive is not None:
        body["keep_alive"] = keep_alive
    req = urllib.request.Request(f"{ollama}/api/chat", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=180) as r:
        for line in r:
            if line.strip() and json.loads(line).get("message", {}).get("content"):
                return time.perf_counter() - t0
    raise RuntimeError("no tokens came back")


def tool_round_trip(ollama: str, model: str, keep_alive) -> tuple[str, float]:
    tools = [{"type": "function", "function": {
        "name": "get_device_status", "description": "List the user's devices and when each last synced.",
        "parameters": {"type": "object", "properties": {}}}}]
    messages = [{"role": "system", "content": "You are Tempo. Use the tools to look things up."},
                {"role": "user", "content": "Which of my devices synced recently?"}]
    extra = {"keep_alive": keep_alive} if keep_alive is not None else {}
    t0 = time.perf_counter()
    msg = http("POST", f"{ollama}/v1/chat/completions", {"model": model, "messages": messages, "tools": tools,
                                                         "temperature": 0, "max_tokens": 200, **extra},
               timeout=120)["choices"][0]["message"]
    calls = msg.get("tool_calls") or []
    if not calls or calls[0].get("function", {}).get("name") != "get_device_status":
        raise RuntimeError(f"model did not call the tool (said: {(msg.get('content') or '')[:80]!r})")
    messages += [{"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls},
                 {"role": "tool", "tool_call_id": calls[0].get("id", ""),
                  "content": json.dumps({"devices": [{"name": "Pixel 8", "last_seen": "2 minutes ago"}]})}]
    final = http("POST", f"{ollama}/v1/chat/completions", {"model": model, "messages": messages, "tools": tools,
                                                           "temperature": 0, "max_tokens": 200, **extra},
                 timeout=120)["choices"][0]["message"].get("content") or ""
    if "pixel" not in final.lower():
        raise RuntimeError(f"answer ignored the tool result: {final[:80]!r}")
    return final.strip().replace("\n", " "), time.perf_counter() - t0


def hub_token(hub: str, explicit: str) -> str:
    if explicit:
        return explicit
    try:
        with open(TOKEN_CACHE) as f:
            tok = f.read().strip()
        http("GET", f"{hub}/api/me", token=tok, timeout=5)
        return tok
    except (OSError, urllib.error.HTTPError):
        pass
    # Never self-register: a device joined from this computer gets full access, but this check only needs
    # to ask. An ask-only token comes from the hub owner's CLI instead.
    raise RuntimeError("no working hub token. Make an ask-only one (written with mode 600, never printed): "
                       "tempo-hub/.venv/bin/python tempo-hub/scripts/device_admin.py add-agent "
                       f"--name model-check --token-file {TOKEN_CACHE}")


def supervisor() -> str:
    uid = os.getuid()
    for label in ("org.tempo.ollama", "sh.brew.ollama", "com.ollama.ollama"):
        p = subprocess.run(["launchctl", "print", f"gui/{uid}/{label}"], capture_output=True, text=True)
        if p.returncode == 0:
            return label
    return ""


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--warm", action="store_true", help="load the model and pin it in memory before checking")
    ap.add_argument("--model", default=os.environ.get("TEMPO_LLM_MODEL", "qwen2.5:7b"))
    base = os.environ.get("TEMPO_LLM_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
    ap.add_argument("--ollama", default=base[:-3] if base.endswith("/v1") else base)
    ap.add_argument("--hub", default=os.environ.get("TEMPO_HUB", "http://127.0.0.1:8787"))
    ap.add_argument("--token", default=os.environ.get("TEMPO_TOKEN", ""), help="hub device token (optional)")
    ap.add_argument("--no-hub", action="store_true", help="skip the hub /api/ask check")
    a = ap.parse_args()
    ollama, model = a.ollama.rstrip("/"), a.model
    keep = -1 if a.warm else None
    print(f"Tempo model check: {model} at {ollama}  ({time.strftime('%a %d %b %H:%M:%S %Z')})")

    try:
        ver = http("GET", f"{ollama}/api/version", timeout=3)["version"]
        report("ok", "Ollama running", f"version {ver}")
    except Exception as e:
        report("fail", "Ollama running", f"{type(e).__name__}: {e}. Start it: see MODEL.md 'Emergency checklist'")
        return summary()

    try:
        names = [m["name"] for m in http("GET", f"{ollama}/api/tags", timeout=5).get("models", [])]
        if not report("ok" if model in names else "fail", "Model downloaded",
                      model if model in names else f"missing; run: ollama pull {model}"):
            return summary()
    except Exception as e:
        report("fail", "Model downloaded", str(e))
        return summary()

    if a.warm:
        t0 = time.perf_counter()
        try:
            http("POST", f"{ollama}/api/generate", {"model": model, "keep_alive": -1}, timeout=300)
            report("ok", "Warm-up", f"loaded and pinned in {time.perf_counter() - t0:.1f}s")
        except Exception as e:
            report("fail", "Warm-up", str(e))

    loaded = {m["name"]: m for m in http("GET", f"{ollama}/api/ps", timeout=5).get("models", [])}
    if model in loaded:
        until = loaded[model].get("expires_at", "")
        pinned = until[:4].isdigit() and int(until[:4]) > 2100
        report("ok" if pinned else "warn", "Model loaded in memory",
               ("pinned (keep_alive -1)" if pinned else f"unloads at {until[:19]}; run with --warm to pin")
               + f", ctx {loaded[model].get('context_length', '?')}"
               + (f"; also loaded: {', '.join(n for n in loaded if n != model)}" if len(loaded) > 1 else ""))
    else:
        others = f" (loaded instead: {', '.join(loaded)})" if loaded else ""
        report("warn", "Model loaded in memory", f"not loaded{others}; first answer will be slower. Use --warm")

    try:
        s = first_token_seconds(ollama, model, keep)
        report("ok" if s < 1.0 else "warn", "First token", f"{s * 1000:.0f} ms" + ("" if s < 1.0 else " (was cold)"))
    except Exception as e:
        report("fail", "First token", str(e))

    try:
        answer, s = tool_round_trip(ollama, model, keep)
        report("ok", "Tool-call round trip", f"{s:.1f}s, said: {answer[:70]}")
    except Exception as e:
        report("fail", "Tool-call round trip", str(e))

    if not a.no_hub:
        try:
            tok = hub_token(a.hub, a.token)
            t0 = time.perf_counter()
            r = http("POST", f"{a.hub}/api/ask", {"question": "Which devices are syncing?"}, token=tok, timeout=120)
            s = time.perf_counter() - t0
            if r.get("model"):
                report("ok" if r["model"] == model else "warn", "Hub /api/ask uses the model",
                       f"model={r['model']}, {s:.1f}s, tools={r.get('tools_used')}")
            else:
                report("fail", "Hub /api/ask uses the model", f"fell back ({r.get('note', 'model=null')}) after {s:.1f}s")
        except RuntimeError as e:
            report("fail", "Hub /api/ask uses the model", str(e))
        except Exception as e:
            report("fail", "Hub /api/ask uses the model", f"hub not reachable at {a.hub}: {e}")

    sup = supervisor()
    report("ok" if sup else "warn", "Auto-restart",
           f"launchd job {sup}" if sup else "nothing restarts Ollama if it dies or the Mac reboots (MODEL.md)")

    ip = lan_ip()
    if ip:
        try:
            socket.create_connection((ip, int(ollama.rsplit(":", 1)[-1].split("/")[0])), timeout=1).close()
            report("warn", "Not exposed to Wi-Fi", f"Ollama answers on {ip}: anyone on this network can use it")
        except (OSError, ValueError):
            report("ok", "Not exposed to Wi-Fi", f"loopback only (closed on {ip})")
    return summary()


def summary() -> int:
    fails = [n for s, n in results if s == "fail"]
    warns = [n for s, n in results if s == "warn"]
    if fails:
        line, color = f"NOT READY: {', '.join(fails)}", "\033[31m"
    elif warns:
        line, color = f"READY, with warnings: {', '.join(warns)}", "\033[33m"
    else:
        line, color = "READY: all green", "\033[32m"
    print(f"{color}{line}\033[0m" if COLOR else line)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
