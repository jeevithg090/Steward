"""Findings (plan.md §14): the parsers on inline emails, calendar entries and statement lines, and
the four findings' wording: plain (Flesch ≥ 60), and each `say` a sentence the chat routes to the
right door with the right facts."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any
from urllib.parse import unquote

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tempo_core.findings import (
    MAX_SAY,
    MISSIONS_HREF,
    MONEY_SAY,
    SCAM_ASK,
    BankTransaction,
    CalendarEvent,
    CreditFacts,
    Finding,
    MailMessage,
    TicketFacts,
    VisitFacts,
    chat_href,
    credits_in,
    engineer_visit_finding,
    in_order,
    late_train_finding,
    looks_like_refund,
    money_arrived_finding,
    payer_name,
    promised_by,
    scam_candidates,
    scam_finding,
    scam_say,
    tickets_in,
    visits_in,
)
from tempo_core.intent import Intent, classify, extract
from tempo_core.readability import flesch_reading_ease
from tempo_gateway.chat import CANNED, SWEEP_EMPTY, SWEEP_FOUND, Chat, ChatTurn, sweep_sentence
from tempo_gateway.events import EventBus

TODAY = date(2026, 10, 25)
PLAIN = 60


def mail(
    item: str, sender: str, subject: str, text: str, sent: str = "2026-10-21T19:04:12+01:00"
) -> MailMessage:
    return MailMessage.model_validate(
        {"id": item, "from": sender, "to": "Margaret <margaret@example.com>", "subject": subject,
         "date": sent, "text": text, "attachments": []}
    )  # fmt: skip


TRAINLINE = mail(
    "trainline-eticket",
    "Trainline <tickets@trainline.example>",
    "Your e-ticket: Oxford to London Paddington, Fri 23 Oct",
    """Hello Margaret,

Thanks for booking with Trainline. Your e-ticket is ready.

YOUR JOURNEY
Oxford to London Paddington

Outward: Fri 23 October 2026, departs Oxford 08:12, arrives London Paddington 09:15
Return: any Off-Peak train from London Paddington to Oxford, Fri 23 October 2026

Ticket: Off-Peak Day Return, £28.40
Operator: Great Western Railway

Total paid: £28.40
""",
)
LABELLED = mail(
    "labelled",
    "tickets@thetrainline.example",
    "Booking confirmed",
    """Your ticket
From: Reading
To: Didcot Parkway
Date: 21/10/2026
Departure time: 7:05pm
Price: £6.50
""",
)
HMRC = mail(
    "hmrc",
    "HMRC Refunds <refunds@hmrc-gov-uk.example>",
    "HMRC: you are due a tax refund",
    """Dear Customer,

After the last annual calculation of your tax we have found that you paid
too much.

You are due a tax refund of 248.20 GBP. Claim within 24 hours at http://hmrc-refunds-gov.uk/claim

If you do not claim within 24 hours your refund will be cancelled.
""",
    sent="2026-10-24T06:41:09+01:00",
)
THAMES = mail(
    "thames",
    "Thames Water <billing@thameswater.example>",
    "You have paid too much: we are refunding £23.40",
    "Amount you overpaid: £23.40\nWe will refund £23.40 to the bank account you pay us from.",
    sent="2026-10-03T08:30:00+01:00",
)
LIBRARY = mail(
    "library",
    "Your Library <reminders@library.example>",
    "Reminder: 2 books due back on Tue 27 October",
    "These books are due back on Tuesday 27 October 2026. There are no fines on your account.",
)
MARKETING = mail(  # stations and a price, but no journey of hers: no date, no time
    "offers", "GWR <offers@gwr.example>", "Cheap tickets", "Oxford to Paddington from £9!"
)

ENGINEER = CalendarEvent(
    uid="bb-visit", title="Broadbandly engineer visit", start="2026-10-19T08:00:00+01:00",
    end="2026-10-19T13:00:00+01:00", location="Home",
    description="Engineer to fix the broadband. Account ref BB-4417.",
)  # fmt: skip
GP = CalendarEvent(
    uid="gp", title="GP appointment", start="2026-10-14T10:20:00+01:00",
    end="2026-10-14T10:30:00+01:00", location="The Surgery", description="Blood pressure check.",
)  # fmt: skip
SKY_ALL_DAY = CalendarEvent(uid="sky", title="Sky installation", start="2026-11-02",
                            end="2026-11-03")  # fmt: skip
TRAIN_EVENT = CalendarEvent(
    uid="train", title="Train to London (08:12 from Oxford)", start="2026-10-23T08:12:00+01:00",
    end="2026-10-23T09:15:00+01:00", location="Oxford station",
)  # fmt: skip

STATEMENT = [
    BankTransaction(id="t1", date="2026-10-01", description="DWP STATE PENSION",
                    amount_gbp=Decimal("921.00")),
    BankTransaction.model_validate({"id": "t2", "date": "2026-10-09",
                                    "description": "THAMES WATER REFUND", "amount_gbp": "+23.40"}),
    BankTransaction.model_validate({"id": "t3", "date": "2026-10-21", "description": "TRAINLINE",
                                    "amount_gbp": "-28.40"}),
]  # fmt: skip

TICKET = tickets_in([TRAINLINE])[0]
VISIT = visits_in([ENGINEER])[0]
CREDIT = next(c for c in credits_in(STATEMENT) if c.payer == "Thames Water")
WARNED: dict[str, Any] = {  # the parts of ShieldService.check's answer a finding reads
    "level": "likely_scam", "zone": "warn",
    "links": [{"url": "http://hmrc-refunds-gov.uk/claim", "host": "hmrc-refunds-gov.uk",
               "findings": ["brand_lookalike:hmrc", "insecure_http"]}],
}  # fmt: skip


def slots(text: str, intent: Intent) -> dict[str, str]:
    return {k: v for k, v in extract(text, today=TODAY, intent=intent).model_dump().items() if v}


def the_four() -> list[Finding]:
    found = [
        late_train_finding(TICKET, 38, Decimal("14.20")),
        engineer_visit_finding(VISIT, TODAY),
        scam_finding(HMRC, WARNED),
        money_arrived_finding(CREDIT, THAMES),
    ]
    return [f for f in found if f is not None]


# --- the parsers -----------------------------------------------------------------------------------


def test_a_trainline_eticket_is_read_into_the_claim_facts() -> None:
    [ticket] = tickets_in([TRAINLINE])

    assert ticket == TicketFacts(
        item="trainline-eticket", seller="Trainline", origin_crs="OXF", destination_crs="PAD",
        travel_date=date(2026, 10, 23), departure="08:12", fare_gbp=Decimal("28.40"),
        operator="Great Western Railway",
    )  # fmt: skip


def test_a_labelled_ticket_with_a_pm_time_and_a_slash_date_is_read_too() -> None:
    [ticket] = tickets_in([LABELLED])

    assert (ticket.origin_crs, ticket.destination_crs) == ("RDG", "DID")
    assert (ticket.travel_date, ticket.departure, ticket.fare_gbp) == (
        date(2026, 10, 21), "19:05", Decimal("6.50")
    )  # fmt: skip
    assert ticket.seller == "Trainline"  # no display name: the sender's domain, plainly
    assert ticket.operator is None


def test_the_departure_is_the_time_the_train_leaves_not_the_first_time_written() -> None:
    booked = mail(
        "booked", "Trainline <t@trainline.example>", "Your tickets",
        "Booked on 21 Oct at 19:04.\nOutward: Fri 23 October 2026, departs Oxford 08:12, arrives "
        "London Paddington 09:15\nTotal paid: £28.40",
    )  # fmt: skip

    [ticket] = tickets_in([booked])

    assert (ticket.departure, ticket.travel_date) == ("08:12", date(2026, 10, 23))
    assert (ticket.origin_crs, ticket.destination_crs) == ("OXF", "PAD")


def test_mail_that_is_not_a_ticket_of_hers_gives_no_ticket() -> None:
    assert tickets_in([HMRC, THAMES, LIBRARY, MARKETING]) == []


def test_engineer_visits_need_a_provider_and_keep_the_window() -> None:
    assert visits_in([ENGINEER, GP, TRAIN_EVENT]) == [
        VisitFacts(item="bb-visit", provider="Broadbandly", day=date(2026, 10, 19),
                   window="8am to 1pm")
    ]  # fmt: skip
    [sky] = visits_in([SKY_ALL_DAY])
    assert (sky.provider, sky.day, sky.window) == ("Sky", date(2026, 11, 2), None)


def test_credits_are_money_in_with_the_payer_named_plainly() -> None:
    assert [(c.payer, c.amount_gbp, c.day) for c in credits_in(STATEMENT)] == [
        ("DWP State Pension", Decimal("921.00"), date(2026, 10, 1)),
        ("Thames Water", Decimal("23.40"), date(2026, 10, 9)),
    ]
    assert payer_name("HMRC REF 88213 REFUND") == "HMRC"
    assert payer_name("FPI GWR DELAY REPAY 77") == "GWR Delay Repay"
    assert looks_like_refund(CREDIT)
    assert not looks_like_refund(credits_in(STATEMENT)[0])


def test_a_credit_is_matched_to_the_email_that_promised_it_by_payer_and_exact_amount() -> None:
    assert promised_by(CREDIT, [LIBRARY, THAMES]) == THAMES
    assert promised_by(CREDIT, [LIBRARY, HMRC]) is None
    other = CreditFacts(item="x", day=date(2026, 10, 9), payer="Thames Water",
                        amount_gbp=Decimal("3.40"), description="THAMES WATER")  # fmt: skip
    assert promised_by(other, [THAMES]) is None  # 3.40 is not 23.40


def test_only_the_trick_is_a_scam_candidate() -> None:
    assert scam_candidates([TRAINLINE, HMRC, THAMES, LIBRARY]) == [HMRC]


def test_a_scam_say_quotes_the_paragraph_with_the_link_and_fits_a_chip() -> None:
    said = scam_say(HMRC)

    assert said == (
        "Is this a scam? You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
        "http://hmrc-refunds-gov.uk/claim"
    )
    assert len(said) <= MAX_SAY
    long = mail(
        "long", "a@b.example", "Hello", "word " * 80 + "https://example.com/x " + "end " * 9
    )
    cut = scam_say(long)
    assert cut.startswith(f"{SCAM_ASK} Hello.") and len(cut) <= MAX_SAY
    assert "https://exam" not in cut or "https://example.com/x" in cut  # never a broken link


# --- the findings ----------------------------------------------------------------------------------


def test_the_late_train_finding_carries_the_rules_amount_and_a_claimable_say() -> None:
    finding = late_train_finding(TICKET, 38, Decimal("14.20"))

    assert finding.kind == "late_train" and finding.amount_gbp == "14.20"
    assert finding.say == (
        "My 08:12 train from Oxford to Paddington was 38 minutes late on 23 October. "
        "It cost £28.40."
    )
    assert classify(finding.say) is Intent.RAIL_DELAY
    assert slots(finding.say, Intent.RAIL_DELAY) == {
        "origin_crs": "OXF", "destination_crs": "PAD", "travel_date": "2026-10-23",
        "departure": "08:12", "fare_gbp": "28.40", "delay_minutes": "38",
    }  # fmt: skip
    assert finding.action.label == "Claim £14.20"
    assert unquote(finding.action.href.removeprefix("#/chat?say=")) == finding.say
    assert finding.source.connector == "mail"


def test_a_claim_already_under_way_opens_mission_control_instead() -> None:
    finding = late_train_finding(TICKET, 38, Decimal("14.20"), under_way=True)

    assert finding.action.href == MISSIONS_HREF
    assert "already started" in finding.why
    visit = engineer_visit_finding(VISIT, TODAY, under_way=True)
    assert visit is not None and visit.action.href == MISSIONS_HREF


def test_a_cancelled_train_says_cancelled_and_still_routes_to_the_rail_door() -> None:
    finding = late_train_finding(TICKET, None, Decimal("28.40"), cancelled=True)

    assert "cancelled" in finding.title and "cancelled" in finding.say
    assert classify(finding.say) is Intent.RAIL_DELAY
    assert slots(finding.say, Intent.RAIL_DELAY)["fare_gbp"] == "28.40"


def test_the_engineer_visit_asks_did_they_come_only_once_it_is_past() -> None:
    finding = engineer_visit_finding(VISIT, TODAY)

    assert finding is not None and finding.title.startswith("Did they come?")
    assert classify(finding.say) is Intent.MISSED_VISIT
    assert slots(finding.say, Intent.MISSED_VISIT) == {
        "operator": "Broadbandly", "event_date": "2026-10-19"
    }  # fmt: skip
    assert "8am to 1pm" in finding.why
    assert engineer_visit_finding(VISIT, date(2026, 10, 19)) is None  # today: it may yet happen
    assert engineer_visit_finding(VISIT, date(2026, 10, 1)) is None  # still to come


def test_the_scam_finding_follows_scam_shield_and_never_calls_anything_safe() -> None:
    finding = scam_finding(HMRC, WARNED)

    assert finding is not None and finding.kind == "scam" and finding.amount_gbp is None
    assert "HMRC" in finding.title and "trick" in finding.title
    assert classify(finding.say) is Intent.SCAM_CHECK
    caution = scam_finding(HMRC, {"level": "caution", "zone": "quiet", "links": []})
    assert caution is not None and caution.title.startswith("Take care")
    assert scam_finding(HMRC, {"level": "no_flags", "zone": "quiet"}) is None
    assert scam_finding(HMRC, {"level": "unknown", "zone": "quiet"}) is None


def test_money_that_arrived_needs_nothing_and_offers_what_else_is_owed() -> None:
    matched = money_arrived_finding(CREDIT, THAMES)
    unmatched = money_arrived_finding(CREDIT, None)

    assert (
        matched.amount_gbp == "23.40" and matched.title == "Thames Water paid £23.40 into your bank"
    )
    assert "nothing to do" in matched.why and "email said" in matched.why
    assert "looks like a refund" in unmatched.why
    assert matched.say == MONEY_SAY and classify(MONEY_SAY) is Intent.ENTITLEMENT
    assert matched.source.connector == "bank"


def test_findings_come_in_the_sweeps_order_with_the_contract_shape() -> None:
    four = the_four()

    assert [f.kind for f in in_order(reversed(four))] == [
        "late_train", "engineer_visit", "scam", "money_arrived"
    ]  # fmt: skip
    for finding in four:
        shape = finding.model_dump(mode="json")
        assert set(shape) == {"id", "kind", "title", "why", "amount_gbp", "source", "say", "action"}
        assert set(shape["source"]) == {"connector", "item"}
        assert set(shape["action"]) == {"label", "href"}
        assert len(finding.say) <= MAX_SAY
    assert len({f.id for f in four}) == 4
    assert four[0].id == late_train_finding(TICKET, 38, Decimal("14.20")).id  # stable


def _wording() -> list[tuple[str, str]]:
    variants = [
        *the_four(),
        late_train_finding(TICKET, 38, Decimal("14.20"), under_way=True),
        late_train_finding(TICKET, None, Decimal("28.40"), cancelled=True),
        engineer_visit_finding(VISIT, TODAY, under_way=True),
        scam_finding(HMRC, {"level": "caution", "zone": "quiet", "links": []}),
        money_arrived_finding(CREDIT, None),
    ]
    out: list[tuple[str, str]] = []
    for f in variants:
        assert f is not None
        say = SCAM_ASK if f.kind == "scam" else f.say  # the rest of a scam's say is the quote
        out += [(f"{f.kind}.title", f.title), (f"{f.kind}.why", f.why), (f"{f.kind}.say", say)]
    return out


@pytest.mark.parametrize(("name", "text"), _wording())
def test_every_title_why_and_say_reads_plainly(name: str, text: str) -> None:
    score = flesch_reading_ease(text)

    assert score >= PLAIN, f"{name} reads at {score:.0f}: {text}"


@pytest.mark.parametrize("provider", ["BT", "Sky", "Virgin Media", "TalkTalk", "Openreach"])
def test_the_visit_question_reads_plainly_for_every_provider(provider: str) -> None:
    visit = VisitFacts(item="v", provider=provider, day=date(2026, 10, 19))
    finding = engineer_visit_finding(visit, TODAY)

    assert finding is not None
    for text in (finding.title, finding.why, finding.say):
        assert flesch_reading_ease(text) >= PLAIN, text
    assert classify(finding.say) is Intent.MISSED_VISIT


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=600), st.text(max_size=80), st.text(max_size=30))
def test_any_email_or_event_parses_without_error(text: str, subject: str, when: str) -> None:
    message = mail("x", "someone <a@b.example>", subject, text, sent=when)
    event = CalendarEvent(uid="x", title=subject, start=when, end=when, description=text)

    assert isinstance(tickets_in([message]), list)
    assert isinstance(visits_in([event]), list)
    assert isinstance(scam_candidates([message]), list)
    assert len(scam_say(message)) <= MAX_SAY
    row = BankTransaction(id="x", date=when, description=text[:40], amount_gbp=Decimal("1.00"))
    assert isinstance(credits_in([row]), list)


def test_chat_hrefs_carry_the_say_url_encoded() -> None:
    assert chat_href("Am I owed anything else?") == "#/chat?say=Am%20I%20owed%20anything%20else%3F"


# --- the chat door's words ---------------------------------------------------------------------------


def test_the_sweep_sentences_read_plainly() -> None:
    four = sweep_sentence(4, ["email", "calendar", "bank"])

    assert four == (
        "I found four things worth a look in your email, calendar and bank. "
        "I kept none of what I read."
    )
    assert sweep_sentence(1, ["email"]).startswith("I found one thing worth a look in your email.")
    assert sweep_sentence(0, ["calendar", "bank"]).startswith(
        "I looked in your calendar and bank and found nothing to do."
    )
    for text in (four, sweep_sentence(1, ["email"]), sweep_sentence(0, ["calendar", "bank"]),
                 sweep_sentence(12, ["bank"]), CANNED["sweep_off"], CANNED["sweep_nothing_on"]):  # fmt: skip
        assert flesch_reading_ease(text) >= PLAIN, text
    assert "{count}" in SWEEP_FOUND and "{places}" in SWEEP_EMPTY


class _NoMissions:
    def __init__(self) -> None:
        self.mission_ids: list[str] = []


async def test_without_a_hub_the_sweep_points_to_the_connectors_page() -> None:
    chat = Chat(
        _NoMissions(),  # type: ignore[arg-type]
        shield=None, memory=None, profiles=None, bus=EventBus(), llm_say=None,
        today=lambda: TODAY, simulated=[],
    )  # fmt: skip

    reply = await chat.turn(ChatTurn(user_id="u_margaret", text="check my email"), "web:test")

    assert reply.intent is Intent.SWEEP
    assert reply.reply == CANNED["sweep_off"] and reply.findings is None
    assert reply.actions is not None and reply.actions[0].href == "#/connectors"
