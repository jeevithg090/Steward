"""The guardrails. Deterministic code decides what may go ahead; no model is consulted here.

evaluate() turns (intent, who it resolved to, the book, recent history) into a Decision:
  refuse   - nothing happens; `say` explains why and what the person can do instead
  proceed  - the Navigator may drive the bank app; money still needs the owner's approval on the phone
             (every payment does), and `extra_confirm` asks Kairos to read the amount back digit by digit first
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List, Optional

from .money import Amount, SYMBOLS
from . import scamshield

READ_ONLY = {"check_balance", "recent_transactions"}
MONEY_OUT = {"send_money", "pay_bill"}
ALLOWED_APPS = {"oxbank", "oxmoney"}  # bank skills that exist and were calibrated; nothing else is ever driven
_SECRETS = re.compile(r"\b(pin|otp|passcode|password|one[- ]time (?:code|password)|security code|cvv|card number|"
                      r"memorable (?:word|answer)|secure key|authenticator)\b", re.I)
_OVERRIDE = re.compile(r"\b(ignore|skip|bypass|override|disable|without)\b.{0,30}\b(limit|check|confirm|approval|verif|cooling|safety|rule)", re.I)


@dataclass
class Decision:
    outcome: str                          # proceed | refuse
    reasons: List[str] = field(default_factory=list)   # machine-readable: over_cap, unknown_payee, ...
    say: str = ""                         # what Kairos tells the person
    readback: str = ""                    # the exact action, for reading back before approval
    extra_confirm: bool = False           # read the amount back digit by digit first
    flags: List[str] = field(default_factory=list)     # duplicate, unusual_amount, first_payment, ...
    amount: Optional[Decimal] = None
    currency: str = "GBP"

    @property
    def ok(self) -> bool:
        return self.outcome == "proceed"


def _guardian_locked(scope: str) -> bool:
    """The Guardian's kill switch (tempo-hub/guardian/lockdown.py): money out stops while it is set."""
    try:
        from guardian import lockdown
        return lockdown.is_locked(scope)
    except Exception:  # noqa: BLE001 - no guardian package: no lockdown
        return False


def _guardian_say(scope: str) -> str:
    try:
        from guardian import lockdown
        return lockdown.say(scope)
    except Exception:  # noqa: BLE001
        return "Payments are paused for now."


def _fmt(value: Decimal, currency: str) -> str:
    return f"{SYMBOLS.get(currency, currency + ' ')}{value:,.2f}"


def daily_total(history: List[dict], now: datetime, currency: str) -> Decimal:
    """Money sent in the person's current calendar day (UTC day of `now`), from the ledger's sent records."""
    day = now.astimezone(timezone.utc).date()
    total = Decimal("0")
    for h in history or []:
        try:
            t = datetime.fromisoformat(str(h.get("time")).replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        if t.astimezone(timezone.utc).date() == day and (h.get("currency") or currency) == currency:
            total += Decimal(str(h.get("amount", "0")))
    return total


def evaluate(intent, resolution, book, history: Optional[List[dict]] = None, now: Optional[datetime] = None) -> Decision:
    now = now or datetime.now(timezone.utc)
    limits = book.limits
    history = history or []
    d = Decision("proceed", currency=limits.currency)

    if intent.secrets_requested or _SECRETS.search(intent.text or ""):
        return Decision("refuse", ["secrets"], "I never handle PINs, passwords or one-time codes, and no one from "
                        "the bank will ever ask me to. You type those yourself.")
    if _OVERRIDE.search(intent.text or ""):
        return Decision("refuse", ["override_attempt"], "The safety checks can't be switched off by asking. "
                        "They're there to protect your money.")
    shield = scamshield.assess(intent.text or "")
    if shield.refuse and intent.kind in MONEY_OUT:
        return Decision("refuse", ["scam_signs"], shield.advice, flags=["scam:" + s for s in shield.signs])
    if intent.kind in READ_ONLY:
        d.say, d.readback = "Checking your bank.", intent.kind.replace("_", " ")
        return d
    if intent.kind in MONEY_OUT and _guardian_locked("money"):
        return Decision("refuse", ["guardian_lockdown"], _guardian_say("money"))
    if intent.kind not in MONEY_OUT:
        return Decision("refuse", ["unsupported"], "I can send money to someone in your payee book, pay one of your "
                        "bills, or check your balance. Which would you like?")

    if intent.amount_status == "ambiguous":
        return Decision("refuse", ["ambiguous_amount"], "I heard more than one amount. One payment at a time, please: how much, and to whom?")

    # ---- who ----
    if resolution.status == "unknown":
        what = "bill" if intent.kind == "pay_bill" else "person"
        return Decision("refuse", ["unknown_payee"], f"I don't have that {what} in your payee book, so I won't send "
                        "anything. We can add them together on your phone first; a new payee then waits a day before "
                        "the first payment.")
    if resolution.status == "ambiguous":
        names = " or ".join(p.display_name for p in resolution.candidates[:3])
        return Decision("refuse", ["ambiguous_payee"], f"Did you mean {names}?")
    payee = resolution.payee
    if payee.app not in ALLOWED_APPS:
        return Decision("refuse", ["app_not_allowed"], f"{payee.display_name} is paid through an app I'm not set up "
                        "to drive safely yet.")
    if not payee.trusted:
        return Decision("refuse", ["untrusted_payee"], f"{payee.display_name} is marked as blocked in your payee book.")
    until = payee.cooling_until(limits.new_payee_cooling_hours)
    if until and until > now:
        hours = max(1, int((until - now).total_seconds() // 3600) + 1)
        return Decision("refuse", ["cooling_off"], f"{payee.display_name} was only added recently. New payees wait "
                        f"{limits.new_payee_cooling_hours} hours before the first payment, about {hours} more "
                        f"hour{'s' if hours != 1 else ''}. That delay is there in case someone talked you into adding them.")

    # ---- how much ----
    amount: Optional[Amount] = intent.amount
    if amount is None and intent.kind == "pay_bill" and payee.usual_amount is not None:
        amount = Amount(payee.usual_amount, payee.currency, str(payee.usual_amount))
        d.flags.append("amount_from_bill")
    if amount is None:
        return Decision("refuse", ["missing_amount"], f"How much would you like to send to {payee.display_name}?")
    currency = amount.currency or payee.currency or limits.currency
    if currency != (payee.currency or limits.currency):
        return Decision("refuse", ["currency_mismatch"], f"{payee.display_name} is paid in {payee.currency or limits.currency}, "
                        f"not {currency}.")
    value = amount.value
    if value <= 0:
        return Decision("refuse", ["bad_amount"], "The amount has to be more than zero.")
    cap = min([x for x in (payee.max_amount, limits.per_transaction) if x is not None] or [limits.per_transaction])
    if value > cap:
        return Decision("refuse", ["over_cap"], f"{_fmt(value, currency)} is over your limit of {_fmt(cap, currency)} for "
                        f"{payee.display_name}. You can raise the limit on your hub page on the computer, not by voice.",
                        amount=value, currency=currency)
    spent = daily_total(history, now, currency)
    if spent + value > limits.daily:
        left = max(Decimal("0"), limits.daily - spent)
        return Decision("refuse", ["over_daily"], f"That would take today's total over your daily limit of "
                        f"{_fmt(limits.daily, currency)}. You have {_fmt(left, currency)} left today.", amount=value, currency=currency)

    # ---- flags that make Kairos read it back twice ----
    window = now - timedelta(minutes=limits.duplicate_window_minutes)
    for h in history:
        try:
            t = datetime.fromisoformat(str(h.get("time")).replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        if h.get("payee_id") == payee.id and Decimal(str(h.get("amount", "0"))) == value and t >= window:
            d.flags.append("duplicate")
            break
    if payee.usual_amount and value > payee.usual_amount * limits.unusual_multiplier:
        d.flags.append("unusual_amount")
    if not any(h.get("payee_id") == payee.id for h in history):
        d.flags.append("first_payment")
    if shield.level == "caution":
        d.flags += ["scam:" + s for s in shield.signs]
    d.extra_confirm = bool({"duplicate", "unusual_amount"} & set(d.flags)) or shield.level == "caution"

    d.amount, d.currency = value, currency
    ref = intent.reference or payee.reference or ""
    verb = "Pay" if payee.kind == "biller" else "Send"
    show_ref = ref and not (payee.kind == "biller" and ref == payee.reference)  # describe() already names a biller's reference
    d.readback = f"{verb} {_fmt(value, currency)} to {payee.describe()}" + (f", reference {ref}" if show_ref else "") + "."
    notes = []
    if "duplicate" in d.flags:
        notes.append(f"You already sent {payee.display_name} the same amount in the last {limits.duplicate_window_minutes} minutes.")
    if "unusual_amount" in d.flags:
        notes.append(f"That's much more than you usually send {payee.display_name}.")
    if shield.level == "caution":
        notes.append(shield.advice)
    d.say = (" ".join(notes) + " " if notes else "") + "I'll open your bank on your phone, fill it in and check the name before anything is sent."
    return d
