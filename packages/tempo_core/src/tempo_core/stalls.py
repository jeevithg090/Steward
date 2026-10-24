"""Stall Radar (spec §10): the tactics companies use to waste people's time, and the counters.

The live classifier is rules only, so it answers in microseconds during a call and never guesses:
an unrecognised phrase is None. Model-based classification belongs to the post-call audit.
"""

from __future__ import annotations

import re
from enum import StrEnum


class Stall(StrEnum):
    CALLBACK_DEFLECTION = "callback_deflection"
    TRANSFER_LOOP = "transfer_loop"
    POLICY_WALL = "policy_wall"
    FORM_DEFLECTION = "form_deflection"
    INFORMATION_FISHING = "information_fishing"
    HOLD_EXTENSION = "hold_extension"
    LOWBALL_OFFER = "lowball_offer"
    DENIAL_WITHOUT_REASON = "denial_without_reason"


COUNTER_PLAY = {
    Stall.CALLBACK_DEFLECTION: "Ask for a reference and a deadline now.",
    Stall.TRANSFER_LOOP: "Note the transfer count and ask for a supervisor.",
    Stall.POLICY_WALL: "Ask which clause they mean and cite the published scheme.",
    Stall.FORM_DEFLECTION: "Say a phone claim is being made and ask them to log it.",
    Stall.INFORMATION_FISHING: "Confirm the information was already provided.",
    Stall.HOLD_EXTENSION: "Log the minutes; they go on the Time Invoice.",
    Stall.LOWBALL_OFFER: "Decline per policy and restate the entitlement.",
    Stall.DENIAL_WITHOUT_REASON: "Ask for the reason in writing and state the escalation date.",
}

_PATTERNS: dict[Stall, tuple[str, ...]] = {
    Stall.CALLBACK_DEFLECTION: (r"call (you )?back", r"get (someone|somebody) to (call|ring)",
                                r"working days", r"we'?ll be in touch"),
    Stall.TRANSFER_LOOP: (r"transfer(ring)? you", r"put you through", r"another department",
                          r"wrong department"),
    Stall.POLICY_WALL: (r"(it'?s|that'?s) (our|the) policy", r"terms and conditions",
                        r"not something we (can )?do", r"policy (doesn'?t|does not) allow"),
    Stall.FORM_DEFLECTION: (r"(online|web) ?form", r"on (our|the) website", r"in writing only",
                            r"use the app"),
    Stall.INFORMATION_FISHING: (r"(again|once more)\b.*(number|details|name)",
                                r"(number|details|name)\b.*\b(again|once more)",
                                r"date of birth", r"(re)?confirm your (details|address)",
                                r"security questions?"),
    Stall.HOLD_EXTENSION: (r"(continue to |please )?hold", r"bear with me", r"one moment",
                           r"call is important"),
    Stall.LOWBALL_OFFER: (r"voucher", r"goodwill gesture", r"(the )?most I can (do|offer)",
                          r"final offer"),
    Stall.DENIAL_WITHOUT_REASON: (r"not eligible", r"can'?t help (you )?with that",
                                  r"(claim|request) (is|has been) (declined|rejected|closed)"),
}  # fmt: skip

_COMPILED = {
    stall: [re.compile(p, re.IGNORECASE) for p in patterns] for stall, patterns in _PATTERNS.items()
}


def classify(quote: str) -> Stall | None:
    """The first tactic the quote matches, in the order above, or None."""
    for stall, patterns in _COMPILED.items():
        if any(p.search(quote) for p in patterns):
            return stall
    return None
