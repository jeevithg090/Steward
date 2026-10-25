"""Confirmation of Payee, done by the Navigator on the bank's own review screen.

Before Confirm is ever pressed, the screen's text is read back and compared with what the person asked for and
what the payee book says: the recipient's name (fuzzy, accent- and case-insensitive, word-order-insensitive),
the amount (to the penny), the account ending (if shown) and the reference (if shown). Anything short of a
match aborts the payment. Text on the screen that reads like instructions to an assistant is recorded as a flag
and never acted on.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional

from .money import parse as parse_amounts
from .payees import normalise, similarity

NAME_OK = 0.92        # at or above: the same name
NAME_CLOSE = 0.75     # between: suspiciously close (a typo, or a look-alike) -> abort and show the person
_NAME_CUES = re.compile(r"^(to|payee|recipient|paying|pay to|beneficiary|send to|sending to|name)\b[:\s]*", re.I)
_LAST4 = re.compile(r"(?:ending(?: in)?|ends in|\*{2,}|•{2,}|x{2,}|\.{3,})\s*(\d{4})\b|\b\d{2}-\d{2}-\d{2}\b\s*(\d{4})?(\d{4})\b", re.I)
_REF = re.compile(r"^(?:reference|ref|payment reference|memo|note|description)\b[:\s]*(.*)$", re.I)
_INLINE_TO = re.compile(r"\b(?:to|pay to|send to|paying)\s+(?P<name>[A-Za-z][A-Za-z .'&\-]{1,50}?)(?=\s*(?:\d|\?|$|,|\.|\(|\|))", re.I)
_PHONE = re.compile(r"\b0\d{9,10}\b|\b\+?\d{2,3}[ \-]?\d{3,4}[ \-]?\d{3}[ \-]?\d{3,4}\b|\b\d{5}\s\d{6}\b|\b\d{4}\s\d{3}\s\d{4}\b")
_INJECTION = re.compile(r"(ignore|disregard|forget)\b.{0,20}\b(previous|prior|above|all|your)\b.{0,20}\b(instruction|rule|check|limit)|"
                        r"\b(assistant|ai|agent|kairos|tempo|navigator)\b.{0,40}\b(approve|confirm|send|pay|proceed|tap)|"
                        r"\b(system prompt|new instructions|you must now|approve (?:now|immediately)|do not (?:ask|check|verify))\b|"
                        r"\burgent\b.{0,30}\b(approve|confirm|send)", re.I)


@dataclass
class Verification:
    ok: bool
    name_on_screen: Optional[str] = None
    name_score: float = 0.0
    amount_on_screen: Optional[Decimal] = None
    last4_on_screen: Optional[str] = None
    reference_on_screen: Optional[str] = None
    mismatches: List[str] = field(default_factory=list)   # fatal: name, amount, account, reference
    flags: List[str] = field(default_factory=list)        # close_match, screen_has_instructions, no_account_on_screen
    summary: str = ""

    def to_dict(self) -> dict:
        return {"ok": self.ok, "name_on_screen": self.name_on_screen, "name_score": round(self.name_score, 3),
                "amount_on_screen": str(self.amount_on_screen) if self.amount_on_screen is not None else None,
                "last4_on_screen": self.last4_on_screen, "reference_on_screen": self.reference_on_screen,
                "mismatches": self.mismatches, "flags": self.flags, "summary": self.summary}


def _candidates(lines: List[str]) -> List[str]:
    """Lines that could be a name: the value after a 'To:' cue, or the line right after a bare cue, or any
    short line of letters."""
    out = []
    for i, raw in enumerate(lines):
        line = " ".join(str(raw).split())
        if not line:
            continue
        m = _NAME_CUES.match(line)
        if m:
            rest = line[m.end():].strip(" :-")
            if rest:
                out.append(rest)
            elif i + 1 < len(lines):
                out.append(" ".join(str(lines[i + 1]).split()))
        if 2 <= len(line) <= 60 and re.fullmatch(r"[A-Za-z][A-Za-z .,'&\-]*", line) and not _NAME_CUES.match(line):
            out.append(line)
        for im in _INLINE_TO.finditer(line):  # "Send £20.00 to ARJUN GADDAM 07700 900821?"
            out.append(im.group("name").strip(" .,"))
    seen, uniq = set(), []
    for c in out:
        if c.lower() not in seen:
            seen.add(c.lower())
            uniq.append(c)
    return uniq


def verify_review(lines: List[str], expected_amount: Decimal, payee, reference: Optional[str] = None,
                  currency: str = "GBP") -> Verification:
    v = Verification(ok=False)
    text = "\n".join(str(x) for x in lines)
    if _INJECTION.search(text):
        v.flags.append("screen_has_instructions")

    # ---- name ----
    want = [n for n in (payee.bank_name, payee.display_name) if n]
    best_name, best = None, 0.0
    for cand in _candidates(lines):
        s = max(similarity(cand, w) for w in want)
        if s > best:
            best_name, best = cand, s
    v.name_on_screen, v.name_score = best_name, best
    if best >= NAME_OK:
        pass
    elif best >= NAME_CLOSE:
        v.flags.append("close_match")
        v.mismatches.append(f"name: the bank shows '{best_name}', your payee book says '{payee.display_name}'. Close, but not the same.")
    else:
        v.mismatches.append(f"name: the bank shows '{best_name or 'no name'}', not '{payee.display_name}'.")

    # ---- amount ----
    amounts = parse_amounts(text)
    cue_amounts = []
    for i, raw in enumerate(lines):
        if re.search(r"\b(amount|sending|you're sending|you are sending|pay|paying|total)\b", str(raw), re.I):
            for j in (i, i + 1):
                if j < len(lines):
                    cue_amounts += [a.value for a in parse_amounts(str(lines[j]))]
    values = [a.value for a in amounts]
    v.amount_on_screen = cue_amounts[0] if cue_amounts else (values[0] if values else None)
    if expected_amount not in values:
        shown = f"{v.amount_on_screen}" if v.amount_on_screen is not None else "no amount"
        v.mismatches.append(f"amount: the bank shows {shown}, you asked for {expected_amount}.")
    elif cue_amounts and expected_amount not in cue_amounts:
        v.mismatches.append(f"amount: the amount being sent reads {cue_amounts[0]}, you asked for {expected_amount}.")
    wrong_cur = [a for a in amounts if a.currency and a.currency != currency]
    if wrong_cur and not [a for a in amounts if a.currency == currency]:
        v.mismatches.append(f"currency: the bank shows {wrong_cur[0].currency}, not {currency}.")

    # ---- account ending ----
    m = _LAST4.search(text)
    if m:
        v.last4_on_screen = m.group(1) or m.group(3)
    if payee.account_last4:
        if v.last4_on_screen is None:
            v.flags.append("no_account_on_screen")
        elif v.last4_on_screen != payee.account_last4:
            v.mismatches.append(f"account: the bank shows an account ending {v.last4_on_screen}, your book says {payee.account_last4}.")

    # ---- phone number (mobile money) ----
    if payee.phone:
        digits = [re.sub(r"\D", "", m.group(0)) for m in _PHONE.finditer(text)]
        digits = [d for d in digits if len(d) >= 9]
        if digits and not any(d[-9:] == re.sub(r"\D", "", payee.phone)[-9:] for d in digits):
            v.mismatches.append(f"phone: the screen shows a number ending {digits[0][-4:]}, your book says {payee.phone[-4:]}.")

    # ---- reference ----
    want_ref = (reference or payee.reference or "").strip()
    for i, raw in enumerate(lines):
        mm = _REF.match(" ".join(str(raw).split()))
        if mm:
            val = mm.group(1).strip() or (" ".join(str(lines[i + 1]).split()) if i + 1 < len(lines) else "")
            v.reference_on_screen = val
            break
    if want_ref and v.reference_on_screen is not None and normalise(v.reference_on_screen) != normalise(want_ref):
        v.mismatches.append(f"reference: the bank shows '{v.reference_on_screen}', you asked for '{want_ref}'.")

    v.ok = not v.mismatches
    if v.ok:
        v.summary = (f"The bank's screen shows {payee.describe()} as '{best_name}' and the amount matches"
                     + (", account ending matches" if v.last4_on_screen and payee.account_last4 else "") + ".")
    else:
        v.summary = "Stopped before sending: " + " ".join(v.mismatches)
    if "screen_has_instructions" in v.flags:
        v.summary += " The screen also contained text addressed to an assistant, which was ignored."
    return v
