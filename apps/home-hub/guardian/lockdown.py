"""The kill switch. A small JSON file, nothing else, so every process can honour it: the hub (Python 3.12), the
Navigator and the phone-task runner (macOS's Python 3.9, stdlib only), the CLI.

    lock(reason, scopes)   the Guardian (or the owner) stops money and/or the hands; the phone shows why
    is_locked("money")     the Navigator refuses money-out while this is true; the phone-task runner refuses risky tasks
    unlock()               the owner only (the hub's admin device, or the CLI on this computer)

A lockdown can carry an expiry (ttl_minutes) so a false alarm at 3 a.m. doesn't leave the person stuck all day;
the default is "until the owner looks". Nothing here imports anything beyond the standard library.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

DATA = Path(__file__).resolve().parents[1] / "data"
SCOPES = ("money", "hands", "agents")
SAY = {
    "money": "Kairos has paused payments for now. Nothing is sent until you check your phone and switch it back on.",
    "hands": "Kairos has paused acting on your phone and laptop for now. It can still talk and read letters.",
    "agents": "Kairos's helpers are paused for now. Kairos can still talk with you.",
}


def path() -> Path:
    return Path(os.environ.get("TEMPO_GUARDIAN_LOCKDOWN") or (DATA / "guardian.lockdown"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def status() -> dict:
    """{locked, scopes, reason, at, by, expires_at}; an expired lockdown reads as unlocked."""
    p = path()
    try:
        d = json.loads(p.read_text())
    except (OSError, ValueError):
        return {"locked": False, "scopes": [], "reason": None, "at": None, "by": None, "expires_at": None}
    exp = d.get("expires_at")
    if exp:
        try:
            if datetime.fromisoformat(str(exp).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                return {"locked": False, "scopes": [], "reason": None, "at": None, "by": None, "expires_at": exp, "expired": True}
        except ValueError:
            pass
    scopes = [s for s in d.get("scopes", []) if s in SCOPES]
    return {"locked": bool(scopes), "scopes": scopes, "reason": d.get("reason"), "at": d.get("at"), "by": d.get("by"),
            "expires_at": exp}


def is_locked(scope: str) -> bool:
    return scope in status()["scopes"]


def say(scope: str) -> str:
    s = status()
    base = SAY.get(scope, SAY["agents"])
    return base + (f" Reason: {s['reason']}" if s.get("reason") else "")


def lock(reason: str, scopes: Iterable[str] = ("money", "hands"), by: str = "guardian", ttl_minutes: Optional[float] = None) -> dict:
    scopes = sorted({s for s in scopes if s in SCOPES} | set(status()["scopes"]))  # widen, never narrow, an existing lock
    if not scopes:
        scopes = ["money", "hands"]
    exp = None
    if ttl_minutes:
        exp = (datetime.now(timezone.utc) + timedelta(minutes=float(ttl_minutes))).isoformat(timespec="seconds").replace("+00:00", "Z")
    d = {"scopes": scopes, "reason": " ".join(str(reason or "").split())[:300], "at": _now(), "by": str(by)[:60], "expires_at": exp}
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(d, f)
    os.replace(tmp, p)
    return {"locked": True, **d}


def unlock(by: str = "owner") -> bool:
    p = path()
    try:
        p.unlink()
        return True
    except FileNotFoundError:
        return False


def seconds_since_lock() -> Optional[float]:
    s = status()
    if not s.get("at"):
        return None
    try:
        return time.time() - datetime.fromisoformat(s["at"].replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
