"""Scam Shield (build plan S7.3): is this message from who it says, and is it pushing you?

Pure rules over what the registers said. The rule that matters most: Tempo never says "safe".
The best answer is "no warning signs found", and if a register couldn't be reached the answer
is "unknown", because a clone firm's whole trick is to look like a real one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum


class Level(StrEnum):
    LIKELY_SCAM = "likely_scam"
    CAUTION = "caution"
    UNKNOWN = "unknown"  # a register couldn't be checked
    NO_FLAGS = "no_flags"  # never "safe"


@dataclass(frozen=True)
class FirmCheck:
    """What the registers said about the firm a message claims to be from. None = not checked
    (the register was unreachable)."""

    name: str
    on_warning_list: bool | None = None
    fca_authorised: bool | None = None  # on the FCA Register as authorised
    contact_matches_register: bool | None = None  # the message's phone/website are the firm's
    company_active: bool | None = None  # Companies House: not dissolved
    company_age_days: int | None = None


@dataclass(frozen=True)
class Verdict:
    level: Level
    reasons: tuple[str, ...]
    advice: str = field(default="")


_DEADLINE = r"within (\d+|one|two|24) (hours?|minutes?)|act now|immediately|urgent(ly)?|today only"
_CODES = r"one[- ]time (pass)?code|otp|pin|password|security code"
_SECRECY = r"\b(don'?t|do not) tell\b|\bkeep (this|it) (secret|between us)\b"
PRESSURE = {
    "a safe account": re.compile(r"\bsafe account\b", re.I),
    "moving your money": re.compile(r"\b(move|transfer)\b.{0,30}\b(money|savings|funds)\b", re.I),
    "gift cards or crypto": re.compile(
        r"\b(gift ?cards?|itunes|bitcoin|crypto(currency)?|usdt)\b", re.I
    ),
    "a deadline to act now": re.compile(rf"\b({_DEADLINE})\b", re.I),
    "a code or password": re.compile(rf"\b({_CODES})\b", re.I),
    "secrecy": re.compile(_SECRECY, re.I),
}
BIG_ASKS = ("a safe account", "a code or password")  # alone, either one means "likely scam"
ADVICE = {
    Level.LIKELY_SCAM: "Don't reply, click or pay. Call the firm on the number from its own "
    "website or your bank card, never one from the message.",
    Level.CAUTION: "Slow down. Check with the firm on a number you already trust before doing "
    "anything.",
    Level.UNKNOWN: "I couldn't check the official registers just now, so I can't tell. Don't act "
    "on the message until we can.",
    Level.NO_FLAGS: "No warning signs found. That doesn't prove it's genuine: never move money "
    "because a message or caller told you to.",
}


def pressure_signs(text: str) -> list[str]:
    return [name for name, pattern in PRESSURE.items() if pattern.search(text)]


def assess(text: str, firm: FirmCheck | None) -> Verdict:
    reasons: list[str] = []
    signs = pressure_signs(text)
    if firm is not None and firm.on_warning_list:
        reasons.append(f"the FCA warns about {firm.name}")
    if firm is not None and firm.fca_authorised and firm.contact_matches_register is False:
        reasons.append(
            f"it uses {firm.name}'s name with contact details that aren't theirs (a clone)"
        )
    if asks := [s for s in signs if s in BIG_ASKS]:
        reasons.append("it asks for " + " and ".join(asks))
    if reasons:
        return _verdict(Level.LIKELY_SCAM, reasons + [f"it uses pressure: {s}" for s in signs])
    if firm is not None and firm.company_active is False:
        reasons.append(f"{firm.name} is dissolved at Companies House")
    if firm is not None and firm.company_age_days is not None and firm.company_age_days < 30:
        reasons.append(f"{firm.name} was registered only {firm.company_age_days} days ago")
    reasons += [f"it uses pressure: {s}" for s in signs]
    if reasons:
        return _verdict(Level.CAUTION, reasons)
    if firm is not None and None in (
        firm.on_warning_list,
        firm.fca_authorised,
        firm.company_active,
    ):
        return _verdict(Level.UNKNOWN, ["an official register couldn't be checked"])
    return _verdict(Level.NO_FLAGS, [])


def _verdict(level: Level, reasons: list[str]) -> Verdict:
    return Verdict(level, tuple(reasons), ADVICE[level])
