"""The chat's intent router (plan.md §4.1): rules read a sentence, pull the facts out, and say
which one question to ask next. No model is involved.

Pure and deterministic: the same text and the same `today` always give the same answer, so the
router is tested on a vector file (`fixtures/chat/intents.json`) that the web app's TypeScript
port runs against too. Code decides money, time and permissions; a model may only phrase small
talk, and that happens elsewhere (`tempo_gateway.chat`).

Rules, in order: STOP wins; YES/NO when a question is pending (or the whole text is a yes/no);
"sweep", "check my email", "find what I'm owed", or "owed" with her email, inbox or bank named
(and no link, pressure or question about one message) → `sweep`; a link, "scam", "is this
real", "got a text" or pressure words → `scam_check`; "forget …" → `memory_forget`;
"remember" → `memory_recall`; "how much … back" → `ledger`; "letter" → `letter`; an engineer,
a missed visit or a provider → `missed_visit`; a train, a delay, a station or a time →
`rail_delay`; "owed", a benefit → `entitlement`; "profile" → `profiles`; "help" (or nothing) →
`help`; else `smalltalk`.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal
from enum import StrEnum
from itertools import pairwise

from pydantic import BaseModel, ConfigDict


class Intent(StrEnum):
    RAIL_DELAY = "rail_delay"
    MISSED_VISIT = "missed_visit"
    SCAM_CHECK = "scam_check"
    LETTER = "letter"
    MEMORY_RECALL = "memory_recall"
    MEMORY_FORGET = "memory_forget"
    LEDGER = "ledger"
    ENTITLEMENT = "entitlement"
    APPROVE = "approve"
    DECLINE = "decline"
    STOP = "stop"
    PROFILES = "profiles"
    SWEEP = "sweep"  # look through the connected email, calendar and bank (plan.md §14.2)
    HELP = "help"
    SMALLTALK = "smalltalk"


class Slots(BaseModel):
    """The facts a sentence gave, as strings the mission bodies accept. None means not said."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    origin_crs: str | None = None
    destination_crs: str | None = None
    travel_date: str | None = None  # YYYY-MM-DD
    departure: str | None = None  # HH:MM
    fare_gbp: str | None = None  # "28.40"
    delay_minutes: str | None = None  # "38"
    operator: str | None = None  # the provider, e.g. "Broadbandly"
    event_date: str | None = None  # YYYY-MM-DD, the missed visit
    notice_hours: str | None = None  # "0" when nobody warned them
    account_ref: str | None = None
    forget_target: str | None = None  # the words after "forget"


RAIL_FIELDS: tuple[str, ...] = (
    "origin_crs",
    "destination_crs",
    "travel_date",
    "departure",
    "fare_gbp",
)
VISIT_FIELDS: tuple[str, ...] = ("operator", "event_date")

# The one question for each missing fact, in plain words (Flesch ≥ 60, checked in tests).
QUESTIONS: dict[str, str] = {
    "origin_crs": "Which station did you leave from?",
    "destination_crs": "Where were you going?",
    "travel_date": "What day was it?",
    "departure": "What time did the train leave?",
    "fare_gbp": "What did the ticket cost?",
    "operator": "Which company was it?",
    "event_date": "What day was the visit?",
}

# Stations the chat understands, by their usual name. CRS codes are what the rail port wants.
STATIONS: dict[str, str] = {
    "Oxford": "OXF", "Paddington": "PAD", "Reading": "RDG", "Didcot": "DID", "Banbury": "BAN",
    "Slough": "SLO", "Swindon": "SWI", "Bristol Temple Meads": "BRI", "Cardiff": "CDF",
    "Birmingham New Street": "BHM", "Manchester Piccadilly": "MAN", "Leeds": "LDS",
    "Edinburgh": "EDB", "King's Cross": "KGX", "Euston": "EUS", "Waterloo": "WAT",
    "Victoria": "VIC", "Liverpool Street": "LST", "Marylebone": "MYB", "Bath Spa": "BTH",
}  # fmt: skip
# Other ways people say the same station. Add here, never to STATIONS (which names each code).
ALIASES: dict[str, str] = {
    "London Paddington": "PAD", "Didcot Parkway": "DID", "Bristol": "BRI",
    "Cardiff Central": "CDF", "Birmingham": "BHM", "Manchester": "MAN",
    "Edinburgh Waverley": "EDB", "Kings Cross": "KGX", "London King's Cross": "KGX",
    "London Kings Cross": "KGX", "London Euston": "EUS", "London Waterloo": "WAT",
    "London Victoria": "VIC", "London Liverpool Street": "LST", "London Marylebone": "MYB",
    "Bath": "BTH",
}  # fmt: skip
_NAMES: dict[str, str] = {k.casefold(): v for k, v in (STATIONS | ALIASES).items()}
_CODES: frozenset[str] = frozenset(STATIONS.values())
# Also ordinary words: only a capital letter, "from/to" in front, or a very short text makes
# them a station.
_AMBIGUOUS = frozenset({"reading", "bath", "victoria"})
_STATION_RE = re.compile(
    r"\b(" + "|".join(re.escape(n) for n in sorted(_NAMES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
_CRS_RE = re.compile(r"\b(" + "|".join(sorted(_CODES)) + r")\b")

# Providers whose engineers miss visits (Ofcom's automatic compensation scheme and the demo's own).
# The short names are matched case-sensitively, so "ee" and "now" in a sentence stay words.
PROVIDERS: dict[str, str] = {
    "Broadbandly": r"(?i:\bbroadbandly\b)",
    "Virgin Media": r"(?i:\bvirgin(?:\s+media)?\b)",
    "TalkTalk": r"(?i:\btalk\s?talk\b)",
    "Vodafone": r"(?i:\bvodafone\b)",
    "Plusnet": r"(?i:\bplus\.?net\b)",
    "Openreach": r"(?i:\bopenreach\b)",
    "BT": r"\bBT\b|(?i:\bbt\b)(?=\s+(?i:engineer|broadband|appointment|visit))",
    "EE": r"\bEE\b",
    "Sky": r"\bSky\b",
    "Now": r"(?i:\bnow\s+(?:broadband|tv)\b)",
}
_PROVIDER_RE = {name: re.compile(pattern) for name, pattern in PROVIDERS.items()}

# --- the words each rule looks for ---------------------------------------------------------------
_STOP = re.compile(
    r"^(?:please\s+|tempo,?\s+)?stop\b|\bstop\s+(?:everything|all|it|now|please|this|tempo)\b"
    r"|\bcancel\s+everything\b",
    re.IGNORECASE,
)
_YES_CORE = frozenset({"yes", "yeah", "yep", "yup", "ok", "okay", "approve", "approved", "sure",
                       "ahead"})  # fmt: skip
_YES_FILL = frozenset({"go", "do", "it", "please", "thanks", "thank", "you", "tempo", "fine",
                       "that's", "thats", "now"})  # fmt: skip
_NO_CORE = frozenset({"no", "nope", "nah", "decline", "declined", "don't", "dont", "cancel",
                      "not"})  # fmt: skip
_NO_FILL = frozenset({"thanks", "thank", "you", "please", "do", "leave", "it", "now", "tempo"})
_YES_START = re.compile(r"^(?:yes|yeah|yep|yup|ok|okay|sure|approve|go ahead)\b", re.IGNORECASE)
_NO_START = re.compile(
    r"^(?:no|nope|nah|don't|do not|decline|not now|leave it|cancel)\b", re.IGNORECASE
)
_WORD = re.compile(r"[a-z']+")

_URL = re.compile(
    r"https?://\S+|\bwww\.\S+"
    r"|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,6}/\S+"  # a host with a path: rb.gy/4k2q
    r"|\b(?:bit\.ly|rb\.gy|t\.co|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|cutt\.ly)\b"
    r"|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|co\.uk|org\.uk|gov\.uk|uk|net|org|info|biz|xyz"
    r"|top|click|link|online|site|live|shop)\b",
    re.IGNORECASE,
)
_SCAM_ASK = re.compile(
    r"\bscams?\b|\bscammers?\b|\bfraud\b|\bphishing\b|\bsuspicious\b|\bdodgy\b|\blegit\b"
    r"|is (?:this|it|that) (?:real|genuine|true|right|safe|legit)"
    r"|(?:got|received|had|sent|have) (?:a|an|this|another) (?:text|message|sms|email|e-mail"
    r"|call|whatsapp|voicemail)"
    r"|someone (?:texted|rang|called|phoned|emailed|messaged)"
    r"|(?:this|the|a) (?:text|message|email) (?:says|said|saying)"
    r"|\bcheck (?:this|that|the|my|a) (?:text|message|sms|email|link|number)",
    re.IGNORECASE,
)
# A pasted message: one strong pressure phrase, or two weak ones, is enough to check it.
_PRESSURE_STRONG = re.compile(
    r"safe account|one[- ]time (?:code|passcode|password)|\botp\b|\bpasscode\b|tax refund"
    r"|you have won|\bprize\b|account (?:will be|has been|is|is being) (?:locked|suspended|closed"
    r"|frozen|blocked)|verify your|confirm your (?:details|identity|account)"
    r"|update your (?:details|account|payment)|legal action|\barrest\b|move your (?:money|savings"
    r"|funds)|send (?:us|me) the code|read (?:me|out) the code",
    re.IGNORECASE,
)
_PRESSURE_WEAK = re.compile(
    r"\burgent(?:ly)?\b|\bimmediately\b|act now|within 24 hours|\bparcel\b|redeliver|click (?:here"
    r"|the link|below)|unusual activity|suspicious activity|\bunpaid\b|outstanding (?:fee|payment"
    r"|balance)|final (?:notice|warning)|congratulations|dear customer|\bexpires? (?:today|soon)"
    r"|\bfee\b",
    re.IGNORECASE,
)
_FORGET_WORD = re.compile(r"\b(?:forget|erase|delete)\b", re.IGNORECASE)
_FORGET = re.compile(
    r"\b(?:forget|erase|delete|remove)\b\s*(?:about\s+|that\s+|what you (?:know|remember) about\s+"
    r"|the memory (?:about|of)\s+|everything about\s+)?(.*?)\s*[.!?]*$",
    re.IGNORECASE | re.DOTALL,
)
_RECALL = re.compile(
    r"\bremember\b|\bmemory\b|\bmemories\b|what do you know about me|what have you got on me"
    r"|what do you have on me",
    re.IGNORECASE,
)
_LEDGER = re.compile(
    r"\bledger\b|how much (?:have|has|did) (?:you|tempo)\b.*\b(?:back|recovered|saved|won|got"
    r"|made)\b|how much\b.*\bback\b|\bhours? (?:back|returned|saved)\b|\btotals?\b|\btally\b"
    r"|what have you (?:got|won|saved)(?: me)? back|how (?:much|many)\b.*\b(?:saved|returned"
    r"|recovered)\b",
    re.IGNORECASE,
)
_LETTER = re.compile(
    r"\bletters?\b|\bread (?:this|it|that|me)\b|read it to me|what does (?:this|it) say"
    r"|\bphoto\b|\bcamera\b|\bscan\b|brown envelope|council tax|\bdwp\b|pip decision",
    re.IGNORECASE,
)
_VISIT_STRONG = re.compile(
    r"\bengineers?\b|missed (?:visit|appointment)|\bappointments?\b|\bvisit\b|\binstallation\b"
    r"|no-show",
    re.IGNORECASE,
)
_VISIT_WEAK = re.compile(  # "never came" is a visit unless a train is in the sentence
    r"(?:didn't|did not|never|failed to|hasn't|has not) (?:turn(?:ed)? up|show(?:ed)?(?: up)?|come"
    r"|came|arrive|arrived)|(?:no one|nobody|no-one) (?:came|turned up|showed up|arrived)",
    re.IGNORECASE,
)
_RAIL_STRONG = re.compile(
    r"\btrains?\b|\brail\b|\brailway\b|delay repay|\bplatform\b|\bcarriage\b", re.IGNORECASE
)
_RAIL = re.compile(
    r"\btrains?\b|\blate\b|\bdelay(?:ed|s)?\b|\bcancell?ed\b|delay repay|\brail\b|\brailway\b"
    r"|\bplatform\b|\bcarriage\b",
    re.IGNORECASE,
)
_ENTITLEMENT = re.compile(
    r"\bowed\b|\bbenefits?\b|pension credit|attendance allowance|\bentitled\b|\bentitlements?\b"
    r"|universal credit|council tax (?:reduction|support)|winter fuel|\bpip\b|carer'?s allowance"
    r"|housing benefit|what (?:can|could) i claim|am i (?:due|owed|missing)",
    re.IGNORECASE,
)
_PROFILES = re.compile(r"\bprofiles?\b|who (?:do|are) you work(?:ing)? for", re.IGNORECASE)
# The connectors' sweep (plan.md §14.2). Checked before Scam Shield, so "check my email" is a sweep
# unless the text carries a link, pressure or a question about one message ("I got an email…");
# "Am I owed anything?" stays an entitlement question unless her email, inbox or bank is named.
_SWEEP = re.compile(
    r"\bsweep\b|\b(?:check|look (?:through|at|in)|go through|search|scan) my (?:e-?mails?|inbox"
    r"|mail(?:box)?|calendar|bank statements?)\b|\bfind (?:what|money|anything|everything)\b"
    r"[\w\s']*\bowed\b",
    re.IGNORECASE,
)
_SWEEP_PLACE = re.compile(r"\b(?:e-?mails?|inbox|mailbox|bank)\b", re.IGNORECASE)
_OWED = re.compile(r"\bowed\b", re.IGNORECASE)
_HELP = re.compile(
    r"\bhelp\b|what can you do|how does this work|what do you do|what are you\b|what is tempo",
    re.IGNORECASE,
)

# --- the facts ------------------------------------------------------------------------------------
_TIME = re.compile(r"\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?![\d/])", re.IGNORECASE)
_CLOCK = re.compile(r"\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])", re.IGNORECASE)
_THE_TIME = re.compile(r"\bthe\s+$", re.IGNORECASE)
_TIME_AFTER = re.compile(r"^\s*(?:train|service|from|to|out of|departure)\b", re.IGNORECASE)
_MONEY = r"(\d{1,4}(?:\.\d{1,2})?)"
_FARES = (
    re.compile(r"£\s?" + _MONEY),
    re.compile(_MONEY + r"\s?(?:pounds?|quid|gbp)\b", re.IGNORECASE),
    re.compile(
        r"(?:cost|costs|fare|paid|price|ticket was)\s+(?:me\s+)?(?:about\s+|around\s+)?(?:£\s?)?"
        + _MONEY
        + r"\b",
        re.IGNORECASE,
    ),
)
_NUMBER_WORDS = {"an": 1, "a": 1, "one": 1, "two": 2, "three": 3, "four": 4, "1": 1, "2": 2,
                 "3": 3, "4": 4}  # fmt: skip
_DELAY_MINUTES = (
    re.compile(r"(\d{1,3})\s*(?:minutes?|mins?)\s*(?:late|delay(?:ed)?|behind)", re.IGNORECASE),
    re.compile(
        r"(?:late|delayed|delay)\s*(?:by|of)?\s*(?:about|around|nearly|over|almost)?\s*(\d{1,3})"
        r"\s*(?:minutes?|mins?)\b",
        re.IGNORECASE,
    ),
)
_HOURS_LATE = re.compile(
    r"(an|a|one|two|three|four|[1-4])\s+hours?(\s+and\s+a\s+half)?\s+(?:late|delay)"
    r"|(?:late|delayed|delay)\s*(?:by|of)?\s*(?:about|nearly|almost|over)?\s*(an|a|one|two|three"
    r"|four|[1-4])\s+hours?(\s+and\s+a\s+half)?",
    re.IGNORECASE,
)
_HALF_HOUR_LATE = re.compile(
    r"half an hour\s+(?:late|delay)|(?:late|delayed|delay)\s*(?:by|of)?\s*half an hour",
    re.IGNORECASE,
)
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
_DAY_MONTH = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MONTH + r"\b(?:,?\s+(\d{4})\b)?", re.IGNORECASE
)
_MONTH_DAY = re.compile(
    r"\b" + _MONTH + r"\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?", re.IGNORECASE
)
_SLASH_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?\b")
_WEEKDAY = re.compile(
    r"\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.IGNORECASE
)
_RELATIVE = (
    (re.compile(r"day before yesterday", re.IGNORECASE), 2),
    (re.compile(r"\byesterday\b|last night", re.IGNORECASE), 1),
    (re.compile(r"\btoday\b|this (?:morning|afternoon|evening)|\btonight\b", re.IGNORECASE), 0),
)
_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
           "sep": 9, "oct": 10, "nov": 11, "dec": 12}  # fmt: skip
_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4,
             "saturday": 5, "sunday": 6}  # fmt: skip
_NOTICE = (
    re.compile(r"(\d{1,3})\s*hours?'?\s*(?:of\s+)?(?:notice|warning)", re.IGNORECASE),
    re.compile(
        r"(?:gave|given|with|got)\s+(?:me\s+|us\s+)?(?:only\s+)?(\d{1,3})\s*hours?\b", re.IGNORECASE
    ),
)
_NO_NOTICE = re.compile(
    r"\bno (?:notice|warning)\b|without (?:any )?(?:notice|warning)|didn't (?:tell|warn|call|ring)"
    r"|never (?:told|warned|called|rang)",
    re.IGNORECASE,
)
_ACCOUNT = re.compile(
    r"\b(?:account|ref(?:erence)?|customer)\s*(?:number|no\.?|ref(?:erence)?)?\s*(?:is|:|was)?"
    r"\s*#?([A-Za-z]{1,4}-?\d{3,10}|\d{6,12})\b",
    re.IGNORECASE,
)
_FROM = re.compile(r"\b(?:from|leaving|left|out of)\s+$", re.IGNORECASE)
_TO = re.compile(r"\b(?:to|into|towards|for|reach(?:ing)?)\s+$", re.IGNORECASE)
_JOINERS = frozenset({"to", "-", "–", "—", "→", "->"})


def station_code(name: str) -> str | None:
    """A station's CRS code from its name, an alias or the code itself ("London Paddington",
    "paddington", "PAD"); None for a place that isn't one station (a city, a typo)."""
    cleaned = re.sub(r"\b(?:station|rail|railway)\b", "", _normalise(name), flags=re.IGNORECASE)
    cleaned = " ".join(cleaned.split()).strip(" .,")
    if cleaned.upper() in _CODES:
        return cleaned.upper()
    return _NAMES.get(cleaned.casefold())


def provider_name(text: str) -> str | None:
    """The broadband or phone provider named in `text`, by its usual name; None for anyone else."""
    return _provider(_normalise(text))


def times_in(text: str) -> set[str]:
    """Every clock time in `text` as HH:MM (fares blanked first, so £14.20 is not 14:20)."""
    _, masked = _fares(_normalise(text))
    found: set[str] = set()
    for m in _TIME.finditer(masked):
        hour, minute = _meridiem(int(m.group(1)), m.group(3)), int(m.group(2))
        if hour is not None and 0 <= hour <= 23 and 0 <= minute <= 59:
            found.add(f"{hour:02d}:{minute:02d}")
    for m in _CLOCK.finditer(masked):
        hour = _meridiem(int(m.group(1)), m.group(2))
        if hour is not None:
            found.add(f"{hour:02d}:00")
    return found


def numbers_in(text: str) -> set[Decimal]:
    """Every number in `text` (28.40, £28.4, 28), for checking an amount was really said."""
    return {
        Decimal(m)
        for m in re.findall(r"(?<![\d.])(\d{1,5}(?:\.\d{1,2})?)(?![\d])", _normalise(text))
    }


def station_name(crs: str) -> str:
    """The usual name for a CRS code, or the code itself when it isn't in the table."""
    code = crs.upper()
    return next((name for name, c in STATIONS.items() if c == code), code)


def classify(text: str, *, pending_question: bool = False) -> Intent:
    """Which door this sentence is for. `pending_question` is True when a consent ask is waiting
    for this person, so "yes, go ahead" is an answer rather than small talk."""
    text = _normalise(text)
    if not text:
        return Intent.HELP
    if _STOP.search(text):
        return Intent.STOP
    answer = _yes_or_no(text, pending_question)
    if answer is not None:
        return answer
    if _sweep_like(text):
        return Intent.SWEEP
    if _URL.search(text) or _SCAM_ASK.search(text) or _pressured(text):
        return Intent.SCAM_CHECK
    if _FORGET_WORD.search(text):
        return Intent.MEMORY_FORGET
    if _RECALL.search(text):
        return Intent.MEMORY_RECALL
    if _LEDGER.search(text):
        return Intent.LEDGER
    if _LETTER.search(text):
        return Intent.LETTER
    if _visit_like(text):
        return Intent.MISSED_VISIT
    _, masked = _fares(text)
    if _RAIL.search(text) or any(_stations(text)) or _time(masked, text):
        return Intent.RAIL_DELAY
    if _ENTITLEMENT.search(text):
        return Intent.ENTITLEMENT
    if _PROFILES.search(text):
        return Intent.PROFILES
    if _HELP.search(text):
        return Intent.HELP
    return Intent.SMALLTALK


def extract(text: str, *, today: date, intent: Intent | None = None) -> Slots:
    """The facts in the sentence. With `intent`, only that door's facts are kept (a fare in a
    pasted scam text is not a fare), and a date is the visit's or the journey's accordingly."""
    text = _normalise(text)
    fares, masked = _fares(text)
    when = _date(text, today)
    visit = intent is Intent.MISSED_VISIT or (intent is None and _visit_like(text))
    origin, destination = _stations(text)
    found = Slots(
        origin_crs=origin,
        destination_crs=destination,
        travel_date=None if visit else when,
        departure=_time(masked, text),
        fare_gbp=fares[0] if fares else None,
        delay_minutes=_delay(text),
        operator=_provider(text),
        event_date=when if visit else None,
        notice_hours=_notice(text),
        account_ref=_account(text),
        forget_target=_forget_target(text),
    )
    return _only(found, intent)


def merge(known: Slots, found: Slots) -> Slots:
    """What the client already knew, updated by what this turn said (found wins where not None)."""
    updates = {k: v for k, v in found.model_dump().items() if v is not None}
    return known.model_copy(update=updates)


def missing(intent: Intent, slots: Slots) -> list[tuple[str, str]]:
    """The facts still needed for this door, each with its plain question, in the order to ask."""
    fields: tuple[str, ...]
    if intent is Intent.RAIL_DELAY:
        fields = RAIL_FIELDS
    elif intent is Intent.MISSED_VISIT:
        fields = VISIT_FIELDS
    else:
        return []
    return [(f, QUESTIONS[f]) for f in fields if getattr(slots, f) is None]


# --- helpers -------------------------------------------------------------------------------------


def _normalise(text: str) -> str:
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u00a0", " ")
    return " ".join(text.split())


def _yes_or_no(text: str, pending: bool) -> Intent | None:
    words = set(_WORD.findall(text.casefold()))
    if words and words <= _YES_CORE | _YES_FILL and words & _YES_CORE:
        return Intent.APPROVE
    if words and words <= _NO_CORE | _NO_FILL and words & _NO_CORE:
        return Intent.DECLINE
    if pending:
        if _YES_START.match(text):
            return Intent.APPROVE
        if _NO_START.match(text):
            return Intent.DECLINE
    return None


def _pressured(text: str) -> bool:
    return bool(_PRESSURE_STRONG.search(text)) or len(_PRESSURE_WEAK.findall(text)) >= 2


def _sweep_like(text: str) -> bool:
    if _URL.search(text) or _pressured(text) or _SCAM_ASK.search(_SWEEP.sub(" ", text)):
        return False
    return bool(_SWEEP.search(text)) or bool(_OWED.search(text) and _SWEEP_PLACE.search(text))


def _visit_like(text: str) -> bool:
    if _provider(text) is not None or _VISIT_STRONG.search(text):
        return True
    return bool(_VISIT_WEAK.search(text)) and not _RAIL_STRONG.search(text)


def _only(found: Slots, intent: Intent | None) -> Slots:
    if intent is None:
        return found
    keep: tuple[str, ...]
    if intent is Intent.RAIL_DELAY:
        keep = (*RAIL_FIELDS, "delay_minutes")
    elif intent is Intent.MISSED_VISIT:
        keep = (*VISIT_FIELDS, "notice_hours", "account_ref")
    elif intent is Intent.MEMORY_FORGET:
        keep = ("forget_target",)
    else:
        keep = ()
    return Slots(**{k: v for k, v in found.model_dump().items() if k in keep})


def _stations(text: str) -> tuple[str | None, str | None]:
    """Origin and destination: "X to Y" first, then "from X" / "to Y", then order of mention."""
    hits = _station_hits(text)
    origin: str | None = None
    destination: str | None = None
    for this, nxt in pairwise(hits):
        if text[this[1] : nxt[0]].strip().casefold() in _JOINERS:
            origin, destination = this[2], nxt[2]
            hits = [h for h in hits if h not in (this, nxt)]
            break
    for start, _end, crs in hits:
        before = text[max(0, start - 12) : start]
        if origin is None and _FROM.search(before):
            origin = crs
        elif destination is None and _TO.search(before):
            destination = crs
    for _start, _end, crs in hits:
        if crs in (origin, destination):
            continue
        if origin is None:
            origin = crs
        elif destination is None:
            destination = crs
    return origin, destination


def _station_hits(text: str) -> list[tuple[int, int, str]]:
    hits: list[tuple[int, int, str]] = []
    short = len(text.split()) <= 3
    for m in _STATION_RE.finditer(text):
        name = m.group(1)
        if name.casefold() in _AMBIGUOUS and not name[0].isupper() and not short:
            before = text[max(0, m.start() - 12) : m.start()]
            if not (_FROM.search(before) or _TO.search(before)):
                continue
        hits.append((m.start(), m.end(), _NAMES[name.casefold()]))
    taken = [(s, e) for s, e, _ in hits]
    for m in _CRS_RE.finditer(text):
        if not any(s <= m.start() < e for s, e in taken):
            hits.append((m.start(), m.end(), m.group(1)))
    return sorted(hits)


def _time(masked: str, text: str) -> str | None:
    """The departure: HH:MM, 8.12, 8am or 8:12pm. `masked` has the fares blanked out, so £14.20
    is never a quarter past two. The time after "the" or before "train" wins over a mere mention."""
    found: list[tuple[int, int, str]] = []
    for m in _TIME.finditer(masked):
        hour, minute = _meridiem(int(m.group(1)), m.group(3)), int(m.group(2))
        if hour is not None and 0 <= hour <= 23 and 0 <= minute <= 59:
            found.append((m.start(), m.end(), f"{hour:02d}:{minute:02d}"))
    for m in _CLOCK.finditer(masked):
        hour = _meridiem(int(m.group(1)), m.group(2))
        if hour is not None and not any(s <= m.start() < e for s, e, _ in found):
            found.append((m.start(), m.end(), f"{hour:02d}:00"))
    if not found:
        return None
    found.sort()
    for start, end, value in found:
        if _THE_TIME.search(text[:start]) or _TIME_AFTER.match(text[end:]):
            return value
    return found[0][2]


def _meridiem(hour: int, suffix: str | None) -> int | None:
    if not suffix:
        return hour
    if not 1 <= hour <= 12:
        return None
    pm = suffix.casefold().startswith("p")
    if hour == 12:
        return 12 if pm else 0
    return hour + 12 if pm else hour


def _fares(text: str) -> tuple[list[str], str]:
    """Every fare said, first by position, and the text with those spans blanked out."""
    spans: list[tuple[int, str]] = []
    masked = text
    for pattern in _FARES:
        for m in pattern.finditer(text):
            if any(m.start(1) == s for s, _ in spans):
                continue
            spans.append((m.start(1), _money(m.group(1))))
            masked = masked[: m.start()] + " " * (m.end() - m.start()) + masked[m.end() :]
    return [value for _, value in sorted(spans)], masked


def _money(raw: str) -> str:
    return str(Decimal(raw).quantize(Decimal("0.01")))


def _delay(text: str) -> str | None:
    for pattern in _DELAY_MINUTES:
        if m := pattern.search(text):
            return str(int(m.group(1)))
    if _HALF_HOUR_LATE.search(text):
        return "30"
    if m := _HOURS_LATE.search(text):
        word = (m.group(1) or m.group(3) or "").casefold()
        half = bool(m.group(2) or m.group(4))
        hours = _NUMBER_WORDS.get(word)
        if hours is not None:
            return str(hours * 60 + (30 if half else 0))
    return None


def _date(text: str, today: date) -> str | None:
    if m := _ISO_DATE.search(text):
        return _valid(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    for pattern, days in _RELATIVE:
        if pattern.search(text):
            return (today - timedelta(days=days)).isoformat()
    if m := _DAY_MONTH.search(text):
        return _past(today, int(m.group(1)), _MONTHS[m.group(2).casefold()], m.group(3))
    if m := _MONTH_DAY.search(text):
        return _past(today, int(m.group(2)), _MONTHS[m.group(1).casefold()], m.group(3))
    if m := _SLASH_DATE.search(text):
        year = m.group(3)
        if year and len(year) == 2:
            year = "20" + year
        return _past(today, int(m.group(1)), int(m.group(2)), year)
    if m := _WEEKDAY.search(text):
        back = (today.weekday() - _WEEKDAYS[m.group(2).casefold()]) % 7
        if back == 0 and m.group(1):
            back = 7
        return (today - timedelta(days=back)).isoformat()
    return None


def _past(today: date, day: int, month: int, year: str | None) -> str | None:
    """A day and month without a year is the most recent one: this year, unless that's still to
    come, in which case last year's (a delayed train has already happened)."""
    if year is not None:
        return _valid(int(year), month, day)
    found = _valid(today.year, month, day)
    if found is not None and date.fromisoformat(found) > today:
        return _valid(today.year - 1, month, day)
    return found


def _valid(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _provider(text: str) -> str | None:
    for name, pattern in _PROVIDER_RE.items():
        if pattern.search(text):
            return name
    return None


def _notice(text: str) -> str | None:
    for pattern in _NOTICE:
        if m := pattern.search(text):
            return str(int(m.group(1)))
    if _NO_NOTICE.search(text):
        return "0"
    return None


def _account(text: str) -> str | None:
    m = _ACCOUNT.search(text)
    return m.group(1).upper() if m else None


def _forget_target(text: str) -> str | None:
    m = _FORGET.search(text)
    if m is None:
        return None
    target = m.group(1).strip(" ,;:")
    return target or None
