"""Before You Pay (SHIPPING §4.8): a check that stands between a person and a bank transfer.

Tempo never moves money (ADR 0003). It asks who, how much and why, and answers in plain words
with one of three verdicts. The rules, in the order they are applied; the first that fits wins:

1. STOP  the registers say this is a likely scam (Scam Shield's `assess`, passed in as a level).
2. STOP  the message or the reason mentions a "safe account" or asks for a code, PIN or
         password: either ask alone is a scam, whoever the payee is (`scam.BIG_ASKS`).
3. STOP  a new payee plus any pressure sign (act now, move your money, secrecy, gift cards).
4. WAIT  a known payee plus a pressure sign: the message is pushing you, so ring them first.
5. WAIT  a new payee and more than £1,000 (`LARGE_GBP`).
6. WAIT  any new payee: the cooling-off rule, "wait, and ring them on a number you already know".
7. WAIT  the registers said caution, or could not be checked.
8. PAY   otherwise, with the reminder that Tempo never moves money: the person does.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict

from tempo_core.scam import BIG_ASKS, Level, pressure_signs

Verdict = Literal["pay", "wait", "stop"]
LARGE_GBP = Decimal("1000")
COOLING_OFF = "wait, and ring them on a number you already know"
NEVER_MOVES = "Tempo never moves money. You make the payment yourself, or not at all."
PUSH = {
    "a safe account": "it talks about a safe account, which no bank asks for",
    "moving your money": "it tells you to move your money",
    "gift cards or crypto": "it asks for gift cards or crypto",
    "a deadline to act now": "it pushes you to act now",
    "a code or password": "it asks for a code, PIN or password",
    "secrecy": "it asks you to keep this secret",
}


class PayeeAdvice(BaseModel):
    model_config = ConfigDict(frozen=True)

    verdict: Verdict
    reasons: tuple[str, ...]
    say: str


def before_you_pay(
    payee_name: str,
    amount_gbp: Decimal,
    reason: str,
    *,
    new_payee: bool,
    message_text: str | None,
    registers_level: Level | None,
) -> PayeeAdvice:
    """Pay, wait or stop, with the reasons, from the rules in this module's docstring."""
    signs = pressure_signs(f"{message_text or ''}\n{reason}")
    pushes = [PUSH[s] for s in signs]
    reasons: list[str] = []
    if registers_level is Level.LIKELY_SCAM:
        reasons.append("the official registers flag this as a likely scam")
    if any(s in BIG_ASKS for s in signs) or (new_payee and signs):
        reasons += pushes
        if new_payee:
            reasons.append(f"you have not paid {payee_name} before")
    if reasons:
        return _advice("stop", payee_name, amount_gbp, reasons)
    reasons += pushes
    if new_payee:
        reasons.append(f"you have not paid {payee_name} before")
        if amount_gbp > LARGE_GBP:
            reasons.append(f"it is more than £{LARGE_GBP:,.0f}")
    if registers_level is Level.CAUTION:
        reasons.append("the official registers raise a doubt about this firm")
    if registers_level is Level.UNKNOWN:
        reasons.append("the official registers could not be checked just now")
    return _advice("wait" if reasons else "pay", payee_name, amount_gbp, reasons)


def _advice(verdict: Verdict, payee: str, amount: Decimal, reasons: list[str]) -> PayeeAdvice:
    why = " ".join(r[0].upper() + r[1:] + "." for r in reasons)
    if verdict == "stop":
        say = (
            f"Stop. Do not pay {payee} today. {why} Ring the firm on a number you already "
            "know, not one from the message."
        )
    elif verdict == "wait":
        say = f"Do not pay {payee} yet. {why} The best thing to do is {COOLING_OFF}. Then decide."
    else:
        say = (
            f"No warning signs found for paying {payee} £{amount:,.2f}. That does not prove it "
            f"is genuine, so only pay if you know why. {NEVER_MOVES}"
        )
    return PayeeAdvice(verdict=verdict, reasons=tuple(reasons), say=say)
