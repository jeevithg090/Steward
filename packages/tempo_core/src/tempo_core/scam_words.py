"""What Scam Shield says out loud when an on-device signal fires (SHIPPING §4.8).

The phone sends only a signal's id and the sender's domain (skills/scam-shield/signals.yaml), so
the warning is built from the ids alone and never quotes the message. The warning comes first,
then why, in plain words. Every string here is Flesch-checked in tests/unit/test_plain_language.py.
"""

from __future__ import annotations

from collections.abc import Iterable

SIGNAL_WARNING = (
    "Do not touch that message. It looks like a trick to take your money. "
    "Ring the firm on a number you already know."
)
SIGNAL_WORDS = {
    "scam_safe_account": "it talks about a safe account, which no bank asks for",
    "scam_code_request": "it asks for a code, PIN or password",
    "scam_urgency": "it pushes you to act now",
    "scam_account_threat": "it says your account will be closed or locked",
    "scam_short_link": "it has a shortened or look-alike link",
    "scam_official_pretext": (
        "it pretends to be a tax refund, a parcel fee or your bank's fraud team"
    ),
}


def warning(signal_ids: Iterable[str]) -> str:
    """The spoken warning, then the reasons the ids name. Unknown ids add nothing."""
    why = [SIGNAL_WORDS[s] for s in dict.fromkeys(signal_ids) if s in SIGNAL_WORDS]
    if not why:
        return SIGNAL_WARNING
    joined = why[0] if len(why) == 1 else ", ".join(why[:-1]) + " and " + why[-1]
    return f"{SIGNAL_WARNING} Why: {joined}."
