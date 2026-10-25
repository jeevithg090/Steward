"""Scam Shield (build plan S7.3; docs/scam-shield.md): is this message from who it says, is it
pushing you, where does its link really go, and how sure are we?

Pure rules over what the registers, the links, the text model and the sandbox said. The rule that
matters most: Tempo never says "safe". The best answer is "no warning signs found", and if a
register or a link couldn't be checked the answer is "unknown", because a clone firm's whole
trick is to look like a real one.

`assess(text, firm)` is the only place a verdict is formed. The phone (Kotlin), the SMS `CHECK`,
the voice tool, the web page and the Mesh route all end here, with whatever evidence they have:

- the words (pressure signs; a big ask alone is a likely scam);
- the links (`tempo_core.links`: a brand's name in a domain that is not the brand's, look-alike
  letters, a shortener, an app download);
- the registers (`FirmCheck`: the FCA Warning List, a clone's contact details, Companies House);
- the text model's calibrated score (`tempo_core.scam_model`), which ranks but never decides;
- what the Gateway's sandbox found behind a link (`SandboxReport`), and public phishing lists.

Code decides. The verdict carries a level, a zone (speak now, hold and check, or stay quiet),
the reasons, and the plain-word sentences the voice says.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum

from tempo_core.links import Link, find_links
from tempo_core.scam_model import Score
from tempo_core.scam_words import SIGNAL_WORDS

MIN_WORDS_TO_WARN = 3  # a bare number or a lone word is never a scam the model may speak about


class Level(StrEnum):
    LIKELY_SCAM = "likely_scam"
    CAUTION = "caution"
    UNKNOWN = "unknown"  # a register or a link couldn't be checked
    NO_FLAGS = "no_flags"  # never "safe"


class Zone(StrEnum):
    WARN = "warn"  # speak now
    SANDBOX = "sandbox"  # hold: say "I'm checking", inspect the links, then speak
    QUIET = "quiet"  # nothing to say unless asked


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
class SandboxReport:
    """What the Gateway's isolated look at one link host found (tempo_adapters.scam.sandbox).

    Findings are keys of SANDBOX_WORDS, some with a value after a colon: `card_form`,
    `password_form`, `redirects_to:<host>`, `brand_page:<brand>`, `new_domain:<days>`,
    `feed:<list>`, `apk_download`, `unreachable`, `no_page`.
    """

    host: str
    findings: tuple[str, ...] = ()
    official: bool = False  # the final host is a protected brand's own domain


@dataclass(frozen=True)
class Evidence:
    """Everything beyond the words that a caller may already know."""

    score: Score | None = None  # the text model's answer for this text
    links: tuple[Link, ...] | None = None  # None: find them in the text
    families: tuple[str, ...] = ()  # keyword families that fired (skills/scam-shield/signals.yaml)
    sandbox: tuple[SandboxReport, ...] = ()  # the Gateway's look behind the links, once it has
    feed_hits: tuple[str, ...] = ()  # link hosts named by a public phishing list


@dataclass(frozen=True)
class Verdict:
    level: Level
    reasons: tuple[str, ...]
    advice: str = field(default="")
    zone: Zone = Zone.QUIET
    confidence: float | None = None  # the model's calibrated P(scam), when it was run
    why: tuple[str, ...] = ()  # plain-word fragments for the spoken warning ("it asks for ...")
    link_hosts: tuple[str, ...] = ()
    checked: bool = False  # the sandbox has looked, so a hold can be closed


_DEADLINE = r"within (\d+|one|two|24) (hours?|minutes?)|act now|immediately|urgent(ly)?|today only"
_CODE_WORDS = (
    r"one[- ]time (?:pass)?code|otp|\bpin\b|pin number|password|passcode|security code|"
    r"verification code|login code|access code|(?:the|your|this|that|my) codes?\b"
)
# A request for a code: a verb of asking, then the code word within the same clause. The mere
# presence of a code ("your code is 482913") is not a request; nor is a bank saying it never asks.
_CODE_REQUEST = re.compile(
    rf"\b(?:read|send|tell|give|share|enter|confirm|provide|text|forward|type|quote|repeat|"
    rf"reply with|what'?s|whats|need|key in|input)\b[^.!?\n]{{0,40}}?(?:{_CODE_WORDS})",
    re.I,
)
_NEGATED = re.compile(
    r"\b(?:never|don'?t|do not|not|nobody|no one|no-one|won'?t|will never)\b[\w\s',/-]{0,24}$",
    re.I,
)
_SECRECY = r"\b(don'?t|do not) tell\b|\bkeep (this|it) (secret|between us)\b"
PRESSURE = {
    "a safe account": re.compile(r"\bsafe account\b", re.I),
    "moving your money": re.compile(r"\b(move|transfer)\b.{0,30}\b(money|savings|funds)\b", re.I),
    "gift cards or crypto": re.compile(
        r"\b(gift ?cards?|itunes|bitcoin|crypto(currency)?|usdt)\b", re.I
    ),
    "a deadline to act now": re.compile(rf"\b({_DEADLINE})\b", re.I),
    "a code or password": _CODE_REQUEST,
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
# Keyword families the frozen scam_words module does not name yet, in the same voice.
EXTRA_FAMILY_WORDS = {
    "scam_loan_app": "it offers an instant loan with no checks and a fee up front",
    "scam_family_emergency": "it says a relative is on a new number and needs money today",
}
FAMILY_WORDS = {**SIGNAL_WORDS, **EXTRA_FAMILY_WORDS}
SANDBOX_WORDS = {
    "card_form": "the page behind the link asks for card details",
    "password_form": "the page behind the link asks for a password",
    "redirects_to": "the link quietly moves you on to {value}",
    "brand_page": "the page behind the link copies {value}'s look",
    "new_domain": "the site behind the link is only {value} days old",
    "feed": "a public list of phishing links names this one",
    "apk_download": "the link downloads an app file straight onto your phone",
    "unreachable": "the link could not be checked just now",
    "no_page": "the page behind the link could not be read",
}
_LIKELY_SANDBOX = ("card_form", "password_form", "feed", "apk_download")
_YOUNG_DAYS = 30


def pressure_signs(text: str) -> list[str]:
    return [name for name, pattern in PRESSURE.items() if _hits(name, pattern, text)]


def _hits(name: str, pattern: re.Pattern[str], text: str) -> bool:
    if name != "a code or password":
        return pattern.search(text) is not None
    for match in pattern.finditer(text):
        before = text[max(0, match.start() - 30) : match.start()]
        if not _NEGATED.search(before):
            return True
    return False


def assess(text: str, firm: FirmCheck | None, evidence: Evidence | None = None) -> Verdict:
    """The verdict from the words, the firm, and whatever else the caller knows."""
    ev = evidence or Evidence()
    links = ev.links if ev.links is not None else find_links(text)
    signs = pressure_signs(text)
    likely: list[str] = []  # reasons that make it a likely scam on their own
    caution: list[str] = []  # reasons that call for care
    why: list[str] = []  # the spoken fragments, strongest first

    # 1. The registers.
    if firm is not None and firm.on_warning_list:
        likely.append(f"the FCA warns about {firm.name}")
        why.append(f"the FCA warns about {firm.name}")
    if firm is not None and firm.fca_authorised and firm.contact_matches_register is False:
        likely.append(
            f"it uses {firm.name}'s name with contact details that aren't theirs (a clone)"
        )
        why.append(f"it uses {firm.name}'s name but not {firm.name}'s own phone or website")

    # 2. The big asks in the words.
    if asks := [s for s in signs if s in BIG_ASKS]:
        likely.append("it asks for " + " and ".join(asks))
        why += [FAMILY_WORDS[_FAMILY_FOR_ASK[s]] for s in asks]

    # 3. The links, and what the sandbox and the lists found behind them.
    for link in links:
        for finding in link.findings:
            key = finding.partition(":")[0]
            if key in ("brand_lookalike", "punycode"):
                likely.append(f"its link {link.registrable} only looks like a real one")
            elif link.suspicious:
                caution.append(f"its link {link.registrable} needs a closer look")
        why += link.words()
    for host in ev.feed_hits:
        likely.append(f"a public phishing list names {host}")
        why.append(SANDBOX_WORDS["feed"])
    for report in ev.sandbox:
        for finding in report.findings:
            key, _, value = finding.partition(":")
            if key in _LIKELY_SANDBOX and not report.official:
                likely.append(f"behind {report.host}: {key.replace('_', ' ')}")
            elif key == "new_domain" and value.isdigit() and int(value) < _YOUNG_DAYS:
                (
                    likely if (links and any(found.suspicious for found in links)) else caution
                ).append(f"{report.host} is only {value} days old")
            elif key in ("redirects_to", "brand_page") and not report.official:
                likely.append(f"behind {report.host}: {key.replace('_', ' ')} {value}")
            elif key in ("unreachable", "no_page"):
                caution.append(f"{report.host} could not be checked")
            words = SANDBOX_WORDS.get(key)
            if words:
                why.append(words.format(value=value))

    # 4. The text model: it ranks, so it may add a reason, never remove one. It may make Tempo
    # speak only when code already has something concrete to point at (a family or a pressure
    # sign together with a doubtful link, a feed hit, a register hit, a big ask): a genuine bank
    # alert or council reminder reads "formal", and formal alone is never a reason to speak.
    score = ev.score
    doubtful_link = any(not found.official for found in links)
    word_families = [f for f in ev.families if f != "scam_short_link"]  # a link, not a word
    corroborated = bool(likely) or bool(ev.feed_hits) or (
        bool(word_families or signs) and bool(links) and doubtful_link
    )  # fmt: skip
    if score is not None and score.zone == "warn" and corroborated:
        likely.append(f"its words are the words of scam texts ({score.probability:.0%} sure)")
        if score.top_words:
            why.append("it uses words seen in scam texts, like " + ", ".join(score.top_words))
    elif score is not None and score.zone == "warn":
        caution.append(
            f"its words read like a scam text ({score.probability:.0%} sure), "
            "though nothing else confirms it"
        )
    elif score is not None and score.zone == "sandbox":
        caution.append(f"its words are often seen in scam texts ({score.probability:.0%} sure)")

    # 5. The softer signs.
    if firm is not None and firm.company_active is False:
        caution.append(f"{firm.name} is dissolved at Companies House")
    if firm is not None and firm.company_age_days is not None and firm.company_age_days < 30:
        caution.append(f"{firm.name} was registered only {firm.company_age_days} days ago")
    caution += [f"it uses pressure: {s}" for s in signs]
    why += [FAMILY_WORDS[f] for f in ev.families if f in FAMILY_WORDS]
    for s in signs:
        words = FAMILY_WORDS.get(_FAMILY_FOR_ASK.get(s, ""))
        if words and words not in why:
            why.append(words)
    if ev.families and not likely and not any(c.startswith("it uses pressure") for c in caution):
        caution.append("it has the shape of a scam text: " + ", ".join(
            f.removeprefix("scam_").replace("_", " ") for f in ev.families
        ))  # fmt: skip

    hosts = tuple(dict.fromkeys(link.registrable for link in links))
    confidence = score.probability if score is not None else None
    checked = bool(ev.sandbox)
    if likely:
        return _verdict(
            Level.LIKELY_SCAM, likely + caution, Zone.WARN, confidence, why, hosts, checked
        )
    unreachable = firm is not None and None in (
        firm.on_warning_list, firm.fca_authorised, firm.company_active,
    )  # fmt: skip
    if caution:
        model_doubt = score is not None and score.zone != "quiet"
        needs_look = bool(hosts) and not checked and (
            any(found.suspicious for found in links) or (model_doubt and doubtful_link)
        )  # fmt: skip
        zone = Zone.SANDBOX if needs_look else Zone.QUIET
        return _verdict(Level.CAUTION, caution, zone, confidence, why, hosts, checked)
    if unreachable:
        return _verdict(
            Level.UNKNOWN, ["an official register couldn't be checked"], Zone.QUIET, confidence,
            why, hosts, checked,
        )  # fmt: skip
    return _verdict(Level.NO_FLAGS, [], Zone.QUIET, confidence, why, hosts, checked)


_FAMILY_FOR_ASK = {
    "a safe account": "scam_safe_account",
    "a code or password": "scam_code_request",
    "a deadline to act now": "scam_urgency",
    "moving your money": "scam_safe_account",
}


def _verdict(
    level: Level, reasons: list[str], zone: Zone, confidence: float | None, why: Iterable[str],
    hosts: tuple[str, ...], checked: bool,
) -> Verdict:  # fmt: skip
    return Verdict(
        level, tuple(dict.fromkeys(reasons)), ADVICE[level], zone=zone, confidence=confidence,
        why=tuple(dict.fromkeys(why)), link_hosts=hosts, checked=checked,
    )  # fmt: skip
