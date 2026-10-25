"""Remember what a letter said in the person's own hub (tempo-hub on this Mac), so Kairos can answer
"what did that council letter say?" or "what's due this week?" later, by voice.

How it joins: the hub lets anything on 127.0.0.1 register as "this computer", so on first use this registers
one device, "Kairos letter reader", and keeps its token in agents/data/hub_device.json (mode 600). Events are
class vault (private): the hub's voice channel never sees them unless the owner turns vault on for it.

Theme TIME: every deadline in a letter becomes its own `document.deadline` event with the due date, so the
hub's timeline holds "pay £142 by 3 Nov" as a fact with a date, not a paragraph.
Remembering never fails a job: when the hub is down, the letter is still explained; `saved` is just 0.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .config import DATA_DIR

DEVICE_NAME = "Kairos letter reader"


class HubMemory:
    def __init__(self, hub_url: str, token_file: Optional[Path] = None, enabled: bool = True):
        self.hub_url = hub_url.rstrip("/")
        self.token_file = token_file or (DATA_DIR / "hub_device.json")
        self.enabled = enabled
        self._creds: Optional[dict] = None
        self.last_error: Optional[str] = None

    # -- credentials -------------------------------------------------------------------------------------
    def _load(self) -> Optional[dict]:
        try:
            d = json.loads(self.token_file.read_text())
            return d if d.get("device_token") else None
        except (OSError, ValueError):
            return None

    def _save(self, creds: dict) -> None:
        self.token_file.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.token_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"device_id": creds["device_id"], "device_token": creds["device_token"]}, f)

    def _register(self) -> Optional[dict]:
        body = json.dumps({"name": DEVICE_NAME, "platform": "agents", "kind": "agent"}).encode()
        req = urllib.request.Request(self.hub_url + "/api/devices/register", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                creds = json.loads(r.read())
        except urllib.error.HTTPError as e:
            self.last_error = f"hub refused to register the letter reader ({e.code})"
            return None
        except (urllib.error.URLError, OSError, ValueError) as e:
            self.last_error = f"hub unreachable: {type(e).__name__}"
            return None
        self._save(creds)
        return creds

    def credentials(self) -> Optional[dict]:
        if not self.enabled:
            return None
        if self._creds is None:
            self._creds = self._load() or self._register()
        return self._creds

    def ready(self) -> bool:
        return self.credentials() is not None

    # -- events --------------------------------------------------------------------------------------------
    @staticmethod
    def _now() -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")

    def events_for(self, facts: dict, explanation: str, language: str) -> list[dict]:
        sender = facts.get("sender") or {}
        money = facts.get("money") or {}
        summary = facts.get("summary_plain") or "A document was read."
        who = sender.get("name") or "an unknown sender"
        now = self._now()
        events = [{
            "kind": "document.read", "class": "vault", "event_time": now,
            "payload": {
                "text": f"{facts.get('document_type', 'document')} from {who}: {summary}",
                "summary": summary, "document_type": facts.get("document_type"),
                "sender": sender.get("name"), "sender_type": sender.get("type"),
                "date_of_document": facts.get("date_of_document"),
                "tone": facts.get("tone"), "urgency": facts.get("urgency"),
                "you_owe": money.get("you_owe"), "they_owe_you": money.get("they_owe_you"),
                "currency": money.get("currency"),
                "deadline": (facts.get("deadline") or {}).get("date"),
                "actions": [a.get("action") for a in facts.get("actions_required") or [] if a.get("action")][:6],
                "scam_level": (facts.get("scam_risk") or {}).get("level"),
                "explained_in": language, "explanation": explanation[:1200],
            }}]
        seen = set()
        for item in self._deadlines(facts):  # one event per date: the explicit deadline wins over an action's by_when
            if item["due"] in seen:
                continue
            seen.add(item["due"])
            text = f"{item['what']} by {item['due']}" + (f" ({item['amount']})" if item.get("amount") else "") + f" ({who})"
            events.append({"kind": "document.deadline", "class": "vault", "event_time": now,
                           "payload": {"text": text, "due": item["due"], "what": item["what"],
                                       "amount": item.get("amount"), "sender": sender.get("name"),
                                       "document_type": facts.get("document_type")}})
        return events

    @staticmethod
    def _deadlines(facts: dict) -> list[dict]:
        out = []
        money = facts.get("money") or {}
        amount = None
        if money.get("you_owe") is not None:
            amount = f"{money.get('currency') or 'GBP'} {money['you_owe']}"
        d = facts.get("deadline") or {}
        if d.get("date"):
            out.append({"due": d["date"], "what": d.get("what") or "Deadline", "amount": amount})
        for a in facts.get("actions_required") or []:
            if a.get("by_when") and a.get("action"):
                out.append({"due": a["by_when"], "what": a["action"], "amount": amount})
        for dt in facts.get("dates") or []:
            if dt.get("date") and dt.get("what") and any(w in str(dt["what"]).lower()
                                                           for w in ("appointment", "hearing", "deadline", "due", "by", "before", "expires", "renew")):
                out.append({"due": dt["date"], "what": dt["what"], "amount": None})
        return out

    def remember(self, facts: dict, explanation: str, language: str) -> dict:
        creds = self.credentials()
        if not creds:
            return {"saved": 0, "reason": self.last_error or "memory off"}
        events = self.events_for(facts, explanation, language)
        for attempt in (1, 2):
            req = urllib.request.Request(self.hub_url + "/api/events", method="POST",
                                         data=json.dumps({"events": events}).encode(),
                                         headers={"Content-Type": "application/json",
                                                  "Authorization": f"Bearer {creds['device_token']}"})
            try:
                with urllib.request.urlopen(req, timeout=8) as r:
                    out = json.loads(r.read())
                return {"saved": out.get("accepted", 0), "hub_seq": out.get("hub_seq"), "kinds": [e["kind"] for e in events]}
            except urllib.error.HTTPError as e:
                if e.code in (401, 410) and attempt == 1:  # the device was removed or the hub reset: join again
                    try:
                        self.token_file.unlink()
                    except OSError:
                        pass
                    self._creds = None
                    creds = self.credentials()
                    if creds:
                        continue
                self.last_error = f"hub said {e.code}"
                return {"saved": 0, "reason": self.last_error}
            except (urllib.error.URLError, OSError, ValueError) as e:
                self.last_error = f"hub unreachable: {type(e).__name__}"
                return {"saved": 0, "reason": self.last_error}
        return {"saved": 0, "reason": self.last_error or "unknown"}
