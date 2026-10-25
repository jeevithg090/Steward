"""What the chat says next and how it says a failure (plan.md §12.2): the suggestion chips, the
plain fail-safe for a journey the rail records don't have, and the rule that no Python repr ever
reaches a reply."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import pytest

from tempo_adapters.rail import ReplayRail
from tempo_core.errors import ServiceNotFound
from tempo_core.intent import Intent, classify, extract
from tempo_core.models import MissionState
from tempo_core.readability import flesch_reading_ease
from tempo_gateway.chat import (
    CANNED,
    MAX_SUGGESTION,
    NOT_FOUND,
    QUOTED,
    SUGGESTIONS,
    Chat,
    ChatTurn,
    readable,
)
from tempo_gateway.events import EventBus
from tempo_gateway.missions import MissionView

TODAY = date(2026, 10, 25)
EVERY = sorted({s for chips in SUGGESTIONS.values() for s in chips})
REPR = re.compile(r"datetime|\(\s*'|\[\s*'|\{\s*'")
# Where each chip leads when it is sent: the door it opens, and the facts it must carry.
LEADS_TO = {
    "My 08:12 train from Oxford to Paddington was 38 minutes late on 23 October. It cost £28.40.": (
        Intent.RAIL_DELAY,
        {"origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-23",
         "departure": "08:12", "fare_gbp": "28.40", "delay_minutes": "38"},
    ),
    "The Broadbandly engineer did not come on 19 October. No one rang.": (
        Intent.MISSED_VISIT, {"operator": "Broadbandly", "event_date": "2026-10-19"},
    ),
    "Is this a scam? HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim": (Intent.SCAM_CHECK, {}),
    "Am I owed anything?": (Intent.ENTITLEMENT, {}),
    "Show me my profiles": (Intent.PROFILES, {}),
    "How much have you got back for me?": (Intent.LEDGER, {}),
    "What do you remember about me?": (Intent.MEMORY_RECALL, {}),
}  # fmt: skip


@pytest.mark.parametrize("chip", EVERY)
def test_every_chip_is_short_plain_and_opens_the_door_it_promises(chip: str) -> None:
    assert len(chip) <= MAX_SUGGESTION
    if chip not in QUOTED:  # the pasted scam text is a quote, said as it arrived
        assert flesch_reading_ease(chip) >= 60, chip
    if chip == "£28.40":  # the answer to "What did the ticket cost?", not a sentence of its own
        return
    intent, slots = LEADS_TO[chip]
    assert classify(chip) is intent
    found = {k: v for k, v in extract(chip, today=TODAY, intent=intent).model_dump().items() if v}
    assert found == slots


def test_the_doors_offer_four_chips_and_no_list_is_longer() -> None:
    assert len(SUGGESTIONS["doors"]) == 4
    assert all(1 <= len(chips) <= 4 for chips in SUGGESTIONS.values())
    assert set(EVERY) >= QUOTED


def test_the_unrecorded_journey_is_read_back_plainly_from_the_persons_facts() -> None:
    said = NOT_FOUND.format(
        departure="08:12", origin="Oxford", destination="Paddington", day="24 October"
    )

    assert (
        said
        == "I couldn't find the 08:12 from Oxford to Paddington on 24 October in the rail records."
    )
    assert flesch_reading_ease(said) >= 60
    assert flesch_reading_ease(f"{said} {CANNED['demo_journeys']}") >= 60
    other = NOT_FOUND.format(departure="07:30", origin="Reading", destination="Didcot", day="2 May")
    assert flesch_reading_ease(other) >= 60


async def test_the_replay_adapter_says_which_journey_in_words_not_a_tuple() -> None:
    with pytest.raises(ServiceNotFound) as missing:
        await ReplayRail([]).service_delay("OXF", "PAD", date(2026, 10, 24), "08:12")

    said = str(missing.value)
    assert said == "no recorded journey for the 08:12 from Oxford to Paddington on 24 October 2026"
    assert not REPR.search(said)


@pytest.mark.parametrize(
    ("engine", "said"),
    [
        ("I couldn't find that train in the rail records (no recorded journey for "
         "('OXF', 'PAD', datetime.date(2026, 10, 24), '0812')).",
         "I couldn't find that train in the rail records."),
        ("Tempo can't claim from this operator yet (Decimal('1.0')).",
         "Tempo can't claim from this operator yet."),
        ("GWR has paid you £14.20 (reference GW-12345).", "GWR has paid you £14.20 (reference GW-12345)."),
        ("Broken: {'mission_id': 'm_1'}", CANNED["stopped_safe"]),
    ],
)  # fmt: skip
def test_no_python_repr_reaches_a_reply(engine: str, said: str) -> None:
    assert readable(engine) == said
    assert not REPR.search(readable(engine))


# --- a finished claim offers what to ask next ------------------------------------------------------


class _Service:
    """Just enough of MissionService for one yes that finds the money already paid."""

    def __init__(self) -> None:
        self.mission_ids = ["m_1"]
        self.answered: list[str] = []

    async def user_for(self, mission_id: str) -> str:
        return "u_margaret"

    def pending_for(self, mission_id: str) -> str | None:
        return None if self.answered else "r_1"

    async def answer(self, request_id: str, approval: Any) -> MissionView:
        self.answered.append(request_id)
        return MissionView(
            id="m_1", state=MissionState.VERIFIED,
            message="GWR (a simulated company) has paid you £14.20 (reference GWR-12345).",
        )  # fmt: skip


async def test_a_yes_that_finds_the_claim_paid_suggests_the_ledger_and_memory() -> None:
    service = _Service()
    chat = Chat(
        service,  # type: ignore[arg-type]
        shield=None, memory=None, profiles=None, bus=EventBus(), llm_say=None,
        today=lambda: TODAY, simulated=[],
    )  # fmt: skip

    reply = await chat.turn(ChatTurn(user_id="u_margaret", text="yes"), "web:test")

    assert service.answered == ["r_1"]
    assert reply.intent is Intent.APPROVE and reply.mission is not None
    assert reply.suggestions == [
        "How much have you got back for me?",
        "What do you remember about me?",
    ]


def test_the_same_claim_again_is_said_plainly_in_every_state() -> None:
    paid = "GWR (a simulated company) has paid you £14.20 (reference GWR-12345). That's 20 minutes of your time back."  # the engine's verified message

    for said in (
        CANNED["already_asking"], CANNED["already_waiting"], CANNED["already_handled"],
        f"{CANNED['already_claimed']} {paid}",
    ):  # fmt: skip
        assert flesch_reading_ease(said) >= 60, said
    assert SUGGESTIONS["already_paid"] == ("How much have you got back for me?",)
