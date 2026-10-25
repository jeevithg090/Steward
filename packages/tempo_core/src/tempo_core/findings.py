"""Findings: what Tempo noticed in the places a person connected (plan.md §14), found by code.

Connector output is evidence, never instructions. Everything here is pure and deterministic: the
parsers read an email, a calendar entry or a bank line into facts, and the finding builders turn
those facts, plus what the rail records and Scam Shield said (the Gateway asks them), into plain
words: a title, a why, the sentence the chat understands (`say`) and one action. Nothing here
decides money: a late train's amount is the rule engine's, passed in.

Every title, why and say reads at Flesch 60 or more (tests/unit/test_findings.py), except the
quoted message inside a scam finding's `say`, which is shown as it arrived.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from email.utils import parseaddr
from itertools import pairwise
from typing import Any, Literal
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field, field_validator

from tempo_core.delays import LONDON
from tempo_core.intent import ALIASES, PROVIDERS, STATIONS, station_name
from tempo_core.links import Link, find_links, from_host
from tempo_core.scam import pressure_signs

FindingKind = Literal["late_train", "engineer_visit", "scam", "money_arrived", "letter"]
# The order a sweep shows its findings in (plan.md §14.1).
ORDER: tuple[FindingKind, ...] = ("late_train", "engineer_visit", "scam", "money_arrived", "letter")
MAX_SAY = 120  # a finding's say is also a chat chip (tempo_gateway.chat.MAX_SUGGESTION)
MISSIONS_HREF = "#/missions"
SCAM_ASK = "Is this a scam?"  # the frame of a scam finding's say; the rest is the quoted message
MONEY_SAY = "Am I owed anything else?"  # after money that has already arrived: what next


# --- what the connectors return ------------------------------------------------------------------


class MailMessage(BaseModel):
    """One email as the mail connector returns it: a `get_message` result or a search row."""

    model_config = ConfigDict(frozen=True, extra="ignore", validate_by_name=True)

    id: str
    sender: str = Field(default="", alias="from")
    to: str = ""
    subject: str = ""
    date: str = ""  # ISO 8601, as the connector gives it
    text: str = ""
    snippet: str = ""

    @property
    def body(self) -> str:
        return self.text or self.snippet


class CalendarEvent(BaseModel):
    """One `list_events` row."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    uid: str
    title: str = ""
    start: str = ""
    end: str = ""
    location: str = ""
    description: str = ""


class BankTransaction(BaseModel):
    """One `list_transactions` row: `amount_gbp` is signed, money in is positive."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    id: str
    date: str
    description: str = ""
    amount_gbp: Decimal

    @field_validator("amount_gbp", mode="before")
    @classmethod
    def _signed(cls, value: Any) -> Any:
        return str(value).replace("£", "").replace(",", "").strip() if value is not None else value


# --- the facts the finders pull out ---------------------------------------------------------------


class _Facts(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class TicketFacts(_Facts):
    item: str  # the message id
    seller: str  # "Trainline"
    origin_crs: str
    destination_crs: str
    travel_date: date
    departure: str  # HH:MM
    fare_gbp: Decimal
    operator: str | None = None


class VisitFacts(_Facts):
    item: str  # the event uid
    provider: str  # one of tempo_core.intent.PROVIDERS
    day: date
    window: str | None = None  # "8am to 1pm"


class CreditFacts(_Facts):
    item: str  # the transaction id
    day: date
    payer: str  # "Thames Water"
    amount_gbp: Decimal
    description: str  # the statement line, as the bank wrote it


# --- the finding (plan.md §14.2) ------------------------------------------------------------------


class FindingSource(_Facts):
    connector: str
    item: str  # what was read, in a few words


class FindingAction(_Facts):
    label: str
    href: str


class Finding(_Facts):
    id: str
    kind: FindingKind
    title: str
    why: str
    amount_gbp: str | None = None
    source: FindingSource
    say: str  # a sentence the chat understands
    action: FindingAction


# --- parsing helpers ------------------------------------------------------------------------------

_STATION_NAMES: dict[str, str] = {k.casefold(): v for k, v in (STATIONS | ALIASES).items()}
_AMBIGUOUS = frozenset({"reading", "bath", "victoria"})  # also ordinary words: capitals only
_STATION = re.compile(
    r"\b(" + "|".join(re.escape(n) for n in sorted(_STATION_NAMES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
_JOINER = re.compile(r"^\s*(?:to|→|->|–|—|-|>)\s*$", re.IGNORECASE)
_CLOCK = re.compile(r"\b(\d{1,2}):(\d{2})\s*(am|pm)?\b", re.IGNORECASE)
_MONEY = re.compile(r"£\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)")
_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
           "sep": 9, "oct": 10, "nov": 11, "dec": 12}  # fmt: skip
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
_DAY_MONTH = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MONTH + r"(?:,?\s+(\d{4}))?\b", re.IGNORECASE
)
_ISO_DAY = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_PARAGRAPH = re.compile(r"\n\s*\n")
_SLASH_DAY = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})\b")

_TICKET = re.compile(r"\be-?tickets?\b|\btickets?\b|\bbooking\b|\bitinerary\b", re.IGNORECASE)
_LINE_ORIGIN = re.compile(
    r"^\s*(?:from|origin|depart(?:s|ure|ing)?\s+from|leaving\s+from|leaving)\s*[:\-]\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
_LINE_DESTINATION = re.compile(
    r"^\s*(?:to|destination|arriv(?:es|al|ing)?\s+at|going\s+to)\s*[:\-]\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
_LINE_DEPARTURE = re.compile(  # "Departure time: 7:05pm", "departs Oxford 08:12"
    r"\b(?:depart(?:s|ure|ing)?|leaves|leaving|dep)\b\.?(?:\s+(?:time|at|from))*"
    r"(?:\s+[A-Za-z][A-Za-z'&]*(?:\s+[A-Za-z][A-Za-z'&]*){0,3}?)?\s*[:\-]?\s*"
    r"(\d{1,2}):(\d{2})\s*(am|pm)?",
    re.IGNORECASE,
)
_LINE_DATE = re.compile(
    r"^\s*(?:date(?:\s+of\s+travel)?|travel\s+date|journey\s+date|outward(?:\s+journey)?"
    r"|travelling\s+on|valid\s+on)\s*[:\-]\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
_LINE_FARE = re.compile(
    r"\b(?:total(?:\s+(?:paid|cost|price|fare|amount))?|amount\s+paid|you\s+paid|ticket\s+price"
    r"|price|fare|cost)\b\s*[:\-]?\s*£\s?(\d{1,5}(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
_LINE_OPERATOR = re.compile(
    r"^\s*(?:operator|train\s+company|train\s+operator|operated\s+by|carrier)\s*[:\-]?\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)

_VISIT = re.compile(
    r"\bengineers?\b|\binstall(?:ation|er|ing)?\b|\btechnician\b|\bappointment\b|\bvisit\b"
    r"|\bfitting\b|\bset[- ]?up\b",
    re.IGNORECASE,
)
_PROVIDER = {name: re.compile(pattern) for name, pattern in PROVIDERS.items()}

_BANK_NOISE = re.compile(
    r"\b(?:refund|credit|bgc|fpi|fps|faster\s+payments?|bank\s+giro(?:\s+credit)?|payment|bacs"
    r"|ref(?:erence)?\s*[:#]?\s*[A-Z0-9-]*\d[A-Z0-9-]*|[A-Z]*\d[\dA-Z/-]*)\b",
    re.IGNORECASE,
)
_REFUNDISH = re.compile(
    r"\b(?:refund(?:ed)?|repay|compensation|goodwill|rebate|overpayment|credit\s+note)\b",
    re.IGNORECASE,
)
_ACRONYMS = frozenset({"HMRC", "DWP", "GWR", "BT", "EE", "TFL", "NHS", "SSE", "EDF", "UK"})
# Money bait a scam email leans on; with a suspicious link or pressure, enough to ask Scam Shield.
_BAIT = re.compile(
    r"tax refund|you have won|\bprize\b|verify your|confirm your (?:details|identity|account)"
    r"|update your (?:details|account|payment)|account (?:will be|has been|is) (?:locked"
    r"|suspended|closed|frozen|blocked)|unusual activity|suspicious activity|\bunpaid\b"
    r"|final (?:notice|warning)|safe account|one[- ]time (?:code|passcode)|legal action",
    re.IGNORECASE,
)


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _gbp(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def spoken_day(day: date) -> str:
    """23 October: how the chat says a date (no year; `intent.extract` reads it back the same)."""
    return f"{day.day} {day:%B}"


def chat_href(say: str) -> str:
    """The web chat, opened with this sentence ready to send."""
    return "#/chat?say=" + quote(say, safe="")


def finding_id(kind: str, connector: str, item: str) -> str:
    digest = hashlib.sha256(f"{kind}|{connector}|{item}".encode()).hexdigest()[:12]
    return f"f_{kind}_{digest}"


def _when(raw: str) -> datetime | date | None:
    """An ISO date or date-time; an aware one in UK time. None when it can't be read."""
    raw = raw.strip()
    if not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            return None
    if moment.tzinfo is not None:
        moment = moment.astimezone(LONDON)
    if len(raw) == 10:  # a bare date parses as midnight
        return moment.date()
    return moment


def _day_of(raw: str) -> date | None:
    found = _when(raw)
    if isinstance(found, datetime):
        return found.date()
    return found


def _valid(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _date_in(text: str, *, near: date | None) -> date | None:
    """The first date written in the text. Without a year, the most recent one on or before
    `near` (when the email was sent): a ticket's journey has a year even if its line doesn't."""
    if m := _ISO_DAY.search(text):
        return _valid(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if m := _DAY_MONTH.search(text):
        day, month = int(m.group(1)), _MONTHS[m.group(2).casefold()[:3]]
        if m.group(3):
            return _valid(int(m.group(3)), month, day)
        return _recent(day, month, near)
    if m := _SLASH_DAY.search(text):
        year = int(m.group(3)) if len(m.group(3)) == 4 else 2000 + int(m.group(3))
        return _valid(year, int(m.group(2)), int(m.group(1)))
    return None


def _recent(day: int, month: int, near: date | None) -> date | None:
    if near is None:
        return None
    found = _valid(near.year, month, day)
    if found is not None and found > near:
        return _valid(near.year - 1, month, day)
    return found


def _hhmm(hour: str, minute: str, meridiem: str | None) -> str | None:
    h, m = int(hour), int(minute)
    if meridiem:
        if not 1 <= h <= 12:
            return None
        h = (0 if h == 12 else h) + (12 if meridiem.casefold() == "pm" else 0)
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return f"{h:02d}:{m:02d}"


def _station_hits(text: str) -> list[tuple[int, int, str]]:
    hits: list[tuple[int, int, str]] = []
    for m in _STATION.finditer(text):
        name = m.group(1)
        if name.casefold() in _AMBIGUOUS and not name[0].isupper():
            continue
        hits.append((m.start(), m.end(), _STATION_NAMES[name.casefold()]))
    return hits


def _first_station(text: str) -> str | None:
    hits = _station_hits(text)
    return hits[0][2] if hits else None


def _journey(text: str) -> tuple[str | None, str | None]:
    """Origin and destination: labelled lines first, then "X to Y" (a time between them is fine:
    "08:12 Oxford → 08:50 London Paddington"), then the first two stations named."""
    origin = next((s for m in _LINE_ORIGIN.finditer(text) if (s := _first_station(m.group(1)))),
                  None)  # fmt: skip
    destination = next(
        (s for m in _LINE_DESTINATION.finditer(text) if (s := _first_station(m.group(1)))), None
    )
    if origin and destination:
        return origin, destination
    hits = _station_hits(text)
    for (_, end, first), (start, _, second) in pairwise(hits):
        gap = _CLOCK.sub(" ", text[end:start])
        if first != second and _JOINER.match(gap):
            return origin or first, destination or second
    distinct = list(dict.fromkeys(crs for _, _, crs in hits))
    if origin is None and distinct:
        origin = distinct[0]
    if destination is None:
        destination = next((crs for crs in distinct if crs != origin), None)
    return origin, destination


def _departure(text: str, origin: str | None) -> str | None:
    if m := _LINE_DEPARTURE.search(text):
        return _hhmm(m.group(1), m.group(2), m.group(3))
    times = [(m.start(), m.end(), _hhmm(m.group(1), m.group(2), m.group(3)))
             for m in _CLOCK.finditer(text)]  # fmt: skip
    if origin is not None:  # "08:12 Oxford": the time written just before the origin
        for start, _, crs in _station_hits(text):
            if crs != origin:
                continue
            before = [t for _, end, t in times if end <= start and start - end <= 4 and t]
            if before:
                return before[-1]
    return next((t for _, _, t in times if t), None)


def _fare(text: str) -> Decimal | None:
    if m := _LINE_FARE.search(text):
        return _gbp(m.group(1))
    m = _MONEY.search(text)
    return _gbp(m.group(1)) if m else None


def _operator(text: str) -> str | None:
    m = _LINE_OPERATOR.search(text)
    if m is None:
        return None
    name = m.group(1).strip().strip(".")
    return name[:60] or None


def _seller(sender: str) -> str:
    """Who sent the email, by name: "Trainline <tickets@thetrainline.com>" is Trainline."""
    name, address = parseaddr(sender)
    if name.strip():
        return name.strip()
    host = address.rpartition("@")[2]
    label = host.split(".")[-3] if host.count(".") >= 2 else host.split(".")[0]
    return label.removeprefix("the").title() or "the sender"


def _sender_host(sender: str) -> str | None:
    address = parseaddr(sender)[1]
    host = address.rpartition("@")[2].strip().strip(">").casefold()
    return host or None


# --- the finders ----------------------------------------------------------------------------------


def tickets_in(messages: Iterable[MailMessage]) -> list[TicketFacts]:
    """Rail e-tickets (Trainline-style): the journey, its day and time, the fare and operator.
    A message counts only when it reads as a ticket and every claim fact is in it."""
    found: list[TicketFacts] = []
    for message in messages:
        text = f"{message.subject}\n{message.body}"
        if not _TICKET.search(text):
            continue
        origin, destination = _journey(text)
        sent = _day_of(message.date)
        labelled = (_date_in(m.group(1), near=sent) for m in _LINE_DATE.finditer(text))
        dated = next((d for d in labelled if d), None) or _date_in(text, near=sent)
        departure = _departure(text, origin)
        fare = _fare(text)
        if not (origin and destination and dated and departure and fare is not None):
            continue
        found.append(
            TicketFacts(
                item=message.id, seller=_seller(message.sender), origin_crs=origin,
                destination_crs=destination, travel_date=dated, departure=departure,
                fare_gbp=fare, operator=_operator(text),
            )
        )  # fmt: skip
    return found


def visits_in(events: Iterable[CalendarEvent]) -> list[VisitFacts]:
    """Engineer or installation visits from a provider Tempo knows, with the day and window."""
    found: list[VisitFacts] = []
    for event in events:
        text = f"{event.title}\n{event.description}\n{event.location}"
        if not _VISIT.search(text):
            continue
        provider = next((name for name, p in _PROVIDER.items() if p.search(text)), None)
        start, end = _when(event.start), _when(event.end)
        day = start.date() if isinstance(start, datetime) else start
        if provider is None or day is None:
            continue
        window = None
        if isinstance(start, datetime) and isinstance(end, datetime) and end > start:
            window = f"{_clock_words(start)} to {_clock_words(end)}"
        found.append(VisitFacts(item=event.uid, provider=provider, day=day, window=window))
    return found


def scam_candidates(messages: Iterable[MailMessage]) -> list[MailMessage]:
    """Emails worth asking Scam Shield about: a link or sender that isn't what it seems,
    pressure to act, or money bait. Shield decides; this only picks what to ask about."""
    picked: list[MailMessage] = []
    for message in messages:
        text = f"{message.subject}\n{message.body}"
        links: list[Link] = list(find_links(text))
        host = _sender_host(message.sender)
        if host:
            links.append(from_host(host))
        if any(link.suspicious for link in links) or pressure_signs(text) or _BAIT.search(text):
            picked.append(message)
    return picked


def credits_in(transactions: Iterable[BankTransaction]) -> list[CreditFacts]:
    """Money in (a positive amount) with the payer's name from the statement line."""
    found: list[CreditFacts] = []
    for row in transactions:
        day = _day_of(row.date)
        if row.amount_gbp <= 0 or day is None:
            continue
        payer = payer_name(row.description)
        if not payer:
            continue
        found.append(
            CreditFacts(
                item=row.id, day=day, payer=payer, amount_gbp=row.amount_gbp,
                description=" ".join(row.description.split()),
            )
        )  # fmt: skip
    return found


def payer_name(description: str) -> str:
    """The payer's name from a statement line: "THAMES WATER REFUND" is Thames Water."""
    words = _BANK_NOISE.sub(" ", description).replace("*", " ").split()
    return " ".join(w.upper() if w.upper() in _ACRONYMS else w.capitalize() for w in words)


def looks_like_refund(credit: CreditFacts) -> bool:
    return bool(_REFUNDISH.search(credit.description))


def promised_by(credit: CreditFacts, messages: Iterable[MailMessage]) -> MailMessage | None:
    """The email that said this money was coming: it names the payer and the exact amount."""
    words = [w.casefold() for w in credit.payer.split()]
    amount = _money(credit.amount_gbp)
    for message in messages:
        text = f"{message.sender}\n{message.subject}\n{message.body}".casefold()
        if (
            words
            and all(w in text for w in words)
            and re.search(r"(?<![\d.])" + re.escape(amount) + r"(?![\d])", text)
        ):
            return message
    return None


def _clock_words(moment: datetime) -> str:
    """8am, 1pm, 8:30am."""
    hour = moment.hour % 12 or 12
    suffix = "am" if moment.hour < 12 else "pm"
    return f"{hour}{suffix}" if moment.minute == 0 else f"{hour}:{moment.minute:02d}{suffix}"


# --- the findings ---------------------------------------------------------------------------------


def late_train_finding(
    ticket: TicketFacts,
    delay_minutes: int | None,
    amount: Decimal,
    *,
    cancelled: bool = False,
    under_way: bool = False,
) -> Finding:
    """A ticket the rail records say was late (or cancelled), with the rule engine's amount. When
    a claim for this journey is already under way, the finding says so and opens Mission Control.
    """
    origin, destination = station_name(ticket.origin_crs), station_name(ticket.destination_crs)
    dep, day, fare, owed = ticket.departure, spoken_day(ticket.travel_date), ticket.fare_gbp, amount
    train = f"My {dep} train from {origin} to {destination}"
    if cancelled:
        happened = "was cancelled"
        say = f"{train} on {day} was cancelled. It cost £{_money(fare)}."
    else:
        happened = f"was {delay_minutes} minutes late"
        say = f"{train} was {delay_minutes} minutes late on {day}. It cost £{_money(fare)}."
    shows = f"Your {ticket.seller} ticket shows the {dep} from {origin} to {destination} on {day}."
    if under_way:
        title = f"Your {dep} to {destination}: I am on it"
        why = f"{shows} A claim for it has already started. Mission Control shows where it is."
        action = FindingAction(label="Open Mission Control", href=MISSIONS_HREF)
    else:
        title = f"Your {dep} to {destination} {happened}: £{_money(owed)} to claim"
        why = (
            f"{shows} It cost £{_money(fare)}. The rail records say it {happened}, so you can "
            f"claim £{_money(owed)} back."
        )
        action = FindingAction(label=f"Claim £{_money(owed)}", href=chat_href(say))
    return Finding(
        id=finding_id("late_train", "mail", ticket.item), kind="late_train", title=title, why=why,
        amount_gbp=_money(owed), source=FindingSource(
            connector="mail", item=f"{ticket.seller} e-ticket, {day}"
        ), say=say, action=action,
    )  # fmt: skip


def engineer_visit_finding(
    visit: VisitFacts, today: date, *, under_way: bool = False
) -> Finding | None:
    """A booked visit that is now in the past: Tempo asks "Did they come?". None for a visit
    still to come (or today's, which may yet happen)."""
    if visit.day >= today:
        return None
    day, provider = spoken_day(visit.day), visit.provider
    say = f"The {provider} engineer did not come on {day}. Can you help?"
    booked = f"{day}, {visit.window}" if visit.window else day
    if under_way:
        title = f"The {provider} visit on {day}: I am on it"
        why = "A claim for this visit has already started. Mission Control shows where it is."
        action = FindingAction(label="Open Mission Control", href=MISSIONS_HREF)
    else:
        title = f"Did they come? {provider} had an engineer booked for {day}."
        why = (
            f"Your calendar has a {provider} engineer booked for {booked}. If no one came, "
            f"{provider} may owe you money for it."
        )
        action = FindingAction(label="They didn't come", href=chat_href(say))
    return Finding(
        id=finding_id("engineer_visit", "calendar", visit.item), kind="engineer_visit",
        title=title, why=why, source=FindingSource(
            connector="calendar", item=f"{provider} engineer visit, {day}"
        ), say=say, action=action,
    )  # fmt: skip


def scam_finding(message: MailMessage, verdict: Mapping[str, Any]) -> Finding | None:
    """An email Scam Shield calls a likely scam (or one to be careful with). None otherwise:
    Tempo never says an email is safe, it just has nothing to flag."""
    level = str(verdict.get("level", ""))
    if level not in ("likely_scam", "caution"):
        return None
    who = _claimed_by(message, verdict)
    if level == "likely_scam":
        title = f"The email from “{who}” is a trick"
        why = (
            f"Scam Shield says it is not from {who}. Do not click its link, reply or pay. If you "
            f"are not sure, call {who} on a number you trust."
        )
        label = "See why it's a trick"
    else:
        title = f"Take care with the email from “{who}”"
        why = (
            f"Scam Shield found warning signs in it. Do not click its link or pay until you have "
            f"checked with {who} on a number you trust."
        )
        label = "See the warning signs"
    say = scam_say(message)
    subject = " ".join(message.subject.split()) or "no subject"
    return Finding(
        id=finding_id("scam", "mail", message.id), kind="scam", title=title, why=why,
        source=FindingSource(connector="mail", item=f"Email: {subject[:80]}"), say=say,
        action=FindingAction(label=label, href=chat_href(say)),
    )  # fmt: skip


def scam_say(message: MailMessage) -> str:
    """The question and the email's own words, as many as fit in a chip: the subject and the
    paragraph with the link if both fit, else that paragraph, else the start of the email. A
    link that would be cut off is left out whole, never broken."""
    room = MAX_SAY - len(SCAM_ASK) - 1
    subject = " ".join(message.subject.split())
    if subject and subject[-1] not in ".!?":
        subject += "."
    paragraphs = [" ".join(p.split()) for p in _PARAGRAPH.split(message.body) if p.strip()]
    linked = next((p for p in paragraphs if find_links(p)), None)
    whole = " ".join([subject, *paragraphs]).strip()
    options = [f"{subject} {linked}".strip(), linked] if linked else []
    words = next((o for o in [*options, whole] if o and len(o) <= room), None)
    if words is None:
        words = whole[: room + 1].rsplit(" ", 1)[0].rstrip(" ,;:")
    return f"{SCAM_ASK} {words}"


def _claimed_by(message: MailMessage, verdict: Mapping[str, Any]) -> str:
    """Who the email pretends to be: the brand its link imitates, else the sender's name."""
    for link in verdict.get("links") or []:
        for found in link.get("findings") or []:
            key, _, brand = str(found).partition(":")
            if key == "brand_lookalike" and brand:
                return brand.upper() if len(brand) <= 4 else brand.title()
    return _seller(message.sender)


def money_arrived_finding(credit: CreditFacts, matched: MailMessage | None) -> Finding:
    """Money that already reached the bank: nothing to do. `matched` is the email (or letter)
    that said it was coming, when one did."""
    day, amount, payer = spoken_day(credit.day), _money(credit.amount_gbp), credit.payer
    told = (
        "Their email said this money was coming"
        if matched is not None
        else "It looks like a refund, and it has come"
    )
    return Finding(
        id=finding_id("money_arrived", "bank", credit.item), kind="money_arrived",
        title=f"{payer} paid £{amount} into your bank",
        why=f"Your bank shows £{amount} from {payer} on {day}. {told}, so there is nothing to do.",
        amount_gbp=amount,
        source=FindingSource(connector="bank", item=f"{credit.description}, {day}"),
        say=MONEY_SAY, action=FindingAction(label="Check what else I'm owed",
                                            href=chat_href(MONEY_SAY)),
    )  # fmt: skip


def in_order(findings: Iterable[Finding]) -> list[Finding]:
    """late_train, engineer_visit, scam, money_arrived (then letter); stable within a kind."""
    return sorted(findings, key=lambda f: ORDER.index(f.kind))
