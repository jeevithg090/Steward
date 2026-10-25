"""Scam Shield for payments: is the person being pushed into this payment?

Ported from the Tempo repo's tempo_core/scam.py (pressure signs; "never say safe"). Here it looks at the person's
own request and at anything they quote ("the bank said to move my savings to a safe account"). The classic UK
authorised-push-payment scams all leave the same fingerprints: a "safe account", a deadline, a code, secrecy,
gift cards or crypto, someone claiming to be the bank or the police. Any big ask refuses the payment outright
and tells the person what to do instead; smaller signs make Kairos slow down and read the payment back twice.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

_DEADLINE = r"within (?:\d+|one|two|24) (?:hours?|minutes?)|act now|right now|immediately|urgent(?:ly)?|today only|before (?:midnight|the deadline)|or (?:it|your account) will be (?:closed|frozen|blocked)"
_CODES = r"one[- ]time (?:pass)?code|otp|\bpin\b|password|security code|passcode"
_SECRECY = r"\b(?:don'?t|do not) tell\b|\bkeep (?:this|it) (?:secret|quiet|between us)\b|\bnot to tell\b"
PRESSURE = {
    "a 'safe account'": re.compile(r"\bsafe account\b|\bsecure account\b|\bholding account\b", re.I),
    "moving your savings": re.compile(r"\b(?:move|transfer|empty)\b.{0,30}\b(?:all (?:my|the) money|savings|everything|whole balance)\b", re.I),
    "gift cards or crypto": re.compile(r"\b(?:gift ?cards?|itunes|steam cards?|bitcoin|crypto(?:currency)?|usdt|binance)\b", re.I),
    "a deadline to act now": re.compile(rf"\b(?:{_DEADLINE})\b", re.I),
    "a code or password": re.compile(rf"\b(?:{_CODES})\b", re.I),
    "secrecy": re.compile(_SECRECY, re.I),
    "someone claiming to be the bank or police": re.compile(
        r"\b(?:the bank|my bank|fraud (?:team|department)|the police|hmrc|tax office|amazon|microsoft|bt|royal mail)\b.{0,40}"
        r"\b(?:told|said|asked|called|rang|phoned|texted|instructed|needs? me|wants? me)\b|"
        r"\b(?:told|asked|instructed) (?:me )?(?:by|from) (?:the bank|my bank|the police|hmrc)\b", re.I),
    "a stranger or someone just met": re.compile(r"\b(?:someone i (?:met|matched with) online|my new (?:boyfriend|girlfriend|friend) online|an? (?:investment|trading) (?:adviser|advisor|manager) (?:i met )?online)\b", re.I),
}
BIG_ASKS = ("a 'safe account'", "a code or password", "gift cards or crypto")
ADVICE = {
    "likely_scam": ("This has the signs of a scam, so I won't send it. Your bank will never ask you to move money to a "
                    "'safe account', read out a code, or pay in gift cards or crypto. Hang up, wait a few minutes, and call "
                    "your bank on the number on your card. You can also call 159."),
    "caution": "Slow down. Nobody genuine needs you to do this in a hurry or in secret. Check with the firm on a number you already trust first.",
    "no_flags": "",
}


@dataclass
class Shield:
    level: str                      # likely_scam | caution | no_flags
    signs: List[str] = field(default_factory=list)
    advice: str = ""

    @property
    def refuse(self) -> bool:
        return self.level == "likely_scam"


def pressure_signs(text: str) -> List[str]:
    return [name for name, pattern in PRESSURE.items() if pattern.search(text or "")]


def assess(text: str) -> Shield:
    signs = pressure_signs(text)
    if any(s in BIG_ASKS for s in signs) or len(signs) >= 2:
        return Shield("likely_scam", signs, ADVICE["likely_scam"])
    if signs:
        return Shield("caution", signs, ADVICE["caution"])
    return Shield("no_flags", [], "")
