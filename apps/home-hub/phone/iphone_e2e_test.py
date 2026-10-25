#!/usr/bin/env python3
"""End-to-end test FROM the iPhone: requests are typed into the Tempo page on the phone (via iCTRL) and travel
iPhone Safari -> tunnel -> token_server -> agents (laptop / phone / hub) -> answer shown and spoken on the phone.

    python3 phone/iphone_e2e_test.py          # waits up to 10 min for the iPhone to be unlocked, then runs

Prints one line per case: what was asked, which device ran it, the steps (action labels), the answer, PASS/FAIL.
"""
import json
import re
import time
import urllib.request
from pathlib import Path

import phone_agent as pa

HERE = Path(__file__).resolve().parent
ENV = dict(l.split("=", 1) for l in (HERE.parent / "voice" / ".env").read_text().splitlines()
           if "=" in l and not l.startswith("#"))
KEY = ENV["TEMPO_PHONE_KEY"].strip()
PAGE = f"https://unreleasing-laree-nebulously.ngrok-free.dev/voice/#k={KEY}"

CASES = [  # (what you'd type on the phone, expected device, check on the answer)
    ("How much battery does my laptop have?", "laptop", lambda a: bool(re.search(r"\d+%", a or ""))),
    ("What's the weather like right now?", "phone", lambda a: "°" in (a or "")),
    ("Open Monzo and check my balance", "phone", lambda a: bool(re.search(r"off-limits|can't|cannot|yourself|refus", a or "", re.I))),
]


def latest() -> dict:
    req = urllib.request.Request("http://127.0.0.1:8788/voice/phone-task/latest", headers={"X-Tempo-Phone-Key": KEY})
    return json.loads(urllib.request.urlopen(req, timeout=5).read())


def wait_unlocked(limit=600) -> bool:
    for _ in range(limit // 3):
        if pa.phone("is_locked", timeout=6).get("locked") is False:
            return True
        time.sleep(3)
    return False


def ask_from_phone(text: str) -> None:
    pa.phone("open_url", {"url": PAGE}, timeout=10)  # (re)load the Tempo page in Safari
    for _ in range(10):
        f = pa.phone("find_element", {"element_id": "battery does my laptop", "match": "contains"})
        if f.get("ref"):
            break
        time.sleep(1)
    else:
        raise RuntimeError("the agents box isn't on the phone screen")
    pa.phone("tap", {"ref": f["ref"]})
    pa.phone("type", {"text": text, "submit": True})


def main() -> int:
    print("Waiting for the iPhone to be unlocked…", flush=True)
    if not wait_unlocked():
        print("Gave up: the iPhone stayed locked.")
        return 1
    print("Unlocked. Running", len(CASES), "cases from the iPhone.\n", flush=True)
    passed = 0
    for text, want_device, check in CASES:
        before = latest().get("id")
        t0 = time.time()
        try:
            ask_from_phone(text)
        except Exception as e:
            print(f"FAIL  '{text}': couldn't type it on the phone ({e})")
            continue
        task = {}
        for _ in range(60):  # up to ~90 s
            task = latest()
            if task.get("id") != before and task.get("status") not in (None, "running"):
                break
            time.sleep(1.5)
        ok = task.get("id") != before and task.get("device") == want_device and check(task.get("answer"))
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  '{text}' -> {task.get('device')} in {time.time() - t0:.0f}s\n"
              f"      steps: {' -> '.join(task.get('steps') or [])}\n      answer: {task.get('answer')}\n", flush=True)
        time.sleep(3)
    print(f"{passed}/{len(CASES)} passed")
    return 0 if passed == len(CASES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
