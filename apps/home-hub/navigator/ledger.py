"""The money ledger: every state change of every payment, time-stamped, kept twice.

Locally in tempo-hub/data/money_ledger.jsonl (mode 600; the source of truth for daily totals and duplicate
checks), and as money.* events in the Tempo hub (class vault, written through the hands token on loopback), so
the person's own devices can show the full story and the voice agent never sees it.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

DATA = Path(__file__).resolve().parents[1] / "data"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Ledger:
    def __init__(self, path: Optional[Path] = None, hub_url: Optional[str] = None, token_path: Optional[Path] = None,
                 post: bool = True):
        self.path = Path(path) if path else DATA / "money_ledger.jsonl"
        self.hub_url = (hub_url or os.environ.get("TEMPO_HUB_URL", "http://127.0.0.1:8787")).rstrip("/")
        self.token_path = Path(token_path) if token_path else DATA / "hands.token"
        self.post = post
        self.lock = threading.Lock()
        self.memory: List[dict] = []
        self.failed_posts = 0

    def _token(self) -> str:
        try:
            return self.token_path.read_text().strip()
        except OSError:
            return ""

    def record(self, payment_id: str, kind: str, payload: Optional[dict] = None, when: Optional[str] = None) -> dict:
        ev = {"time": when or now_iso(), "payment_id": payment_id, "kind": f"money.{kind}", "payload": payload or {}}
        with self.lock:
            self.memory.append(ev)
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                new = not self.path.exists()
                with self.path.open("a") as f:
                    f.write(json.dumps(ev, default=str) + "\n")
                if new:
                    os.chmod(self.path, 0o600)
            except OSError:
                pass
        if self.post:
            threading.Thread(target=self._post, args=(ev,), daemon=True).start()
        return ev

    def _post(self, ev: dict) -> None:
        token = self._token()
        if not token:
            return
        body = json.dumps({"events": [{"kind": ev["kind"], "payment_id": ev["payment_id"], "event_time": ev["time"],
                                       "payload": ev["payload"]}]}, default=str).encode()
        req = urllib.request.Request(self.hub_url + "/api/money/events", data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        try:
            urllib.request.urlopen(req, timeout=5).read()
        except Exception:
            self.failed_posts += 1

    # ---- reading ----
    def events(self, payment_id: Optional[str] = None, limit: int = 500) -> List[dict]:
        out = []
        try:
            with self.path.open() as f:
                for line in f:
                    try:
                        ev = json.loads(line)
                    except ValueError:
                        continue
                    if payment_id is None or ev.get("payment_id") == payment_id:
                        out.append(ev)
        except OSError:
            out = [e for e in self.memory if payment_id is None or e["payment_id"] == payment_id]
        return out[-limit:]

    def history_sent(self, days: int = 2) -> List[dict]:
        """Payments that were actually sent recently: [{time, payee_id, amount, currency, payment_id}]."""
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        out = []
        for ev in self.events():
            if ev.get("kind") == "money.sent" and ev.get("time", "") >= since:
                p = ev.get("payload", {})
                out.append({"time": ev["time"], "payee_id": p.get("payee_id"), "amount": p.get("amount"),
                            "currency": p.get("currency", "GBP"), "payment_id": ev["payment_id"]})
        return out

    def timeline(self, payment_id: str) -> List[dict]:
        evs = self.events(payment_id)
        if not evs:
            return []
        t0 = _ts(evs[0]["time"])
        return [{"kind": e["kind"], "time": e["time"], "ms": int((_ts(e["time"]) - t0) * 1000), "payload": e.get("payload", {})} for e in evs]


def _ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return time.time()
