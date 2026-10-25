"""The Navigator: one payment, start to finish, as a small state machine with the owner's approval in the middle.

    understanding -> checking -> navigating -> verifying -> awaiting_approval -> executing -> done
                        \\-> refused            \\-> mismatch     \\-> expired / stopped / declined   \\-> failed / locked

Approval is a one-time token with a short life (Limits.approval_ttl_seconds). It is minted only after the bank's
review screen passed Confirmation of Payee, shown on the Kairos card with the details read off that screen, and
accepted only from the person's own phone. "Stop" at any point aborts and backs out of the bank app.
"""
from __future__ import annotations

import secrets
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Callable, Dict, List, Optional

from . import intent as intent_mod
from . import policy
from .autopilot import Autopilot, load_skill
from .brain import Brain
from .hands import Hands, Screen
from .ledger import Ledger
from .money import SYMBOLS
from .payees import Book, Resolution
from .verify import verify_review


def _fmt(value: Decimal, currency: str) -> str:
    return f"{SYMBOLS.get(currency, currency + ' ')}{value:,.2f}"


class Navigator:
    def __init__(self, book: Book, hands: Hands, skill: Optional[dict] = None, brain: Optional[Brain] = None,
                 ledger: Optional[Ledger] = None, oxbank_url: Optional[str] = None):
        self.book = book
        self.hands = hands
        self.skill = skill or load_skill("oxbank", oxbank_url)
        self.brain = brain
        self.ledger = ledger or Ledger()
        self.lock = threading.RLock()  # stop() -> active_id() re-enters it
        self.records: Dict[str, dict] = {}
        self.latest_id: Optional[str] = None
        self._events: Dict[str, threading.Event] = {}
        self.card_app: Optional[str] = None   # bundle id of the app that shows the card (Kairos) when running on the phone

    # ------------------------------------------------------------------ run
    def run(self, text: str, on_step: Optional[Callable[[str], None]] = None, via: str = "voice") -> dict:
        rec = self._new(text, via)
        pid = rec["id"]
        say = lambda s: self._step(rec, s, on_step)  # noqa: E731
        self.ledger.record(pid, "requested", {"text": text, "via": via})

        # 1. understand
        it = intent_mod.parse(text, self.brain)
        rec["intent"] = it.to_dict()
        self.ledger.record(pid, "understood", rec["intent"])
        if it.kind == "stop":
            active = self.active_id(exclude=pid)
            stopped = self.stop(active) if active else {"stopped": False}
            return self._finish(rec, "stopped", "Stopped. Nothing was sent." if stopped.get("stopped") else "Nothing was running.")

        # 2. check (deterministic)
        rec["status"] = "checking"
        res = self.book.resolve(it.payee_phrase or "") if it.payee_phrase and it.kind not in policy.READ_ONLY else Resolution("unknown")
        decision = policy.evaluate(it, res, self.book, self.ledger.history_sent(), self._now())
        rec["decision"] = {"outcome": decision.outcome, "reasons": decision.reasons, "flags": decision.flags,
                           "readback": decision.readback, "extra_confirm": decision.extra_confirm,
                           "amount": str(decision.amount) if decision.amount is not None else None, "currency": decision.currency}
        rec["payee_id"] = res.payee.id if res.payee else None
        self.ledger.record(pid, "checked", rec["decision"])
        if not decision.ok:
            self.ledger.record(pid, "refused", {"reasons": decision.reasons})
            return self._finish(rec, "refused", decision.say)
        payee = res.payee

        # 3. navigate
        if it.kind in policy.READ_ONLY:
            procedure = it.kind
            ctx = {"read": ""}
        else:
            ussd = payee.app == "oxmoney" or (it.channel == "mobile money" and payee.phone and payee.kind == "person")
            procedure = "ussd_send_money" if ussd else ("pay_bill" if payee.kind == "biller" else "send_money")
            amount, currency = decision.amount, decision.currency
            reference = it.reference or payee.reference or ""
            ctx = {"payee": payee, "amount": _fmt(amount, currency), "amount_plain": f"{amount:.2f}", "reference": reference, "read": ""}
            rec["payment"] = {"amount": _fmt(amount, currency), "amount_value": str(amount), "currency": currency,
                              "payee": payee.display_name, "payee_id": payee.id, "account": _account_words(payee),
                              "reference": reference, "readback": decision.readback, "extra_confirm": decision.extra_confirm,
                              "flags": decision.flags}
        if not self.hands.reachable():
            return self._finish(rec, "failed", "I can't reach your phone right now. Is it unlocked and on the same Wi-Fi?")
        if self.hands.locked():
            return self._finish(rec, "locked", "Your phone is locked. Unlock it and ask me again.")
        rec["status"] = "navigating"
        self.ledger.record(pid, "navigating", {"procedure": procedure, "skill": self.skill["id"], "hands": getattr(self.hands, "name", "")})

        def verify_hook(screen: Screen) -> bool:
            v = verify_review(screen.lines(), decision.amount, payee, ctx.get("reference"), decision.currency)
            rec["verification"] = v.to_dict()
            rec["payment"]["cop_name"] = v.name_on_screen
            rec["payment"]["cop"] = v.summary
            self.ledger.record(pid, "verified" if v.ok else "mismatch", rec["verification"])
            if v.ok:
                say("The name and amount on the bank's screen match")
            else:
                say("Mismatch on the bank's screen: stopped")
            return v.ok

        def approve_hook() -> str:
            return self._await_approval(rec, say)

        auto = Autopilot(self.skill, self.hands, ctx, say, self.brain, verify_hook, approve_hook,
                         stop_check=lambda: rec.get("stop_requested", False))
        rec["_autopilot"] = auto
        if procedure not in self.skill["procedures"]:
            return self._finish(rec, "failed", "I don't have a procedure for that in this bank yet.")
        out = auto.run(procedure)
        rec["actions"], rec["recoveries"], rec["screen"] = out.actions, out.recoveries, out.screen_id

        if out.status == "done":
            if "payment" in rec:
                self.ledger.record(pid, "sent", {"payee_id": payee.id, "amount": str(decision.amount), "currency": decision.currency,
                                                 "reference": ctx.get("reference"), "cop_name": rec.get("verification", {}).get("name_on_screen"),
                                                 "actions": out.actions, "seconds": round(time.time() - rec["_t0"], 1)})
                msg = (f"Done. {rec['payment']['amount']} went to {payee.display_name}. The bank's screen showed the name "
                       f"{rec.get('verification', {}).get('name_on_screen') or payee.bank_name} and marked it sent.")
            else:
                msg = out.message
            return self._finish(rec, "done", msg)
        # anything else: nothing was sent; back out of the bank app
        if out.status not in ("locked",):
            auto.cleanup(procedure)
        self.ledger.record(pid, "aborted", {"status": out.status, "message": out.message, "actions": out.actions})
        if out.status == "mismatch":
            msg = "I stopped before sending anything. " + rec.get("verification", {}).get("summary", "")
        else:
            msg = out.message
        return self._finish(rec, out.status, msg)

    # ------------------------------------------------------------------ approval
    def _await_approval(self, rec: dict, say) -> str:
        ttl = self.book.limits.approval_ttl_seconds
        token = secrets.token_urlsafe(9)
        ev = threading.Event()
        with self.lock:
            rec["approval"] = {"token": token, "expires_at": time.time() + ttl, "decided": None}
            rec["status"] = "awaiting_approval"
            self._events[rec["id"]] = ev
        self.ledger.record(rec["id"], "awaiting_approval", {"ttl_seconds": ttl, "readback": rec["payment"]["readback"],
                                                             "cop_name": rec["payment"].get("cop_name")})
        if self.card_app:  # on the phone: bring Kairos to the front so the card is seen (the bank keeps its state)
            self.hands.launch(self.card_app)
        deadline = time.time() + ttl
        while time.time() < deadline:
            if ev.wait(timeout=0.25):
                break
            if rec.get("stop_requested"):
                break
        with self.lock:
            decided = rec["approval"].get("decided")
            self._events.pop(rec["id"], None)
        if rec.get("stop_requested"):
            self.ledger.record(rec["id"], "stopped", {"while": "awaiting_approval"})
            return "stopped"
        if decided == "approved":
            rec["status"] = "executing"
            self.ledger.record(rec["id"], "approved", {"by": rec["approval"].get("by", "phone"),
                                                       "waited_s": round(ttl - (deadline - time.time()), 1)})
            hold = self.book.limits.hold_seconds
            if hold:
                say(f"Sending in {hold} seconds. Say stop to cancel.")
                end = time.time() + hold
                while time.time() < end:
                    if rec.get("stop_requested"):
                        self.ledger.record(rec["id"], "stopped", {"while": "hold"})
                        return "stopped"
                    time.sleep(0.1)
            return "approved"
        if decided == "declined":
            self.ledger.record(rec["id"], "declined", {})
            return "declined"
        self.ledger.record(rec["id"], "expired", {"ttl_seconds": ttl})
        return "expired"

    def approve(self, payment_id: Optional[str] = None, token: Optional[str] = None, by: str = "phone") -> dict:
        """The owner tapped Yes on their phone (after Face ID). One-time, and only while the token is fresh."""
        with self.lock:
            rec = self.records.get(payment_id or self.latest_id or "")
            if not rec or rec.get("status") != "awaiting_approval":
                return {"status": "refused", "message": "There's nothing waiting for your approval."}
            ap = rec["approval"]
            if token is not None and token != ap["token"]:
                return {"status": "refused", "message": "That approval doesn't match the payment on screen."}
            if time.time() > ap["expires_at"]:
                return {"status": "expired", "message": "That approval window has closed. Ask again."}
            if ap.get("decided"):
                return {"status": "refused", "message": "Already answered."}
            ap["decided"], ap["by"] = "approved", by
            ev = self._events.get(rec["id"])
        if ev:
            ev.set()
        return {"status": "approved", "payment_id": rec["id"]}

    def decline(self, payment_id: Optional[str] = None) -> dict:
        with self.lock:
            rec = self.records.get(payment_id or self.latest_id or "")
            if not rec or rec.get("status") != "awaiting_approval":
                return {"status": "refused", "message": "There's nothing waiting for your approval."}
            rec["approval"]["decided"] = "declined"
            ev = self._events.get(rec["id"])
        if ev:
            ev.set()
        return {"status": "declined", "payment_id": rec["id"]}

    FINAL = ("done", "refused", "failed", "stopped", "expired", "mismatch", "declined", "locked")

    def active_id(self, exclude: Optional[str] = None) -> Optional[str]:
        """The payment that is in flight right now (not finished), if any."""
        with self.lock:
            live = [r for r in self.records.values() if r["status"] not in self.FINAL and r["id"] != exclude]
        return live[-1]["id"] if live else None

    def stop(self, payment_id: Optional[str] = None) -> dict:
        with self.lock:
            rec = self.records.get(payment_id or self.active_id() or self.latest_id or "")
            if not rec or rec.get("status") in self.FINAL:
                return {"stopped": False, "message": "Nothing is running."}
            rec["stop_requested"] = True
            ev = self._events.get(rec["id"])
        if ev:
            ev.set()
        return {"stopped": True, "payment_id": rec["id"]}

    # ------------------------------------------------------------------ views
    def status(self, payment_id: Optional[str] = None) -> dict:
        rec = self.records.get(payment_id or self.latest_id or "")
        if not rec:
            return {"status": "none"}
        view = {k: rec.get(k) for k in ("id", "task", "status", "steps", "answer", "started", "finished", "payee_id", "actions")}
        if rec.get("payment"):
            p = dict(rec["payment"])
            ap = rec.get("approval") or {}
            if rec["status"] == "awaiting_approval" and ap:
                p["token"] = ap["token"]
                p["expires_in"] = max(0, int(ap["expires_at"] - time.time()))
            view["payment"] = p
        if rec.get("verification"):
            view["verification"] = rec["verification"]
        if rec.get("decision"):
            view["decision"] = rec["decision"]
        return view

    def timeline(self, payment_id: Optional[str] = None) -> List[dict]:
        return self.ledger.timeline(payment_id or self.latest_id or "")

    # ------------------------------------------------------------------ internals
    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _new(self, text: str, via: str) -> dict:
        rec = {"id": f"p-{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(2)}", "task": text[:300], "status": "understanding",
               "steps": [], "answer": None, "started": time.time(), "finished": None, "via": via, "_t0": time.time()}
        with self.lock:
            self.records[rec["id"]] = rec
            self.latest_id = rec["id"]
        return rec

    def _step(self, rec: dict, text: str, on_step) -> None:
        rec["steps"].append(text)
        if on_step:
            on_step(text)

    def _finish(self, rec: dict, status: str, answer: str) -> dict:
        rec["status"], rec["answer"], rec["finished"] = status, answer, time.time()
        rec["seconds"] = round(rec["finished"] - rec["started"], 1)
        rec.pop("_autopilot", None)
        return self.status(rec["id"])


def _account_words(payee) -> str:
    if payee.kind == "biller" and payee.reference:
        return f"reference {payee.reference}"
    if payee.account_last4:
        return f"account ending {payee.account_last4}"
    if payee.phone:
        return f"number ending {payee.phone[-4:]}"
    return ""

