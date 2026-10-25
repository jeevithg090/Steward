#!/usr/bin/env python3
"""Conductor: splits one request into up to 5 agents and runs them in parallel across the user's devices.

    python3 hands/conductor.py "check the weather, my laptop battery, and whether my train was late"

  1. The brain splits the request into independent sub-tasks, each with a device (Gemini when a key is found,
     as for the phone agent: TEMPO_CONDUCTOR_BRAIN, else TEMPO_PHONE_BRAIN = gemini | ollama; GEMINI_CONDUCTOR_MODEL,
     else GEMINI_PHONE_MODEL; the local model when Gemini isn't set up or fails):
       hub    - questions about the user's own data in the Tempo hub (trains, notifications, devices, ...)
       laptop - this Mac (hands/laptop_agent.py: files, apps, status)
       phone  - the iPhone (phone/phone_agent.py through iCTRL: any app on the phone)
  2. Every agent starts at once. Hub and laptop agents run truly in parallel. The iPhone has one screen,
     so phone agents take turns on it (one lock), each still planned by its own agent.
  3. The answers are combined into one short spoken reply.
Nothing here relaxes the agents' own safety rules (banking blocked, send/pay/call/delete need user_confirmed).
Stdlib only.
"""
import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "phone"))
import gemini_brain  # noqa: E402  (tempo-hub/phone/gemini_brain.py)

OLLAMA = os.environ.get("TEMPO_OLLAMA_URL", "http://127.0.0.1:11434") + "/api/chat"
MODEL = os.environ.get("TEMPO_CONDUCTOR_MODEL", "qwen2.5:7b")
HUB = os.environ.get("TEMPO_HUB_URL", "http://127.0.0.1:8787")
MAX_AGENTS = 5
PHONE_LOCK = threading.Lock()  # one iPhone screen

PLAN = """Split the user's request into at most 5 independent sub-tasks, one per thing they asked for.
For each, pick the device that can do it:
- "hub": questions about the user's own life data that Tempo already stores: trains and travel delays,
  notifications, which devices are syncing, messages summary.
- "laptop": the user's Mac: their documents and files, the laptop's battery or status, opening things on the Mac.
- "phone": anything done inside an app on the user's iPhone: weather, WhatsApp, maps, calendar, settings, apps.
Write each task as a short instruction in English. Do not invent tasks the user didn't ask for.
Reply with JSON only: {"subtasks": [{"device": "hub|laptop|phone", "task": "..."}]}"""


def ollama_json(system: str, user: str) -> dict:
    body = json.dumps({"model": MODEL, "stream": False, "format": "json", "keep_alive": -1,
                       "options": {"temperature": 0.1},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(json.loads(r.read())["message"]["content"] or "{}")


def think_json(system: str, user: str) -> dict:
    """The planner's JSON: Gemini (responseMimeType application/json, about a second) when it's set up, else the
    local model; the local model too if Gemini fails."""
    if gemini_brain.choose("TEMPO_CONDUCTOR_BRAIN", "TEMPO_PHONE_BRAIN") == "gemini":
        try:
            return gemini_brain.Gemini(model=gemini_brain.setting("GEMINI_CONDUCTOR_MODEL") or None).json(system, user)
        except gemini_brain.GeminiError:
            pass
    return ollama_json(system, user)


def plan(request: str) -> list:
    try:
        subs = think_json(PLAN, request).get("subtasks") or []
    except Exception:
        subs = []
    out = []
    for s in (subs if isinstance(subs, list) else [])[:MAX_AGENTS]:
        if not isinstance(s, dict):
            continue
        dev, task = str(s.get("device", "")).lower(), " ".join(str(s.get("task", "")).split())[:300]
        if task:
            out.append({"device": dev if dev in ("hub", "laptop", "phone") else "phone", "task": task})
    return out or [{"device": "phone", "task": request}]


def hub_token() -> str:
    for line in (HERE.parent / "voice" / ".env").read_text().splitlines():
        if line.startswith("TEMPO_HUB_DEVICE_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def ask_hub(task: str) -> dict:
    req = urllib.request.Request(HUB + "/api/ask", method="POST", data=json.dumps({"question": task}).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {hub_token()}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return {"status": "done", "answer": (json.loads(r.read()).get("answer") or "").strip(), "steps": ["Asked the Tempo hub"]}


def run_agent(n: int, sub: dict, confirmed: bool, on_step, channel: str = "cloud") -> dict:
    say = lambda s: on_step(f"agent {n} ({sub['device']}): {s}")
    say(f"started: {sub['task'][:60]}")
    t0 = time.time()
    try:
        if sub["device"] == "hub":
            out = ask_hub(sub["task"])
        elif sub["device"] == "laptop":
            import laptop_agent
            out = laptop_agent.run(sub["task"], on_step=say, via="voice")
        else:
            import phone_agent
            say("waiting for the phone screen")
            with PHONE_LOCK:
                out = phone_agent.run(sub["task"], user_confirmed=confirmed, on_step=say, via="voice", channel=channel)
    except Exception as e:
        out = {"status": "error", "answer": f"That one failed ({type(e).__name__})."}
    say(f"finished in {time.time() - t0:.0f}s")
    return {**sub, "status": out.get("status"), "answer": out.get("answer")}


def run_team(request: str, user_confirmed: bool = False, return_to_safari: bool = False, on_step=None,
             channel: str = "cloud", return_bundle: str = None) -> dict:
    on_step = on_step or (lambda s: None)
    t0 = time.time()
    subs = plan(request)
    on_step(f"Conductor: {len(subs)} agent(s): " + "; ".join(f"{s['device']}: {s['task'][:40]}" for s in subs))
    results = [None] * len(subs)

    def work(i):
        results[i] = run_agent(i + 1, subs[i], False, on_step, channel)  # a team never acts on one shared "yes"
    threads = [threading.Thread(target=work, args=(i,)) for i in range(len(subs))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    if (return_bundle or return_to_safari) and any(s["device"] == "phone" for s in subs):
        import phone_agent
        phone_agent.phone("launch_app", {"bundle_id": return_bundle or phone_agent.SAFARI})
    answer = " ".join(r["answer"] for r in results if r and r.get("answer"))
    ok = all(r and r.get("status") == "done" for r in results)
    return {"status": "done" if ok else "partial", "answer": answer or "None of the agents could finish.",
            "results": results, "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    req = " ".join(a for a in sys.argv[1:] if not a.startswith("--"))
    if not req:
        print(__doc__)
        sys.exit(1)
    out = run_team(req, user_confirmed="--confirmed" in sys.argv, on_step=lambda s: print("  ·", s, flush=True))
    print(f"\n{out['status']} in {out['seconds']} s: {out['answer']}")
