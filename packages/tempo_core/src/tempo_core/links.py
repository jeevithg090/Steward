"""Links in a message: what they are, and what they only look like (docs/scam-shield.md §5).

Pure Python, no network, no dependency. Each link in a text is found (even when written as
`hxxp://` or `evri[.]com`), its registrable domain is worked out with a small built-in suffix
table (the common part of Mozilla's Public Suffix List), and it is labelled with findings in
plain words: a shortener that hides where it goes, a bare internet address, look-alike letters,
a protected brand's name inside a domain that is not the brand's, an app download, an insecure
scheme. The findings feed `tempo_core.scam.assess`; the Android node runs the same rules in
Kotlin (apps/android-signal) against fixtures/signals/scam_messages.json, so a change here must
change the vectors too.
"""

from __future__ import annotations

import ipaddress
import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType

MAX_HOSTS = 5  # the most link hosts that may leave a phone for one message

# Letters that imitate Latin letters (a folded subset of Unicode UTS #39 confusables): Cyrillic,
# Greek and a few symbols. Applied after NFKC and case folding, so `pаypal` becomes `paypal`.
_CONFUSABLES: Mapping[int, str] = MappingProxyType(
    {
        ord(k): v
        for k, v in {
            "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "к": "k",
            "і": "i", "ј": "j", "ѕ": "s", "ԛ": "q", "ԝ": "w", "һ": "h", "ԁ": "d", "ɡ": "g",
            "ο": "o", "α": "a", "ν": "v", "τ": "t", "ι": "i", "κ": "k", "ρ": "p", "υ": "u",
            "ı": "i", "ł": "l", "ℓ": "l", "ß": "ss",
        }.items()
    }
)  # fmt: skip
# Digits standing in for letters: g00gle, paypa1, m3ssage. A run of 0s and 1s after a letter may
# also end a label (paypa1.com); 3, 4, 5 and 7 only sit between letters, so mp3.com, o2.co.uk and
# covid19 are left alone.
_ZERO_ONE_RUN = re.compile(r"(?<=[a-z])([01]+)(?=[a-z.]|$)")
_ZERO_ONE = str.maketrans({"0": "o", "1": "l"})
_DIGIT_FOR_LETTER = tuple(
    (re.compile(rf"(?<=[a-z]){digit}(?=[a-z])"), letter)
    for digit, letter in (("3", "e"), ("4", "a"), ("5", "s"), ("7", "t"))
)


def fold(text: str) -> str:
    """NFKC, case-folded, with look-alike letters folded to the Latin letters they imitate."""
    folded = unicodedata.normalize("NFKC", text).casefold().translate(_CONFUSABLES)
    folded = _ZERO_ONE_RUN.sub(lambda m: m.group(1).translate(_ZERO_ONE), folded)
    for pattern, letter in _DIGIT_FOR_LETTER:
        folded = pattern.sub(letter, folded)
    return folded


# Defanged links, as people forward them: hxxp://, evri[.]com, bit(.)ly, "royalmail dot com".
_DEFANG = re.compile(r"\[\.\]|\(\.\)|\{\.\}|(?<=[a-z0-9]) dot (?=[a-z0-9])")
_HXXP = re.compile(r"\bh(?:xx|xt|tx)p(s?)://")
_SCHEME = r"(?:https?://)"
_LABEL = r"[^\W_](?:[\w-]{0,61}[^\W_])?"
_HOST = rf"(?:{_LABEL}\.)+[^\W\d_][\w-]{{1,23}}"
_IP = r"(?:\d{1,3}\.){3}\d{1,3}"
_PORT = r"(?::\d{2,5})?"
_PATH = r"(?:/[^\s<>\"'()\[\]{}]*)?"
# A link starts after a space or at the start, never inside an email address or another word.
_URL = re.compile(
    rf"(?<![\w@.\-/])(?:{_SCHEME}(?:{_IP}|{_HOST})|www\.{_HOST}|{_HOST}){_PORT}{_PATH}", re.I
)
_TRAILING = ".,;:!?'\")"

# Top-level domains a bare domain (no scheme, no www.) may end in and still count as a link.
# A sentence with a missing space ("Pay now.It is due") must not become a link, so English-word
# endings need a path, a hyphen or a third label as well (`_WORDY`).
KNOWN_TLDS = frozenset(
    [
        "com",
        "net",
        "org",
        "info",
        "biz",
        "uk",
        "co",
        "in",
        "io",
        "me",
        "ly",
        "gd",
        "cc",
        "link",
        "top",
        "xyz",
        "online",
        "site",
        "shop",
        "club",
        "live",
        "app",
        "gov",
        "nhs",
        "edu",
        "ac",
        "us",
        "eu",
        "de",
        "fr",
        "es",
        "it",
        "nl",
        "ru",
        "cn",
        "tk",
        "ml",
        "ga",
        "cf",
        "gq",
        "icu",
        "buzz",
        "click",
        "vip",
        "work",
        "store",
        "tech",
        "pro",
        "pl",
        "pk",
        "bd",
        "ng",
        "za",
        "au",
        "nz",
        "ca",
        "ie",
        "ch",
        "se",
        "no",
        "dk",
        "fi",
        "be",
        "at",
        "pt",
        "br",
        "mx",
        "ar",
        "jp",
        "kr",
        "hk",
        "sg",
        "my",
        "ph",
        "id",
        "th",
        "vn",
        "tr",
        "sa",
        "ae",
        "il",
        "ke",
        "gh",
        "tz",
        "lk",
        "np",
        "tv",
        "fm",
        "ws",
        "to",
        "lol",
        "mobi",
        "asia",
        "is",
        "cfd",
        "sbs",
        "rest",
        "zip",
        "mov",
        "bond",
        "cyou",
        "surf",
        "monster",
        "quest",
        "cam",
        "one",
        "pw",
        "su",
        "ua",
        "kz",
        "by",
        "ge",
        "am",
        "az",
        "qa",
        "om",
        "kw",
        "bh",
        "jo",
        "lb",
        "eg",
        "ma",
        "dz",
        "tn",
        "ai",
        "gl",
        "do",
        "ee",
        "im",
        "st",
        "sh",
        "gy",
        "do",
        "sbi",
        "bank",
        "money",
        "claims",
        "support",
        "help",
        "page",
        "win",
        "rocks",
        "life",
        "today",
        "news",
        "world",
        "email",
        "digital",
        "services",
    ]
)
_WORDY = frozenset(
    [
        "it",
        "at",
        "me",
        "is",
        "to",
        "be",
        "do",
        "id",
        "in",
        "no",
        "so",
        "us",
        "am",
        "as",
        "by",
        "my",
        "sh",
        "st",
        "go",
        "or",
        "if",
        "of",
        "on",
        "up",
        "help",
        "page",
        "today",
        "news",
        "life",
        "world",
        "email",
        "support",
        "money",
        "win",
        "services",
        "digital",
        "claims",
        "bank",
        "rocks",
        "one",
        "live",
        "club",
        "shop",
        "store",
        "site",
        "online",
        "link",
        "top",
        "work",
        "app",
        "tech",
        "pro",
        "vip",
        "quest",
        "rest",
        "zip",
        "mov",
        "bond",
        "surf",
        "cam",
        "lol",
    ]
)

# The common two-label public suffixes: `co.uk`, `gov.uk`, `co.in`, `com.au` and their kind. The
# rule is Mozilla's Public Suffix List in miniature; the full list is the documented upgrade.
SECOND_LEVEL = frozenset(
    [
        "co",
        "com",
        "org",
        "net",
        "gov",
        "ac",
        "edu",
        "nhs",
        "police",
        "sch",
        "ltd",
        "plc",
        "me",
        "nic",
        "res",
        "gen",
        "firm",
        "ind",
        "mil",
        "or",
        "ne",
        "go",
        "web",
        "info",
        "biz",
        "name",
        "pro",
        "nom",
        "in",
        "id",
    ]
)

# Services that hide where a link goes. A shortened link is not a scam by itself; it is a reason
# to look before tapping, and the sandbox follows it.
SHORTENERS = frozenset(
    [
        "bit.ly",
        "tinyurl.com",
        "t.co",
        "is.gd",
        "cutt.ly",
        "rb.gy",
        "tiny.cc",
        "shorturl.at",
        "goo.gl",
        "ow.ly",
        "buff.ly",
        "rebrand.ly",
        "bl.ink",
        "t.ly",
        "s.id",
        "lnkd.in",
        "u.to",
        "v.gd",
        "shorte.st",
        "adf.ly",
        "bit.do",
        "mcaf.ee",
        "soo.gd",
        "clck.ru",
        "trib.al",
        "zpr.io",
        "snip.ly",
        "tr.im",
        "x.co",
        "qr.ae",
        "cli.re",
        "shor.by",
        "short.io",
        "tny.im",
        "urlz.fr",
        "1u.fi",
        "rotf.lol",
        "kutt.it",
    ]
)

# Endings that cost nothing and are over-represented in phishing registrations. A finding, not a
# verdict: plenty of honest sites use them too.
SUSPICIOUS_TLDS = frozenset(
    [
        "tk",
        "ml",
        "ga",
        "cf",
        "gq",
        "top",
        "xyz",
        "icu",
        "buzz",
        "click",
        "cfd",
        "sbs",
        "rest",
        "zip",
        "mov",
        "bond",
        "cyou",
        "surf",
        "monster",
        "quest",
        "cam",
        "lol",
        "pw",
        "su",
    ]
)

# Brands people are impersonated with, and the domains that really are theirs (registrable). A
# brand's name inside any other domain is a look-alike finding, named after the brand.
BRANDS: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        "hmrc": frozenset({"hmrc.gov.uk", "gov.uk", "service.gov.uk"}),
        "dvla": frozenset({"dvla.gov.uk", "gov.uk", "service.gov.uk"}),
        "dwp": frozenset({"dwp.gov.uk", "gov.uk", "service.gov.uk"}),
        "gov": frozenset({"gov.uk", "service.gov.uk", "gov.in", "gov.scot", "gov.wales"}),
        "nhs": frozenset({"nhs.uk", "nhs.net", "nhs.scot", "nhs.wales"}),
        "royalmail": frozenset({"royalmail.com", "royalmailgroup.com"}),
        "evri": frozenset({"evri.com"}),
        "dpd": frozenset({"dpd.co.uk", "dpdlocal.co.uk", "dpd.com"}),
        "dhl": frozenset({"dhl.com", "dhl.co.uk", "dhlparcel.co.uk"}),
        "yodel": frozenset({"yodel.co.uk"}),
        "parcelforce": frozenset({"parcelforce.com"}),
        "fedex": frozenset({"fedex.com"}),
        "ups": frozenset({"ups.com"}),
        "usps": frozenset({"usps.com"}),
        "halifax": frozenset({"halifax.co.uk", "halifax-online.co.uk"}),
        "lloyds": frozenset({"lloydsbank.com", "lloydsbank.co.uk", "lloydsbankinggroup.com"}),
        "barclays": frozenset({"barclays.co.uk", "barclays.com", "barclaycard.co.uk"}),
        "natwest": frozenset({"natwest.com"}),
        "hsbc": frozenset({"hsbc.co.uk", "hsbc.com"}),
        "santander": frozenset({"santander.co.uk", "santander.com"}),
        "nationwide": frozenset({"nationwide.co.uk"}),
        "monzo": frozenset({"monzo.com"}),
        "starling": frozenset({"starlingbank.com"}),
        "revolut": frozenset({"revolut.com"}),
        "tsb": frozenset({"tsb.co.uk"}),
        "rbs": frozenset({"rbs.co.uk", "rbs.com"}),
        "paypal": frozenset({"paypal.com", "paypal.co.uk", "paypal.me"}),
        "amazon": frozenset({"amazon.co.uk", "amazon.com", "amazon.in", "amazon.de"}),
        "ebay": frozenset({"ebay.co.uk", "ebay.com"}),
        "netflix": frozenset({"netflix.com"}),
        "apple": frozenset({"apple.com", "icloud.com"}),
        "microsoft": frozenset({"microsoft.com", "live.com", "outlook.com", "office.com"}),
        "google": frozenset({"google.com", "google.co.uk", "google.co.in", "goo.gl"}),
        "whatsapp": frozenset({"whatsapp.com", "wa.me"}),
        "facebook": frozenset({"facebook.com", "fb.com", "fb.me"}),
        "tesco": frozenset({"tesco.com"}),
        "vodafone": frozenset({"vodafone.co.uk", "vodafone.com", "vodafone.in"}),
        "virgin": frozenset({"virginmedia.com", "virginmoney.com"}),
        "tvlicensing": frozenset({"tvlicensing.co.uk"}),
        "tvlicence": frozenset({"tvlicensing.co.uk"}),
        "sbi": frozenset({"sbi.co.in", "onlinesbi.sbi", "onlinesbi.com", "yonobusiness.sbi"}),
        "hdfc": frozenset({"hdfcbank.com", "hdfc.com"}),
        "icici": frozenset({"icicibank.com"}),
        "paytm": frozenset({"paytm.com"}),
        "phonepe": frozenset({"phonepe.com"}),
        "coinbase": frozenset({"coinbase.com"}),
        "binance": frozenset({"binance.com"}),
        "irs": frozenset({"irs.gov"}),
    }
)
_PATH_WORDS = re.compile(
    r"login|log-in|signin|verify|secure|account|update|confirm|claim|refund|unlock|suspend|"
    r"redeliver|reschedule|fee|pay|otp|kyc|wallet",
    re.I,
)

STRONG = frozenset(
    {"shortener", "ip_address", "punycode", "brand_lookalike", "suspicious_tld", "apk_download",
     "deep_subdomains"}
)  # fmt: skip
WEAK = frozenset({"insecure_http", "pressure_path", "defanged"})

FINDING_WORDS: Mapping[str, str] = MappingProxyType(
    {
        "shortener": "it uses a shortened link that hides where it goes",
        "ip_address": "its link is a bare internet address, not a name",
        "punycode": "its link uses look-alike letters to seem right",
        "brand_lookalike": "its link only looks like {brand}'s",
        "suspicious_tld": "its link ends in a cheap address that scammers favour",
        "apk_download": "its link downloads an app file straight onto your phone",
        "insecure_http": "its link is not a secure one",
        "deep_subdomains": "its link hides the real site behind a long address",
        "pressure_path": "its link talks about logging in, paying or claiming",
        "defanged": "the link was written so it cannot be tapped",
    }
)


# Endings only the state hands out: a link there is the real thing, whatever its words.
OFFICIAL_SUFFIXES = (
    "gov.uk", "nhs.uk", "ac.uk", "police.uk", "mod.uk", "gov.in", "nic.in", "gov.scot", "gov.wales",
)  # fmt: skip
_OFFICIAL_HOSTS = frozenset(h for hosts in BRANDS.values() for h in hosts)


@dataclass(frozen=True)
class Link:
    url: str
    host: str  # as written, folded
    registrable: str  # the part someone had to register: `evri-track.co`, `hmrc.gov.uk`
    findings: tuple[str, ...]  # keys of FINDING_WORDS; a look-alike is "brand_lookalike:<brand>"

    @property
    def suspicious(self) -> bool:
        """A finding strong enough to hold the message on its own (weak ones only add colour)."""
        return any(f.partition(":")[0] in STRONG for f in self.findings)

    @property
    def official(self) -> bool:
        """The link really is a protected brand's, or the state's, and carries no finding."""
        if self.suspicious or "punycode" in self.findings:
            return False
        host = self.registrable
        return host in _OFFICIAL_HOSTS or any(
            host == suffix or host.endswith("." + suffix) for suffix in OFFICIAL_SUFFIXES
        )

    def words(self) -> list[str]:
        """Each finding in plain words, for the spoken warning and the Shield panel."""
        out: list[str] = []
        for finding in self.findings:
            key, _, brand = finding.partition(":")
            template = FINDING_WORDS.get(key)
            if template:
                out.append(
                    template.format(brand=brand.upper() if len(brand) <= 4 else brand.title())
                )
        return out


def registrable(host: str) -> str:
    """`www.oxford.gov.uk` -> `oxford.gov.uk`; `hmrc-refunds-gov.uk` -> itself; an address stays."""
    host = host.strip(".").casefold()
    if _is_ip(host):
        return host
    labels = host.split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def find_links(text: str) -> tuple[Link, ...]:
    """Every link in the text, in order, with its findings. Pure; never touches the network."""
    clean = clean_text(text)
    lowered = unicodedata.normalize("NFKC", text).casefold()
    links: list[Link] = []
    for match in _URL.finditer(clean):
        url = match.group(0).rstrip(_TRAILING)
        link = _classify(url, defanged=url not in lowered)  # written so it cannot be tapped
        if link is not None:
            links.append(link)
    return tuple(links)


def from_host(host: str) -> Link:
    """A link known only by its host (what a phone sends): the same findings, no path."""
    link = _classify(f"https://{host.strip().casefold()}/", defanged=False, bare_ok=True)
    assert link is not None  # a host alone always classifies  # noqa: S101
    return Link(url=host, host=link.host, registrable=link.registrable, findings=link.findings)


def clean_text(text: str) -> str:
    """NFKC, case-folded, with defanged links made whole again (`hxxp://`, `evri[.]com`). Letters
    are not folded here, so a look-alike alphabet in a host is still visible to `find_links`."""
    lowered = unicodedata.normalize("NFKC", text).casefold()
    return _HXXP.sub(r"http\1://", _DEFANG.sub(".", lowered))


def link_hosts(text: str) -> list[str]:
    """The registrable domains of the links, de-duplicated, at most MAX_HOSTS: what may leave a
    phone about a message's links."""
    seen: dict[str, None] = {}
    for link in find_links(text):
        seen.setdefault(link.registrable)
    return list(seen)[:MAX_HOSTS]


def brand_in(host: str) -> str | None:
    """The protected brand whose name is in this host while the host is not the brand's, or None."""
    folded = fold(host)
    reg = registrable(folded)
    tokens = set(re.split(r"[.-]", folded))
    squashed = folded.replace("-", "").split(".")
    for brand, official in BRANDS.items():
        if reg in official or any(folded == o or folded.endswith("." + o) for o in official):
            continue
        looks = brand in tokens if len(brand) <= 4 else any(brand in label for label in squashed)
        if looks:
            return brand
    return None


def _classify(url: str, *, defanged: bool, bare_ok: bool = False) -> Link | None:
    without_scheme = re.sub(r"^https?://", "", url)
    raw_host, _, _ = without_scheme.partition("/")
    raw_host, _, _ = raw_host.partition(":")
    looks = fold(raw_host)  # what the eye reads; only ever compared, never fetched
    host = _ascii_host(raw_host)  # what a sandbox would really fetch
    bare = not url.startswith(("http://", "https://", "www."))
    tld = looks.rsplit(".", 1)[-1]
    if bare and not _is_ip(host) and not bare_ok:
        if tld not in KNOWN_TLDS:
            return None
        if tld in _WORDY and "/" not in without_scheme and "-" not in host and host.count(".") < 2:
            return None
    findings: list[str] = []
    reg = registrable(host)
    if _is_ip(host):
        findings.append("ip_address")
    if looks != raw_host or any(label.startswith("xn--") for label in host.split(".")):
        findings.append("punycode")  # look-alike letters, or an encoded host that hides them
    if reg in SHORTENERS or registrable(looks) in SHORTENERS:
        findings.append("shortener")
    brand = brand_in(looks)
    if brand:
        findings.append(f"brand_lookalike:{brand}")
    if not _is_ip(host) and tld in SUSPICIOUS_TLDS:
        findings.append("suspicious_tld")
    path = without_scheme[len(raw_host) :]
    path = (
        path.partition("/")[2].join(("/", ""))
        if path.startswith("/")
        else path.lstrip(":0123456789")
    )
    if re.search(r"\.apk(?:$|[?#/])", path) or "/apk" in path:
        findings.append("apk_download")
    if url.startswith("http://"):
        findings.append("insecure_http")
    extra = host.removeprefix("www.").count(".") - reg.count(".")
    if not _is_ip(host) and extra >= 2:
        findings.append("deep_subdomains")
    if path and _PATH_WORDS.search(path):
        findings.append("pressure_path")
    if defanged:
        findings.append("defanged")
    return Link(url=url, host=host, registrable=reg, findings=tuple(findings))


def _ascii_host(host: str) -> str:
    """A host as it would be fetched: lower-case, and IDNA-encoded when it has letters outside
    ASCII (so a PayPal look-alike spelt with a Cyrillic first a becomes `xn--pypal-4ve.com`)."""
    if host.isascii():
        return host
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return host


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def findings_of(links: Iterable[Link]) -> list[str]:
    """Every finding across the links, in order, de-duplicated (for the model's feature tokens)."""
    seen: dict[str, None] = {}
    for link in links:
        for finding in link.findings:
            seen.setdefault(finding)
    return list(seen)
