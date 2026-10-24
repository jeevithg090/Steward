"""The capability vocabulary (SHIPPING §4.1): eight words shared by mandates, profiles and guards.

`tempo_passport.ACTIONS` is the signed-mandate side of the same list. The domain core cannot
import the passport package (that would pull a signature verifier into pure code), so the words
live here as well, and `tests/unit/test_capabilities.py` fails the build if the two ever drift.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType

CAPABILITIES: frozenset[str] = frozenset(
    {
        "claim",
        "call",
        "accept_cash",
        "accept_voucher",
        "discuss_other_accounts",
        "change_contract",
        "share_personal_data",
        "escalate",
    }
)

# tempo_passport.MAX_LIFETIME in days: a mandate is for one matter, not a standing power.
MAX_MANDATE_DAYS = 7

# How a refusal names each word, as the verb phrase after "let me", so every guard says the same
# thing to the person and the Flesch gate can check it once.
IN_PLAIN_WORDS: Mapping[str, str] = MappingProxyType(
    {
        "claim": "file a claim",
        "call": "phone the company",
        "accept_cash": "accept cash",
        "accept_voucher": "accept vouchers",
        "discuss_other_accounts": "talk about your other accounts",
        "change_contract": "change your contract",
        "share_personal_data": "share your details",
        "escalate": "take this further",
    }
)


def check_capabilities(words: tuple[str, ...]) -> tuple[str, ...]:
    """Pydantic-style check shared by manifests and profiles: known words, each at most once."""
    unknown = sorted(set(words) - CAPABILITIES)
    if unknown:
        known = ", ".join(sorted(CAPABILITIES))
        raise ValueError(f"unknown capability {', '.join(unknown)}; the words are {known}")
    if len(set(words)) != len(words):
        raise ValueError("each capability may appear once")
    return words
