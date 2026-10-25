"""The Guardian process: a separate program that watches the hub and the agents, so a fault in them can't silence it.

    .venv/bin/python -m guardian run        tail the hub, run the watchers, write guardian.* events and data/guardian_status.json
    .venv/bin/python -m guardian seal       sign the manifest of the agents' code, prompts, skills and payee book (after every deliberate change)
    .venv/bin/python -m guardian verify     check the manifest, the vault chain, file permissions and services
    .venv/bin/python -m guardian status     what the phone sees
    .venv/bin/python -m guardian review     this month's review, spoken text and numbers (--month 2026-09)
    .venv/bin/python -m guardian profile    the person's baseline (derived facts only)
    .venv/bin/python -m guardian export     the whole vault, decrypted, as JSON on stdout (owner, this computer)
    .venv/bin/python -m guardian lock --reason "..." [--scope money hands]   /   unlock
    .venv/bin/python -m guardian canary     plant the trap payee and contact
    .venv/bin/python -m guardian attack ... the red team (guardian/redteam.py)

How it joins the hub: once, with file access to the hub's database (it runs on the hub computer), it creates a device
"Kairos Guardian" with the capability `guardian` and keeps the token in data/guardian.token (mode 600). From then on it
talks to the hub only over HTTP on loopback: GET /api/events after its hub_seq cursor, POST guardian.* events.

What it writes: guardian.alert (one per finding, plain words), guardian.lockdown / guardian.unlocked, guardian.heartbeat
(every minute: integrity, vault, services), and the status file the phone reads through the voice server.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import lockdown, profile as profile_mod, threats
from .vault import Vault, caps_for, load_root_key
from .watchers import Alert, Integrity, Invariants, Sentinel, canary_names, plant_canaries

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HUB = os.environ.get("TEMPO_HUB_URL", "http://127.0.0.1:8787").rstrip("/")
DEVICE_NAME = "Kairos Guardian"
HEARTBEAT_S = float(os.environ.get("TEMPO_GUARDIAN_HEARTBEAT_S", "60"))
INTEGRITY_S = float(os.environ.get("TEMPO_GUARDIAN_INTEGRITY_S", "300"))
REBUILD_S = float(os.environ.get("TEMPO_GUARDIAN_REBUILD_S", "3600"))
LOCK_ON_CODE_CHANGE = os.environ.get("TEMPO_GUARDIAN_LOCK_ON_CODE_CHANGE", "1") != "0"  # 0 on a build night: alert, don't lock
RECHECK_FLAG = "guardian.recheck"  # touch data/guardian.recheck to make the next tick re-check integrity at once (the red team uses it)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} guardian: {msg}", flush=True)


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


class HubClient:
    def __init__(self, url: str, token_file: Path):
        self.url = url.rstrip("/")
        self.token_file = token_file

    def token(self) -> str:
        try:
            return self.token_file.read_text().strip()
        except OSError:
            return ""

    def ensure_device(self) -> str:
        """Create the Guardian's device once, straight in the hub's database (this computer only), then use the token."""
        tok = self.token()
        if tok:
            return tok
        sys.path.insert(0, str(ROOT))
        from hub import db  # the hub's own database module; same file, same rules
        db.init()
        person = db.owner()
        dev = db.add_device(person["id"], DEVICE_NAME, "guardian", "guardian", ["guardian"], "owner-cli")
        _write_private(self.token_file, dev["token"] + "\n")
        log(f"joined the hub as {dev['id']} ({DEVICE_NAME}); token in {self.token_file.name}")
        return dev["token"]

    def _call(self, method: str, path: str, body: Optional[dict] = None, timeout: float = 10.0) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token()}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")

    def events_after(self, after: int, limit: int = 500) -> dict:
        return self._call("GET", f"/api/events?after={int(after)}&limit={int(limit)}")

    def post_events(self, events: list) -> dict:
        return self._call("POST", "/api/events", {"events": events})

    def hello(self) -> bool:
        try:
            with urllib.request.urlopen(self.url + "/api/hello", timeout=3) as r:
                return r.status == 200
        except Exception:
            return False


class Guardian:
    def __init__(self, hub_url: str = HUB, data_dir: Path = DATA, root_key: Optional[bytes] = None, vault: Optional[Vault] = None,
                 hub: Optional[HubClient] = None, poll_seconds: float = 3.0, replay: bool = False):
        self.data = Path(data_dir)
        self.data.mkdir(parents=True, exist_ok=True)
        self.root_key = root_key or load_root_key(self.data / "vault.key")
        self.vault = vault or Vault(self.data / "vault.db", root_key=self.root_key)
        self.vsess = self.vault.open("guardian", caps_for("guardian"))
        self.psess = self.vault.open("profile", caps_for("profile"))
        self.hub = hub or HubClient(hub_url, self.data / "guardian.token")
        self.integrity = Integrity(ROOT, self.data / "guardian_manifest.json", signer_key=self.root_key)
        self.sentinel = Sentinel()
        self.poll = poll_seconds
        self.replay = replay
        self.cursor_file = self.data / "guardian_cursor.json"
        self.status_file = self.data / "guardian_status.json"
        self.cursor = self._load_cursor()
        self.recent: deque = deque(maxlen=200)
        self.counts = {"info": 0, "notice": 0, "high": 0, "critical": 0}
        self.last_heartbeat = 0.0
        self.last_integrity = 0.0
        self.last_rebuild = 0.0
        self.integrity_report: dict = {}
        self.vault_report: dict = {}
        self.hub_ok = False
        self.events_seen = 0
        prof = profile_mod.Profile.load(self.psess)
        self.baseline = prof.baseline if prof else profile_mod.Baseline()
        self.inv = Invariants(self.baseline, canaries=canary_names(self.vsess))
        self._last_lock_state = lockdown.status()["locked"]

    # -- housekeeping -------------------------------------------------------------------------------------------
    def _load_cursor(self) -> int:
        try:
            return int(json.loads(self.cursor_file.read_text()).get("after", 0))
        except (OSError, ValueError, AttributeError):
            return 0

    def _save_cursor(self) -> None:
        _write_private(self.cursor_file, json.dumps({"after": self.cursor, "at": _now()}))

    def ensure_canaries(self) -> list:
        names = canary_names(self.vsess)
        if not names:
            names = plant_canaries(self.vsess, self.data / "payees.json")
            log(f"planted {len(names)} canaries")
        for n in names:
            self.inv.add_canary(n)
        return names

    # -- the hub -------------------------------------------------------------------------------------------------
    def _all_events(self) -> list:
        out, after = [], 0
        while True:
            page = self.hub.events_after(after, 2000)
            evs = page.get("events") or []
            out += evs
            if not evs or len(evs) < 2000:
                break
            after = evs[-1]["hub_seq"]
        return out

    def rebuild_baseline(self) -> None:
        evs = self._all_events()
        self.baseline = profile_mod.build(evs)
        self.inv.baseline = self.baseline
        try:
            profile_mod.Profile(self.baseline).save(self.psess)
        except Exception as e:  # noqa: BLE001
            log(f"couldn't save the baseline to the vault: {type(e).__name__}")
        self.last_rebuild = time.time()
        log(f"baseline: {self.baseline.days_observed} days, {len(self.baseline.payees)} payees, active {self.baseline.active_window}")

    def bootstrap(self) -> None:
        """First run: learn from history without alerting on it (unless replay=True), then watch from now on."""
        self.hub.ensure_device()
        self.ensure_canaries()
        if self.cursor == 0 and not self.replay:
            evs = self._all_events()
            self.baseline = profile_mod.build(evs)
            self.inv.baseline = self.baseline
            for ev in evs:  # prime the invariants' memory (pending confirmations, payments) silently
                self.inv.check(ev)
            self.cursor = evs[-1]["hub_seq"] if evs else 0
            self._save_cursor()
            try:
                profile_mod.Profile(self.baseline).save(self.psess)
            except Exception:
                pass
            log(f"learned from {len(evs)} past events; watching from #{self.cursor}")
            self.last_rebuild = time.time()
        if not (self.data / "guardian_manifest.json").exists():
            r = self.integrity.seal()
            log(f"sealed {r['files']} files")

    def emit(self, kind: str, payload: dict, text: str) -> None:
        ev = {"kind": kind, "payload": payload, "text": text[:2000], "event_time": datetime.now().astimezone().isoformat(timespec="seconds")}
        try:
            self.hub.post_events([ev])
        except Exception as e:  # noqa: BLE001
            log(f"couldn't write {kind} to the hub: {type(e).__name__}")

    # -- alerts -------------------------------------------------------------------------------------------------
    def handle(self, alerts: list, ev: Optional[dict] = None) -> None:
        for a in alerts:
            self.counts[a.severity] = self.counts.get(a.severity, 0) + 1
            d = a.to_dict()
            d["ref"] = f"#{ev['hub_seq']}" if ev and ev.get("hub_seq") is not None else None
            self.recent.appendleft(d)
            log(f"{a.severity.upper()} {a.code}: {a.text[:120]}")
            self.emit("guardian.alert", d, f"{a.severity}: {a.text}")
            if a.lockdown:
                st = lockdown.lock(a.text, a.lockdown, by="guardian")
                self.emit("guardian.lockdown", {"scopes": st["scopes"], "reason": a.text, "code": a.code}, "Kairos paused " + ", ".join(st["scopes"]) + ": " + a.text)
        if alerts:
            self.write_status()

    def tick(self) -> int:
        """One pass: new events through the watchers. Returns how many events were read."""
        try:
            page = self.hub.events_after(self.cursor, 500)
            self.hub_ok = True
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as e:
            if self.hub_ok:
                log(f"hub unreachable: {type(e).__name__}")
            self.hub_ok = False
            return 0
        latest = int(page.get("latest_hub_seq") or 0)
        if latest and latest < self.cursor:
            self.handle([Alert("high", "hub_reset", f"The hub's log is shorter than it was (#{latest} < #{self.cursor}). It was reset or replaced. "
                               "Payments and the hands are paused until you look.", [], ["money", "hands"])])
            self.cursor = 0
        evs = page.get("events") or []
        for ev in evs:
            try:
                alerts = self.inv.check(ev)
            except Exception as e:  # noqa: BLE001 - a watcher bug must never stop the others
                log(f"watcher error on #{ev.get('hub_seq')}: {type(e).__name__}: {e}")
                alerts = []
            self.handle(alerts, ev)
            self.cursor = max(self.cursor, int(ev.get("hub_seq") or 0))
            self.events_seen += 1
        if evs:
            self._save_cursor()
        now = time.time()
        recheck = self.data / RECHECK_FLAG
        if recheck.exists():
            try:
                recheck.unlink()
            except OSError:
                pass
            self.last_integrity = 0
        if now - self.last_integrity >= INTEGRITY_S:
            self.check_integrity()
        if now - self.last_heartbeat >= HEARTBEAT_S:
            self.heartbeat()
        if now - self.last_rebuild >= REBUILD_S:
            try:
                self.rebuild_baseline()
            except Exception as e:  # noqa: BLE001
                log(f"baseline rebuild failed: {type(e).__name__}")
                self.last_rebuild = now
        locked = lockdown.status()["locked"]
        if self._last_lock_state and not locked:
            self.emit("guardian.unlocked", {"at": _now()}, "The owner switched Kairos back on.")
            self._integrity_ok = self._vault_ok = True  # alert again if the problem is still there at the next check
            self.last_integrity = 0
            self.write_status()
        self._last_lock_state = locked
        return len(evs)

    def check_integrity(self) -> dict:
        self.last_integrity = time.time()
        rep = self.integrity.verify()
        rep["permissions"] = self.integrity.permissions()
        self.integrity_report = rep
        was = getattr(self, "_integrity_ok", True)
        if rep["sealed"] and not rep["ok"] and was:
            what = "; ".join(rep["problems"][:3])
            detail = {"changed": rep["changed"][:10], "missing": rep["missing"][:10], "added": rep["added"][:10]}
            if LOCK_ON_CODE_CHANGE:
                self.handle([Alert("critical", "code_changed", f"The agents' code or settings changed since they were sealed: {what}. "
                                   "Until the owner re-seals them, payments and the hands are locked.", rep["changed"][:5] + rep["missing"][:3],
                                   ["money", "hands", "agents"], detail=detail)])
            else:  # a build night: the team is editing; say so loudly, keep the Navigator usable, re-seal before the demo
                self.handle([Alert("high", "code_changed", f"The agents' code or settings changed since they were sealed: {what}. "
                                   "Not locking (build mode). Re-seal before the demo: python -m guardian seal.", rep["changed"][:5] + rep["missing"][:3],
                                   [], detail=detail)])
        if rep["permissions"] and getattr(self, "_perms_ok", True):
            self.handle([Alert("notice", "loose_permissions", "Some secret files can be read by other users of this computer: " + "; ".join(rep["permissions"][:3]), [])])
        self._integrity_ok = rep["ok"] or not rep["sealed"]
        self._perms_ok = not rep["permissions"]
        try:
            self.vault_report = self.vault.verify()
            if not self.vault_report["ok"] and getattr(self, "_vault_ok", True):
                self.handle([Alert("critical", "vault_tampered", "The vault's record of what Kairos knows about you doesn't add up: " + "; ".join(self.vault_report["problems"][:3]) +
                                   ". Someone changed it behind Kairos's back. Everything is paused.", [], ["money", "hands", "agents"])])
            self._vault_ok = self.vault_report["ok"]
            if self.vault_report["ok"]:
                self.vault.checkpoint()
        except Exception as e:  # noqa: BLE001
            self.vault_report = {"ok": False, "problems": [f"vault check failed: {type(e).__name__}"]}
        return rep

    def heartbeat(self) -> None:
        self.last_heartbeat = time.time()
        services = Integrity.services()
        self.emit("guardian.heartbeat", {"integrity_ok": self.integrity_report.get("ok"), "vault_ok": self.vault_report.get("ok"),
                                         "events_seen": self.events_seen, "cursor": self.cursor, "services": services,
                                         "alerts": dict(self.counts), "lockdown": lockdown.status()["scopes"]},
                  "Guardian heartbeat")
        self.write_status(services)

    def status(self, services: Optional[dict] = None) -> dict:
        lock = lockdown.status()
        integ_ok = bool(self.integrity_report.get("ok")) if self.integrity_report else None
        vault_ok = bool(self.vault_report.get("ok")) if self.vault_report else None
        protected = self.hub_ok and integ_ok is not False and vault_ok is not False
        if not self.hub_ok:
            headline = "Protection paused: Kairos can't reach your hub."
        elif lock["locked"]:
            headline = "Kairos stopped something. " + ", ".join(lock["scopes"]).capitalize() + " are paused until you check."
        elif integ_ok is False:
            headline = "Kairos's own code changed. Everything is paused until the owner looks."
        elif vault_ok is False:
            headline = "Your vault was changed behind Kairos's back. Everything is paused."
        else:
            headline = "You're protected. Kairos is watching its helpers."
        cp = self.vault.latest_checkpoint()
        return {"protected": protected, "headline": headline, "checked_at": _now(), "hub_reachable": self.hub_ok,
                "integrity": {"ok": integ_ok, "sealed": self.integrity_report.get("sealed"), "sealed_at": self.integrity_report.get("sealed_at"),
                              "problems": (self.integrity_report.get("problems") or [])[:5]},
                "vault": {"ok": vault_ok, "problems": (self.vault_report.get("problems") or [])[:5], "records": self.vault_report.get("records"),
                          "checkpoint": cp.to_dict() if cp else None},
                "lockdown": lock, "alerts": list(self.recent)[:10], "alert_counts": dict(self.counts),
                "baseline": {"days_observed": self.baseline.days_observed, "payees": len(self.baseline.payees), "active_window": list(self.baseline.active_window)},
                "canaries": len(self.inv.canaries), "services": services or {}, "events_seen": self.events_seen, "cursor": self.cursor}

    def write_status(self, services: Optional[dict] = None) -> None:
        try:
            _write_private(self.status_file, json.dumps(self.status(services), default=str))
        except OSError as e:
            log(f"couldn't write the status file: {e}")

    def run(self) -> None:
        os.umask(0o077)  # everything this process creates (log, status, vault, cursor) is this user's only
        log("starting")
        while not self.hub.hello():
            log("waiting for the hub on " + self.hub.url)
            self.write_status()
            time.sleep(5)
        self.hub_ok = True
        self.bootstrap()
        self.check_integrity()
        self.heartbeat()
        log(f"watching from #{self.cursor}; {len(self.inv.canaries)} canaries; integrity {'ok' if self.integrity_report.get('ok') else 'NOT ok'}")
        while True:
            try:
                n = self.tick()
            except Exception:  # noqa: BLE001 - the watcher never dies
                traceback.print_exc()
                n = 0
            time.sleep(self.poll if n < 500 else 0.1)


# ---------------------------------------------------------------- CLI

def _guardian(args) -> Guardian:
    return Guardian(hub_url=args.hub, data_dir=Path(args.data))


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m guardian", description=__doc__.split("\n\n")[0])
    ap.add_argument("--hub", default=HUB)
    ap.add_argument("--data", default=str(DATA))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run").add_argument("--replay", action="store_true", help="alert on past events too")
    sub.add_parser("seal")
    sub.add_parser("verify")
    sub.add_parser("status")
    rv = sub.add_parser("review")
    rv.add_argument("--month", default=None)
    sub.add_parser("profile")
    sub.add_parser("export")
    lk = sub.add_parser("lock")
    lk.add_argument("--reason", required=True)
    lk.add_argument("--scope", nargs="*", default=["money", "hands"])
    sub.add_parser("unlock")
    sub.add_parser("canary")
    at = sub.add_parser("attack")
    at.add_argument("which", nargs="?", default="all")
    at.add_argument("--live", action="store_true", help="against the running hub (default: in-process demo)")
    args = ap.parse_args(argv)

    if args.cmd == "run":
        g = Guardian(hub_url=args.hub, data_dir=Path(args.data), replay=args.replay)
        g.run()
        return 0
    if args.cmd == "seal":
        g = _guardian(args)
        print(json.dumps(g.integrity.seal()))
        return 0
    if args.cmd == "verify":
        g = _guardian(args)
        rep = g.integrity.verify()
        rep["permissions"] = g.integrity.permissions()
        rep["vault"] = g.vault.verify()
        rep["services"] = Integrity.services(args.hub)
        print(json.dumps(rep, indent=1))
        return 0 if rep["ok"] and rep["vault"]["ok"] and not rep["permissions"] else 1
    if args.cmd == "status":
        try:
            print(Path(args.data, "guardian_status.json").read_text())
        except OSError:
            g = _guardian(args)
            g.hub_ok = g.hub.hello()
            print(json.dumps(g.status(), indent=1, default=str))
        return 0
    if args.cmd in ("review", "profile"):
        g = _guardian(args)
        g.hub.ensure_device()
        evs = g._all_events()
        if args.cmd == "profile":
            print(json.dumps(profile_mod.build(evs).to_dict(), indent=1, default=str))
        else:
            r = profile_mod.monthly_review(evs, args.month)
            print(json.dumps(r, indent=1, default=str))
        return 0
    if args.cmd == "export":
        g = _guardian(args)
        print(json.dumps(g.vault.owner("owner-cli").export(), indent=1, ensure_ascii=False, default=str))
        return 0
    if args.cmd == "lock":
        print(json.dumps(lockdown.lock(args.reason, args.scope, by="owner-cli")))
        return 0
    if args.cmd == "unlock":
        print(json.dumps({"unlocked": lockdown.unlock("owner-cli")}))
        return 0
    if args.cmd == "canary":
        g = _guardian(args)
        print(json.dumps({"canaries": g.ensure_canaries()}))
        return 0
    if args.cmd == "attack":
        from . import redteam
        return redteam.main(args.which, live=args.live, hub_url=args.hub, data_dir=Path(args.data))
    return 2


if __name__ == "__main__":
    sys.exit(main())
