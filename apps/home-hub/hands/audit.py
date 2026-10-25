"""Write each phone/laptop agent task to the Tempo hub's private audit log (kind hands.task, vault class).

POST http://127.0.0.1:8787/api/hands/log with the write-only token in tempo-hub/data/hands.token (loopback only).
Sent once at start ("started") and once at the end, with the same task_id; the hub keeps one entry per task.
Steps are sent as labels from a fixed vocabulary ("Opened Weather", "Typed text"), never free text.
Logging never breaks a task: if the hub is down, the task still runs and this returns quietly.
"""
import json
import re
import secrets
import time
import urllib.request
from pathlib import Path

HUB = "http://127.0.0.1:8787/api/hands/log"
TOKEN_FILE = Path(__file__).resolve().parents[1] / "data" / "hands.token"


def new_id(device: str) -> str:
    return f"{device}-{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"


def _iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(t))


# Labels come from a fixed vocabulary, never from free text: names, typed words and screen text can't leak
# into the log (an apostrophe in "O'Brien" defeated the earlier quote-stripping).
SAFE_APPS = {"weather", "whatsapp", "settings", "safari", "maps", "calendar", "clock", "notes", "reminders", "photos",
             "messages", "mail", "health", "music", "app store", "trainline", "national rail", "brave", "chrome",
             "finder", "preview", "pages", "numbers", "keynote", "kairos"}
VOCAB = [("tapped", "Tapped a button"), ("typed", "Typed text"), ("read the screen", "Read the screen"),
         ("read ", "Read a document"), ("searched", "Searched files"), ("looked in", "Listed a folder"),
         ("scrolled", "Scrolled"), ("went to the home", "Went to the Home Screen"),
         ("checked the laptop", "Checked laptop status"), ("back to", "Returned to Kairos"),
         ("blocked", "Blocked: needs the user's OK"), ("refused", "Refused: off-limits"),
         ("asked the tempo hub", "Asked the hub"), ("conductor", "Split into agents"),
         ("waiting for the phone", "Waited for the phone screen"), ("started", "Agent started"),
         ("finished", "Agent finished")]


def _label(step: str) -> str:
    low = " ".join(str(step).lower().split())
    low = re.sub(r"^(phone|laptop|agent \d+ \(\w+\)):\s*", "", low)  # "laptop: …" / "agent 2 (phone): …"
    m = re.match(r"opened (.+?)( on the laptop)?$", low)
    if m:
        where = " on the laptop" if m.group(2) else ""
        name = m.group(1)
        return f"Opened {name.title()}{where}" if name in SAFE_APPS else f"Opened an app or website{where}"
    for prefix, label in VOCAB:
        if low.startswith(prefix):
            return label
    return "Other step"


def outcome(status: str, steps: list) -> str:
    if any(s.startswith("Blocked") for s in steps):
        return "needs_confirmation"
    if any(s.startswith("Refused") for s in steps):
        return "refused"
    return {"done": "done", "running": "started"}.get(status, "failed")


def log(task_id: str, device: str, task: str, confirmed: bool, status: str, steps: list, answer,
        via: str, started: float, finished: float = None) -> None:
    try:
        token = TOKEN_FILE.read_text().strip()
    except OSError:
        return
    body = {"task_id": task_id, "device": device, "task": task[:300], "user_confirmed": bool(confirmed),
            "status": status, "steps": [_label(s) for s in steps][:40],
            "answer": (answer or None) and str(answer)[:500], "requested_via": via,
            "started": _iso(started), "finished": _iso(finished) if finished else None}
    if body["finished"] is None:
        del body["finished"]
    req = urllib.request.Request(HUB, method="POST", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass
