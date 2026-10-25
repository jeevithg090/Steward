"""Deterministic safety checks run on every Bridge draft: no network, no LLM, same answer every time.

Why this exists: the compose model can be steered by text it was shown (a replied-to chat, a forwarded
message), and a model can't be trusted to police its own output. So before a draft reaches the approval card,
plain code compares it with what the person actually said (the transcript):

  * a link, phone number, email, IBAN, sort code or card number the person never said -> blocked
  * a number in the draft the person didn't say, or one they said that the draft dropped -> flagged
  * money / health / legal / work topics (in either text) -> the person must tap to confirm

Digits are normalised first (Telugu "౮", Devanagari "८", fullwidth "８" -> "8"), because the transcript may be in
one script and the draft in another. Invisible characters, lookalike dots and spelled-out forms ('evil dot com',
'oh seven seven ...') are undone before scanning, so a steered composer can't hide a link or number from the check.
The keyword lists are deliberately modest: a false flag costs one tap, a missed one could cost someone their
savings, so on doubt we flag rather than pass.
"""
from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import NamedTuple

CONTACT_KINDS = ("urls", "phones", "emails", "ibans", "sort_codes", "card_numbers")
RISK_TOPICS = ("money", "health", "legal", "work")
_KIND_NAME = {"urls": "url", "phones": "phone", "emails": "email", "ibans": "iban", "sort_codes": "sort_code",
              "card_numbers": "card_number"}


# ---------- digits ----------

def normalise_digits(text: str) -> str:
    """NFC text with every Unicode decimal digit (Telugu ౮, Devanagari ८, Arabic-Indic ٨, fullwidth ８, ...) as 0-9.

    Why: STT may write Telugu or Hindi digits while the draft uses 0-9; compared raw, every number would look
    changed. Only Nd (decimal) digits are mapped, so a superscript '²' is left alone.
    """
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFC", text)
    if text.isascii():
        return text
    out = []
    for ch in text:
        digit = unicodedata.decimal(ch, None) if ch > "\x7f" else None
        out.append(str(digit) if digit is not None else ch)
    return "".join(out)


# Characters that render as nothing (zero-width space, soft hyphen, bidi controls, ...): an injected 'evil.\u200bcom'
# or 'hos\u00adpital' looks normal on screen but would slip past every pattern, so scanning drops them.
_INVISIBLE = re.compile("[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e"
                        "\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]")
# Lookalike punctuation and fullwidth Latin ('evil。com', 'ｅｖｉｌ．ｃｏｍ') fold to ASCII for the same reason.
_FOLD = {**{cp: cp - 0xFEE0 for cp in range(0xFF01, 0xFF5F)}, 0x3002: ".", 0xFF61: ".", 0x2024: ".", 0xFE52: ".",
         0xFE6B: "@"}
# A phone number read out digit by digit ('oh seven seven double oh nine ...'): 7+ spoken digits become digits, so
# the person saying it counts as saying the number, and a draft spelling one out is still caught.
_DIGIT_WORDS = {"zero": "0", "oh": "0", "o": "0", "nought": "0", "one": "1", "two": "2", "three": "3", "four": "4",
                "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"}
_ONE_DIGIT = r"(?:(?:double|triple)\s+)?(?:zero|oh|o(?!')|nought|one|two|three|four|five|six|seven|eight|nine)\b"
_SPOKEN_DIGITS = re.compile(rf"\b(?:plus\s+)?{_ONE_DIGIT}(?:[\s,-]+{_ONE_DIGIT}){{6,}}", re.I)


def _spoken_digits(m: re.Match) -> str:
    out, repeat = "", 1
    for word in re.findall(r"[a-z]+", m.group(0).lower()):
        if word == "plus":
            out = "+"
        elif word in ("double", "triple"):
            repeat = 2 if word == "double" else 3
        else:
            out, repeat = out + _DIGIT_WORDS[word] * repeat, 1
    return out


def _clean(text: str) -> str:
    """normalise_digits, minus invisible characters, lookalike punctuation folded (see _INVISIBLE / _FOLD)."""
    return _INVISIBLE.sub("", normalise_digits(text)).translate(_FOLD)


# ---------- contacts ----------

# TLDs that make 'word.tld' a link in any letter case ("bit.ly", "wa.me", "Example.Com", "example.co.uk"). Any other
# letters-only TLD ('evil.it', 'photos.family', 'EVIL.TO') counts only in lower case or ALL CAPS - see _is_link - so
# a run-together sentence ('Amma.How are you') or a name ('Dr.Rao', 'Mr.Smith') isn't mistaken for a link.
_TLDS = ("com|org|net|edu|gov|mil|int|info|biz|app|dev|io|ai|co|uk|in|me|ly|gl|gd|ws|cc|tv|fm|sh|xyz|online|site|"
         "shop|store|top|club|live|link|click|page|tech|pro|mobi|wales|cymru|scot|london|eu|us|ca|au|nz|ie|de|fr|"
         "es|nl|ru|cn|jp|kr|hk|sg|pk|bd|lk|np|ae|sa|za|ng|ke|br|mx|pl|se|dk|fi|ch|pt|gr|tr|il|ph|tk|ml|ga|cf|gq|"
         "su|lol|zip|mov|icu|vip|buzz|cfd|sbs|bond|cyou|quest|monster|rest|gdn|kim|xin|fyi|ink|cx|pw|gg|sx|vc|la|nu")
_KNOWN_TLDS = frozenset(_TLDS.split("|"))
_NOT_TLD = frozenset("jpg jpeg png gif heic webp pdf doc docx txt mp3 mp4 m4a wav xls xlsx csv ppt pptx".split())
# 'mr.smith', 'dr.rao', 'pvt.ltd', 'col.singh' - two-part names that are abbreviations, not sites.
_NOT_SITE = frozenset("mr mrs ms dr st sr jr prof smt shri sri no nos vs etc mt ft rd ave approx dept govt pvt est "
                      "tel mob ph fig vol ch pg pp ref re col maj capt cpt gen lt sgt rev parch asst kum hon".split())
# The TLDs we accept after a spoken " dot " - stricter, because "the dot in the picture" must not become a link.
_SPOKEN_TLDS = ("com|org|net|co|uk|io|me|ly|gl|gd|info|biz|app|dev|xyz|ai|tv|ws|cc|online|site|shop|store|link|"
                "click|live|top|club|page|tech|wales|cymru|scot|london|eu|de|fr|ie|au|ca|ru|cn|pk|bd|lk|np|ae|za|ng|"
                "in|gov|ac|icu|vip|buzz")
# Words before " dot " that mean a spot, not a site: 'at 8 on the dot me and Ravi', 'a dot in the corner'.
_NOT_SPOKEN_SITE = frozenset("the a an each every one this that no polka red blue green black white yellow little "
                             "small big tiny".split())


def _mark_class() -> str:
    """Every combining mark (Mn, Mc) in the BMP as a character-class body. Python's \\w leaves them out, and every
    Telugu or Devanagari word has them ('భారత్', 'भारत'), so without them an Indic domain is invisible."""
    ranges: list[tuple[int, int]] = []
    for cp in range(0x300, 0x10000):
        if unicodedata.category(chr(cp)) in ("Mn", "Mc"):
            if ranges and ranges[-1][1] == cp - 1:
                ranges[-1] = (ranges[-1][0], cp)
            else:
                ranges.append((cp, cp))
    return "".join(re.escape(chr(a)) + (f"-{re.escape(chr(b))}" if b > a else "") for a, b in ranges)


_M = _mark_class()
# A mark with no letter before it ('(\u0301evil.com', '. \u0c4dbit.ly') shows as nothing on screen but would hide the
# word after it from the checks: dropped before scanning.
_ORPHAN_MARKS = re.compile(rf"(?<![\w{_M}])[{_M}]+")
_LATIN_X = "\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u1e00-\u1eff"  # Latin letters with accents
# Labels may be in any script, so a lookalike 'аmazon.com' (Cyrillic а) is still seen, and blocked, as a domain.
_LABEL = rf"[^\W_](?:[\w{_M}-]{{0,61}}(?:[^\W_]|[{_M}]))?"
# A TLD is one script: an ASCII one ends where the script changes ('evil.comకి' is 'evil.com' + a Telugu suffix,
# 'evil.com\u0332' is 'evil.com'); a non-Latin one ('рф', 'భారత్', 'भारत') keeps its marks; an accented-Latin
# 'TLD' ('tzn.że', 'diolch.wêl') is a sentence run together, since no real TLD is spelled that way.
_ASCII_TLD = rf"[a-z]{{2,24}}(?![a-z0-9_{_LATIN_X}-])"
_IDN_TLD = rf"[^\W\d_a-z{_LATIN_X}](?:[^\W\d_a-z{_LATIN_X}]|[{_M}]){{1,23}}(?![\w{_M}-])"
_ACCENT_TLD = rf"(?=[a-z{_LATIN_X}]*[{_LATIN_X}])[a-z{_LATIN_X}]{{2,24}}(?![\w{_M}-])"
_LATIN_ACCENTED = re.compile(f"[{_LATIN_X}]")
# Delegated IDN TLDs: with a path these are links; any other uncased 'word.word/x' (Hindi, Telugu) only gets a tap.
_IDN_TLDS = frozenset("भारत భారత్ ভারত ભારત ਭਾਰਤ இந்தியா ഭാരതം ಭಾರತ ଭାରତ بھارت 中国 中國 香港 台灣 台湾 新加坡 한국 "
                      "рф срб укр бел қаз мон рус москва онлайн сайт дети ελ ευ ไทย 公司 网络 在线 中文网 网址 商城 "
                      "السعودية امارات مصر".split())

# (?<!\s): start only at the first space of a run, so a long run of spaces costs linear time, not quadratic.
_BRACKET_DOT = re.compile(r"(?<!\s)\s*(?:\[(?:\.|dot)\]|\((?:\.|dot)\)|\{(?:\.|dot)\})\s*", re.I)
_BRACKET_AT = re.compile(r"(?<!\s)\s*(?:\[(?:@|at)\]|\((?:@|at)\)|\{(?:@|at)\})\s*", re.I)
_HXXP = re.compile(r"\bh(?:xx|tt)p(s?)(?::|\[:\])//", re.I)
_SPOKEN_DOT = re.compile(rf"(?<=[a-z0-9])\s+dot\s+(?=(?:{_SPOKEN_TLDS})\b)", re.I)
_LAST_WORD = re.compile(r"[a-z0-9-]+$", re.I)
_SPOKEN_DOT_CC = re.compile(r"(\.(?:co|ac|gov|org|net|nic|edu|ltd|plc))\s+dot\s+([a-z]{2})\b", re.I)
_SPOKEN_SLASH = re.compile(r"(\.[a-z]{2,})\s+(?:forward\s+)?slash\s+(?=\w)", re.I)
# 'ravi dot kumar at gmail.com' -> 'ravi.kumar at ...': a spoken address's own dots / underscores (bounded, so linear).
_SPOKEN_LOCAL = re.compile(r"(?<=[a-z0-9])\s+(dot|underscore)\s+(?=[a-z0-9]+(?:\s+(?:dot|underscore)\s+[a-z0-9]+){0,3}"
                           r"\s+at\s+(?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)
_SPOKEN_WWW = re.compile(r"\b(?:w\s+w\s+w|triple\s+w|double[\s-]?u\s+double[\s-]?u\s+double[\s-]?u)\s*\.", re.I)

# The local part may be in any script: an ASCII-only pattern let 'josé@evil.com' through entirely.
_EMAIL = re.compile(rf"(?<![\w.%+-])([^\W_][\w.%+-]{{0,63}})\s*@\s*((?:{_LABEL}\.)+(?:{_ASCII_TLD}|{_IDN_TLD}))", re.I)
_SPOKEN_EMAIL = re.compile(
    rf"(?<![\w.%+-])([a-z0-9][a-z0-9._%+-]{{0,63}})\s+at\s+((?:{_LABEL}\.)+(?:{_TLDS}))(?![\w/-])", re.I)
# "find it at example.com" / "log in at example.com" is a link, not the address it@example.com.
_NOT_EMAIL_LOCAL = frozenset("""me it us him her them you home work school this that here there one site website
    web page link online look find visit check out menu book booking apply form more all everything details in on
    up off now today tomorrow available listed posted shared uploaded photo photos pictures video videos recipe
    news article story order tickets live is are was""".split())

# Any scheme ('https://', 'tg://', 'intent://'), 'www.', or a bare domain (vetted by _is_link).
_URL = re.compile(rf"\b[a-z][a-z0-9+.-]{{1,15}}://[^\s<>\"'«»]+|\bwww\.[^\s<>\"'«»]+"
                  rf"|(?<![\w{_M}])(?<![\w{_M}][.@-])(?:{_LABEL}\.)*(?P<reg>{_LABEL})\."
                  rf"(?P<tld>xn--[a-z0-9-]{{1,59}}(?![\w-])|{_ASCII_TLD}|{_IDN_TLD}|{_ACCENT_TLD})"
                  rf"(?P<port>:\d{{2,5}}(?!\d))?(?P<path>[/?#][^\s<>\"'«»]*)?", re.I)
_URL_TRAIL = ".,;:!?)]}>'\"»"
# A bare IPv4 host with a port or a path ('203.0.113.5/pay', '10.0.0.1:8080') is a link; a lone dotted number
# ('version 1.2.3.4') is left to the number checks.
_IP_URL = re.compile(rf"(?<![\w{_M}])(?<!\d\.)(?P<host>(?:\d{{1,3}}\.){{3}}\d{{1,3}})(?P<port>:\d{{2,5}})?"
                     r"(?P<path>[/?#][^\s<>\"'«»]*)?(?![\w.])")

_IBAN_COUNTRIES = frozenset("""AD AE AL AT AZ BA BE BG BH BI BR BY CH CR CY CZ DE DJ DK DO EE EG ES FI FK FO FR GB GE
    GI GL GR GT HR HU IE IL IQ IS IT JO KW KZ LB LC LI LT LU LV LY MC MD ME MK MN MR MT MU NI NL NO OM PK PL PS PT QA
    RO RS RU SA SC SD SE SI SK SM SO ST SV TL TN TR UA VA VG XK YE""".split())
_IBAN = re.compile(r"(?<![a-z0-9])[a-z]{2}\d{2}(?:[ -]?[a-z0-9]{4}){2,7}(?:[ -]?[a-z0-9]{1,4})?(?![a-z0-9])", re.I)

_SORT_CODE = re.compile(r"(?<![\d\-/.:])(\d{2})([ -]?)(\d{2})\2(\d{2})(?![\d\-/.:])")
_SORT_WORD = re.compile(r"\bsort[\s-]*codes?\b", re.I)
_SORT_NEAR = 40  # chars between "sort code" and an un-dashed "40 47 84" for it to count

# A run of digits joined by phone-ish separators ('07700 900123', '07700.900.123', 'Call07700900123'); cards and
# phones are then picked out of it by _scan_digits. It never starts right after a currency ('Rs500000000').
_CLUSTER = re.compile(r"(?<![\d_£$€₹+])(?<!\d[.,])(?<!rs)(?<!rs\.)(?<!inr)(?<!gbp)(?<!usd)(?<!eur)"
                      r"\+?\(?\d(?:[ \t\-().]{0,3}\d)*\)?", re.I)
_DIGIT_RUN = re.compile(r"\d(?:[\s\-().+/]*\d)*")


def _spoken_dot(m: re.Match) -> str:
    """' dot ' -> '.', unless the word before it is in _NOT_SPOKEN_SITE (a lookbehind keeps this linear-time)."""
    word = _LAST_WORD.search(m.string, max(0, m.start() - 12), m.start())
    whole = word and (word.start() == 0 or not m.string[word.start() - 1].isalnum())
    return m.group(0) if whole and word.group(0).lower() in _NOT_SPOKEN_SITE else "."


def _deobfuscate(text: str) -> str:
    """'example dot com', 'evil[.]com', 'ravi (at) gmail', 'hxxp://' -> plain form, so obfuscation can't hide a link."""
    text = _BRACKET_DOT.sub(".", text)
    text = _BRACKET_AT.sub("@", text)
    text = _HXXP.sub(lambda m: f"http{m.group(1).lower()}://", text)
    text = _SPOKEN_DOT.sub(_spoken_dot, text)
    text = _SPOKEN_DOT_CC.sub(r"\1.\2", text)
    text = _SPOKEN_LOCAL.sub(lambda m: "." if m.group(1).lower() == "dot" else "_", text)
    text = _SPOKEN_WWW.sub("www.", text)
    return _SPOKEN_SLASH.sub(r"\1/", text)


def _is_link(m: re.Match, before: str = "") -> bool | str:
    """Is this _URL match a link? True (block it), "maybe" (a 'possible_link' flag: the person taps to confirm) or
    False. `before` is the character just before the match.

    Scheme / 'www.' and listed TLDs: a link (except 'B.Com' / 'B.Tech': a one-letter name with no path). For any
    other TLD the writing decides, because ordinary sentences run together too:
      * lower case or ALL CAPS ('evil.it', 'photos.family/ravi', 'ФОТО.РФ'): a link, but numbered lists, dates and
        titles ('1.tea/coffee', '25.oct/26.oct', 'dr.rao/dr.reddy', 'ref.no:45678') and '@ravi.photos' handles are
        only "maybe";
      * Capitalised ('Amma.How', 'Photos.Family/ravi'): a link only with a path when the name looks registered
        ('Hsbc-Secure.Support/verify': a hyphen, a digit, or 3+ labels); "maybe" with any other path or port;
      * initials and degrees ('K.Ravi/K.Sita', 'M.Sc/M.Tech', 'R.K.Puram') and accented Latin ('tzn.że'): never
        more than "maybe";
      * scripts without case (Hindi, Telugu, CJK): a link with a path only for a real IDN TLD ('.भारत', '.中国');
        otherwise "maybe" with a path ('डॉ.राव/डॉ.रेड्डी' is two names).
    """
    if not m.group("tld"):
        return True
    tld, reg = m.group("tld"), m.group("reg")
    path, port = (m.group("path") or "").rstrip(_URL_TRAIL), m.group("port")
    domain = m.group(0)[:m.end("tld") - m.start()]
    tl, tail = tld.lower(), bool(path or port)
    if tl in _NOT_TLD:
        return False
    if tl in _KNOWN_TLDS or tl.startswith("xn--"):
        return not (len(reg) == 1 and len(path) < 2 and not port)
    if _LATIN_ACCENTED.search(tld):
        return "maybe" if tail else False
    if tl == tld.upper():  # no letter case
        if tl in _IDN_TLDS:
            return True if tail else "maybe"
        return "maybe" if tail else False
    plain = tld.islower() or domain.isupper()
    if len(reg) == 1:
        return "maybe" if plain and len(path) >= 2 else False
    if reg.isdigit():  # '360.photos/ravi' is a site; '1.tea/coffee', '8.pm/9.pm' are lists and times; '10.am' neither
        return (True if len(reg) >= 3 else "maybe") if plain and tail else False
    if domain.count(".") == 1 and reg.lower() in _NOT_SITE:
        return "maybe" if plain and tail else False
    if plain:
        return "maybe" if before == "@" and not tail else True
    if path and ("-" in reg or any(c.isdigit() for c in reg) or domain.count(".") >= 2):
        return True
    return "maybe" if tail else False


def _norm_url(raw: str) -> str:
    """Lowercase, no http(s) scheme, no 'www.', no trailing '/', so 'https://www.Example.com/' == 'example.com'."""
    url = raw.lower()
    url = re.sub(r"^h(?:tt|xx)ps?://", "", url)
    url = re.sub(r"^www\.", "", url)
    return url.rstrip("/")


def _iban_ok(iban: str) -> bool:
    """ISO 13616 mod-97 check: a sentence that merely looks like an IBAN ('SW19 town hall area ...') never passes."""
    if not (15 <= len(iban) <= 34) or iban[:2] not in _IBAN_COUNTRIES or not iban[2:4].isdigit():
        return False
    moved = iban[4:] + iban[:4]
    if not (moved.isascii() and moved.isalnum()):  # re.I lets 'ſ' / Kelvin 'K' match [a-z]
        return False
    return int("".join(str(int(c, 36)) for c in moved)) % 97 == 1


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def _card(window: str, plus: bool) -> str | None:
    """Digits of a payment card (13-19 digits, Luhn, groups of 3+), or None.

    No card number starts with 0, so a UK phone number ('07700 900123') can never be mistaken for one.
    """
    digits = re.sub(r"\D", "", window)
    groups = re.findall(r"\d+", window)
    if plus or not 13 <= len(digits) <= 19 or digits[0] == "0" or any(len(g) < 3 for g in groups):
        return None
    return digits if _luhn_ok(digits) else None


def _phone(window: str, plus: bool) -> str | None:
    """Digits of a phone number (UK/intl), or None.

    '+44 ...' / '0044 ...' need 9-15 digits after the prefix; national '07700 900123' needs 10-12 digits in groups
    of 2+; anything else needs 9-15 digits in groups of 3+ ('98765 43210'), so '25 10 2026 8 30' isn't a phone.
    """
    window = window.replace("(0)", "")
    digits = re.sub(r"\D", "", window)
    groups = re.findall(r"\d+", window)
    if plus or digits.startswith("00"):
        digits = digits if plus else digits[2:]
        return digits if 9 <= len(digits) <= 15 else None
    if digits.startswith("0"):
        ok = 10 <= len(digits) <= 12 and len(groups[0]) >= 3 and all(len(g) >= 2 for g in groups)
        return digits if ok else None
    return digits if 9 <= len(digits) <= 15 and all(len(g) >= 3 for g in groups) else None


def _scan_digits(cluster: str) -> list[tuple[str, str, int, int]]:
    """Cards and phones inside one digit cluster: (key, digits, start, end), trying the longest window first.

    Windows matter because a cluster can glue a stray number to a phone ('at 2 07700 900123'). No window is wider
    than 20 digits (a card has at most 19), which also keeps a long run of spaced digits linear, not quadratic.
    """
    tokens = [(m.start(), m.end()) for m in re.finditer(r"\d+", cluster)]
    found, i = [], 0
    while i < len(tokens):
        hit, width, widest = None, 0, i
        while widest < len(tokens) and width + tokens[widest][1] - tokens[widest][0] <= 20:
            width += tokens[widest][1] - tokens[widest][0]
            widest += 1
        start = 0 if i == 0 else tokens[i][0]
        plus = i == 0 and "+" in cluster[:tokens[0][0]]
        first = cluster[tokens[i][0]:tokens[i][1]]
        singles = i
        while singles < len(tokens) and singles - i < 15 and tokens[singles][1] - tokens[singles][0] == 1:
            singles += 1
        if singles - i >= 9:  # read out digit by digit: '0 7 7 0 0 9 0 0 1 2 3'
            digits = re.sub(r"\D", "", cluster[tokens[i][0]:tokens[singles - 1][1]])
            found.append(("phones", digits, start, tokens[singles - 1][1]))
            i = singles
            continue
        if i and cluster[tokens[i][0] - 1] in ".,":
            i += 1  # the '30' of '8.30' or the '14159' of '3.14159' is never the start of a phone
            continue
        if not plus and (len(first) < 2 or (len(first) < 3 and first != "00")):
            i += 1  # without a prefix every phone/card starts with a group of 3+ ('07700', '4111') or '00'
            continue
        for j in range(widest, i, -1):
            window = cluster[start:tokens[j - 1][1]]
            for key, test in (("card_numbers", _card), ("phones", _phone)):
                value = test(window, plus)
                if value:
                    hit = (key, value, start, tokens[j - 1][1], j)
                    break
            if hit:
                break
        if hit:
            found.append(hit[:4])
            i = hit[4]
        else:
            i += 1
    return found


def _scan(text: str) -> tuple[str, dict[str, list[str]], str, set[str]]:
    """(prepared text, contacts found, text with contacts blanked out, emails written as 'x at y.com') - one pass
    shared by all checks.

    Prep: _clean (digits, invisible characters, lookalike dots), spoken digit runs -> digits, then _deobfuscate.
    Order matters: emails before links (so the domain of an address isn't also a link), IBANs and sort codes
    before phones and cards (so their digits aren't counted twice).
    """
    prepped = _deobfuscate(_SPOKEN_DIGITS.sub(_spoken_digits, _ORPHAN_MARKS.sub("", _clean(text))))
    buf = list(prepped)
    found: dict[str, list[str]] = {key: [] for key in CONTACT_KINDS}
    found["maybe_urls"] = []  # capitalised 'Photos.Family/ravi': a tap, not a block (see _is_link)
    spoken: set[str] = set()

    def take(key: str, value: str, start: int, end: int) -> None:
        if value and value not in found[key]:
            found[key].append(value)
        buf[start:end] = " " * (end - start)

    for m in _EMAIL.finditer("".join(buf)):
        take("emails", f"{m.group(1)}@{m.group(2)}".lower(), m.start(), m.end())
    for m in _SPOKEN_EMAIL.finditer("".join(buf)):
        if m.group(1).lower() not in _NOT_EMAIL_LOCAL:
            spoken.add(f"{m.group(1)}@{m.group(2)}".lower())
            take("emails", f"{m.group(1)}@{m.group(2)}".lower(), m.start(), m.end())

    text_now = "".join(buf)
    for m in _URL.finditer(text_now):
        raw = m.group(0).rstrip(_URL_TRAIL)
        link = _is_link(m, text_now[m.start() - 1:m.start()]) if raw else False
        if link:
            take("urls" if link is True else "maybe_urls", _norm_url(raw), m.start(), m.start() + len(raw))
    for m in _IP_URL.finditer("".join(buf)):
        raw = m.group(0).rstrip(_URL_TRAIL)
        path = (m.group("path") or "").rstrip(_URL_TRAIL)
        groups = m.group("host").split(".")
        if any(int(g) > 255 for g in groups) or (all(len(g) == 3 for g in groups[1:]) and
                                                 any(g.startswith("0") for g in groups[1:])):
            continue  # not an address ('1.250.000.000' is a thousand million)
        # A port, '?', '#', or a path that isn't just more numbers ('4.2.1.3/4.2.1.4' lists sections, not a link).
        if m.group("port") or (path and not re.fullmatch(r"/[\d.]+", path)):
            take("urls", _norm_url(raw), m.start(), m.start() + len(raw))

    for m in _IBAN.finditer("".join(buf)):
        parts = [(p.start(), p.end()) for p in re.finditer(r"[^\s-]+", m.group(0))]
        for end in range(len(parts), 0, -1):  # drop trailing words the pattern swallowed ('... 32 town')
            compact = re.sub(r"[\s-]", "", m.group(0)[:parts[end - 1][1]]).upper()
            if _iban_ok(compact):
                take("ibans", compact, m.start(), m.start() + parts[end - 1][1])
                break

    sort_words = [w.span() for w in _SORT_WORD.finditer(prepped)]
    for m in _SORT_CODE.finditer("".join(buf)):
        near = any(m.start() - _SORT_NEAR <= w_end and w_start <= m.end() + _SORT_NEAR for w_start, w_end in sort_words)
        if m.group(2) == "-" or near:
            take("sort_codes", m.group(1) + m.group(3) + m.group(4), m.start(), m.end())

    for m in _CLUSTER.finditer("".join(buf)):
        for key, value, start, end in _scan_digits(m.group(0)):
            take(key, value, m.start() + start, m.start() + end)

    return prepped, found, "".join(buf), spoken


def find_contacts(text: str) -> dict[str, list[str]]:
    """Every way to reach or pay someone in `text`, normalised so a draft and a transcript compare equal.

    Keys: urls (lowercase, no http(s)/www/trailing '/'; any script, so 'аmazon.com' with a Cyrillic 'а' is kept
    as written), phones (digits; '+'/'00' dropped; also '07700.900.123', '0 7 7 0 0 ...', 'oh seven seven ...'),
    emails (lowercase, ' at ' / ' dot ' spelled out is understood), ibans (uppercase, no spaces or dashes, mod-97
    valid), sort_codes (6 digits), card_numbers (digits, Luhn valid). Digits of any script count. Each list is
    de-duplicated, in text order.
    """
    return {key: value for key, value in _scan(text)[1].items() if key in CONTACT_KINDS}


def _was_said(key: str, value: str, said: dict[str, list[str]], transcript: str, spoken: bool = False) -> bool:
    """Did the person say this contact? Compared loosely enough that reformatting by the composer isn't punished.

    `spoken` marks a draft email written 'recipe at example.com': prose about a site the person named, not an
    address, so it passes when that site was said as a site. Not when they only said an address there: after
    'my email is ravi at gmail dot com', a draft 'or use scammer at gmail dot com' is a new address.
    """
    if value in said[key]:
        return True
    if key in ("urls", "maybe_urls"):  # 'example.com' is fine if they said 'example.com/menu' or 'ravi at example dot com'
        if value in {email.split("@", 1)[1] for email in said["emails"]}:
            return True
        if value in said.get("maybe_urls", []) or value in said["urls"]:
            return True
        # '192.168.0.1' said, '192.168.0.1/' or '192.168.0.1:631' drafted - nothing more (a path or a host built on the
        # same digits still has to be said)
        ip = re.fullmatch(r"((?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?/?", value)
        if ip and re.search(rf"(?<![\d.]){re.escape(ip.group(1))}(?!\d|\.\d)", transcript):
            return True
        return any(url.startswith(value + sep) for url in said["urls"] for sep in "/?#")
    if key == "emails":
        return spoken and value.split("@", 1)[1] in said["urls"]
    if key == "ibans":
        return value in re.sub(r"[^A-Z0-9]", "", transcript.upper())
    if key in ("phones", "card_numbers", "sort_codes"):
        # Phones: the last 9 digits identify the line, so '07700 900123' said == '+44 7700 900123' drafted.
        needle = value[-9:] if key == "phones" else value
        return any(needle in re.sub(r"\D", "", run) for run in _DIGIT_RUN.findall(transcript))
    return False


# ---------- numbers ----------

_SMALL = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
          "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
          "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
          "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_SMALL_WORD = "|".join(sorted(_SMALL, key=len, reverse=True))
_NUM_WORD = _SMALL_WORD + "|hundred|thousand"
# A run never starts with 'hundred'/'thousand' after a digit: '5 thousand' is one number (see _MULT_RE), not 5, 1000.
_WORD_RUN = re.compile(rf"\b(?:{_SMALL_WORD}|(?<!\d )(?:hundred|thousand)|a(?=\s+(?:hundred|thousand)\b))"
                       rf"(?:(?:\s+and\s+|[\s-]+)(?:{_NUM_WORD}))*\b", re.I)
# A lone "one" is usually a pronoun ("the one you liked"), so it only counts before a unit.
_ONE_IS_NUMBER = re.compile(r"\s*(?:o'?clock|[ap]\.?m\b|hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|"
                            r"nights?|pounds?|quid|rupees?|dollars?|euros?|pence|percent|%|times?\b)", re.I)

# Telugu / Hindi / Welsh number words, counted only before a unit ('ఎనిమిది గంటలకు', 'आठ बजे', 'aath baje',
# "wyth o'r gloch"): alone, Hindi 'दो' / 'do' is also 'give' and Welsh 'un' also 'the same'.
_LOCAL_NUMS = {unicodedata.normalize("NFC", word): value for word, value in {
    "ఒకటి": 1, "ఒంటి": 1, "రెండు": 2, "మూడు": 3, "నాలుగు": 4, "ఐదు": 5, "అయిదు": 5, "ఆరు": 6, "ఏడు": 7,
    "ఎనిమిది": 8, "తొమ్మిది": 9, "పది": 10, "పదకొండు": 11, "పన్నెండు": 12,
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9,
    "दस": 10, "ग्यारह": 11, "बारह": 12,
    "ek": 1, "do": 2, "teen": 3, "chaar": 4, "char": 4, "paanch": 5, "panch": 5, "chhe": 6, "chhah": 6, "saat": 7,
    "aath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12, "baarah": 12,
    "un": 1, "dau": 2, "dwy": 2, "ddau": 2, "ddwy": 2, "tri": 3, "dri": 3, "tair": 3, "dair": 3, "pedwar": 4,
    "bedwar": 4, "pedair": 4, "bedair": 4, "pump": 5, "pum": 5, "bump": 5, "bum": 5, "chwech": 6, "chwe": 6,
    "saith": 7, "wyth": 8, "naw": 9, "deg": 10, "ddeg": 10, "deuddeg": 12, "ddeuddeg": 12}.items()}
_LOCAL_UNIT = (r"గంట|రోజు|నిమిష|రూపాయ|వేల|వేయి|లక్ష|కోట|సంవత్సర|వార|వంద"
               r"|बज|घंट|दिन|मिनट|रुप[यए]|हज़ार|हजार|लाख|करोड़|साल|हफ़्त|हफ्त|सौ"
               r"|(?:baje|bje|ghant[ae]|din|minat|mint|rupa?ye?|rupees?|haz?aa?r|lakh|crore|saal|sau|hafte"
               r"|o'r\s+gloch|awr|oriau|diwrnod|diwrnodau|munud|punt|bunt|phunt|mhunt|punnoedd|bunnoedd|mil|wythnos)\b")
_LOCAL_NUM = re.compile(unicodedata.normalize(
    "NFC", rf"(?<!\w)({'|'.join(sorted(_LOCAL_NUMS, key=len, reverse=True))})\s+(?={_LOCAL_UNIT})"), re.I)

# 'half past 8' / 'half 8' (British: 8:30), 'quarter to 9', and Hindi 'saadhe 8' (8:30), 'sawa 8' (8:15),
# 'paune 9' (8:45) - unless an amount follows ('saadhe 3 lakh' is 350,000, not a time).
_CLOCK_PHRASE = re.compile(unicodedata.normalize(
    "NFC", r"\b(?:(?P<half>half)\s+(?:past\s+)?|(?P<quarter>quarter)\s+(?P<dir>past|to)\s+"
           r"|(?P<sadhe>saa?dh?e|saa?rhe|साढ़े|साढे)\s*|(?P<sawa>sawa|sava|savaa|सवा)\s+|(?P<paune>paune|पौने)\s+)"
           r"(?P<hour>\d{1,2})(?![\d:.])(?!\s*(?:%|percent|kgs?\b|kilos?|grams?|litres?|liters?|lakhs?|crores?|"
           r"thousand|hundred|million|k\b|sau\b|सौ|लाख|हज़ार|हजार|करोड़|times?\b|years?|months?|weeks?|days?|"
           r"hours?|hrs?|ghant|घंट))"), re.I)

_NUM = r"(?:\d{1,3}(?:,\d{3})+(?!\d)|\d{1,2}(?:,\d{2})+,\d{3}(?!\d)|\d+)"  # 8 / 1,000 / 1,00,000 (lakh style)
_MONTH_RE = (r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
             r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?")
_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10,
           "nov": 11, "dec": 12}
_AMPM = r"[ap]\.?m\.?"
_CURRENCY = {"£": "£", "gbp": "£", "pound": "£", "pounds": "£", "quid": "£", "$": "$", "usd": "$", "dollar": "$",
             "dollars": "$", "bucks": "$", "€": "€", "eur": "€", "euro": "€", "euros": "€", "₹": "₹", "rs": "₹",
             "rs.": "₹", "inr": "₹", "rupee": "₹", "rupees": "₹", "rupaye": "₹", "rupay": "₹", "rupaiya": "₹",
             "rupiya": "₹"}
# Multipliers after a number: '10k', '2 lakh', '5 thousand', '2 लाख', '5 వేల' (Telugu thousands), '3 కోట్లు'.
_MULT_WORDS = tuple((unicodedata.normalize("NFC", word), value) for word, value in (
    ("thousand", 1000), ("hundred", 100), ("million", 10**6), ("lakh", 10**5), ("crore", 10**7), ("sau", 100),
    ("हज़ार", 1000), ("हजार", 1000), ("सौ", 100), ("लाख", 10**5), ("करोड़", 10**7),
    ("వేల", 1000), ("వేయి", 1000), ("వంద", 100), ("లక్ష", 10**5), ("కోట", 10**7), ("k", 1000)))
_MULT_RE = unicodedata.normalize("NFC", r"(?:k(?![a-z])|thousand|hundred|million|lakhs?|crores?|sau|हज़ार|हजार|सौ|लाख"
                                        r"|करोड़|వేల[\u0c00-\u0c7f]*|వేయి|వంద[\u0c00-\u0c7f]*|లక్ష[\u0c00-\u0c7f]*"
                                        r"|కోట[\u0c00-\u0c7f]*)(?!\w)")
# Hindi fractions: 'saadhe 3 lakh' = 3.5 lakh, 'dedh lakh' = 1.5 lakh, 'dhai sau' = 250, 'dhai baje' = 2:30.
_SADHE_AMOUNT = re.compile(unicodedata.normalize(
    "NFC", rf"\b(?:saa?dh?e|saa?rhe|साढ़े|साढे)\s*(\d{{1,3}})(?=\s*{_MULT_RE})"), re.I)
_DEDH_DHAI = re.compile(unicodedata.normalize(
    "NFC", rf"\b(?:(?P<dedh>dedh|derh|डेढ़)|dhaa?i|ढाई)\s+(?:(?={_MULT_RE})|(?P<clock>(?:baje|bje|बजे)(?!\w)))"), re.I)
_CUR_WORD = r"pounds?|quid|gbp|rupees?|rupaye|rupay|rupaiya|rupiya|rs|inr|dollars?|bucks|usd|euros?|eur"
_CUR_INDIC = r"రూపాయ|रुप[यए]"  # Telugu rupaayalu / Hindi rupaye, any suffix

_FACT = re.compile(
    rf"(?P<cp>[£$€₹]|\b(?:rs\.?|inr|gbp|usd|eur)(?=\s?\d))\s?(?P<cpa>{_NUM}(?:\.\d{{1,2}})?)"
    rf"(?:\s?(?P<cpm>{_MULT_RE}))?"
    rf"|(?P<cwa>{_NUM}(?:\.\d{{1,2}})?)\s?(?:(?P<cwm>{_MULT_RE})\s)?(?P<cw>(?:{_CUR_WORD})\b|{_CUR_INDIC})"
    rf"|(?P<ma>{_NUM}(?:\.\d+)?)\s?(?P<mw>{_MULT_RE})"
    rf"|(?P<pa>\d+)(?:p\b(?!\.\s?m\b)|\s?pence\b)"
    rf"|(?P<iy>\d{{4}})-(?P<im>\d{{1,2}})-(?P<id>\d{{1,2}})(?!\d)"
    rf"|(?P<nd>\d{{1,2}})(?P<ns>[/.-])(?P<nm>\d{{1,2}})(?P=ns)(?P<ny>\d{{4}}|\d{{2}})(?!\d)"
    rf"|(?P<sd>\d{{1,2}})/(?P<sm>\d{{1,2}})(?![\d/])"
    rf"|(?P<wd>\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<wm>{_MONTH_RE})\b\.?(?:,?\s+(?P<wy>\d{{4}})(?!\d))?"
    rf"|(?P<mm>{_MONTH_RE})\b\.?\s+(?P<md>\d{{1,2}})(?:st|nd|rd|th)?(?!\d)(?:,?\s+(?P<my>\d{{4}})(?!\d))?"
    rf"|(?P<th>\d{{1,2}})(?P<ts>[:.])(?P<tm>\d{{2}})(?!\d)(?:\s?(?P<tap>{_AMPM})(?!\w))?"
    rf"|(?P<ah>\d{{1,2}})\s?(?P<aap>{_AMPM})(?!\w)"
    rf"|(?P<dec>\d+\.\d+)"
    rf"|(?P<int>{_NUM})(?:st|nd|rd|th)?",
    re.I)
_TIME_CONTEXT = re.compile(r"\b(?:at|by|around|about|till|until|from|before|after|between)\s*$", re.I)


class _Fact(NamedTuple):
    canon: str          # what numbers() returns: "8", "8:30", "20:00", "£20", "20.50", "25/10"
    kind: str           # "int" | "dec" | "money" | "time" | "date"
    value: object       # Decimal (int/dec/money), minutes since midnight (time), (day, month, year|None) (date)
    cur: str = ""       # currency symbol for money
    explicit: bool = False  # time is unambiguous (had am/pm, or 24h > 12)
    alt: Decimal | None = None  # "8.30" read as a time might still have been an amount


def _words_to_digits(text: str) -> str:
    """'twenty five' -> '25', 'two hundred and fifty' -> '250', 'eight thirty' -> '8 30' (two numbers)."""
    def parse(words: list[str]) -> list[int]:
        nums, total, cur, last = [], 0, 0, None
        for word in words:
            if word == "and":
                continue
            if word in _SMALL or word == "a":
                value = 1 if word == "a" else _SMALL[word]
                kind = "tens" if value >= 20 else ("teen" if value >= 10 else "unit")
                if not (last in (None, "hundred", "thousand") or (last == "tens" and kind == "unit")):
                    nums.append(total + cur)
                    total, cur = 0, 0
                cur += value
                last = kind
            elif word == "hundred":
                if last in ("hundred", "thousand"):
                    nums.append(total + cur)
                    total, cur = 0, 0
                cur = (cur or 1) * 100
                last = "hundred"
            else:  # thousand
                if last == "thousand" or total:
                    nums.append(total + cur)
                    total, cur = 0, 0
                total += (cur or 1) * 1000
                cur = 0
                last = "thousand"
        nums.append(total + cur)
        return nums

    def swap(m: re.Match) -> str:
        words = [w.lower() for w in re.split(r"[\s-]+", m.group(0)) if w]
        if words == ["one"] and not _ONE_IS_NUMBER.match(text, m.end()):
            return m.group(0)
        return " ".join(str(n) for n in parse(words))

    text = _LOCAL_NUM.sub(lambda m: f"{_LOCAL_NUMS[m.group(1).lower()]} ", text)
    text = _SADHE_AMOUNT.sub(r"\1.5", text)
    text = _DEDH_DHAI.sub(_dedh_dhai, text)
    text = _WORD_RUN.sub(swap, text)
    return _CLOCK_PHRASE.sub(_clock_phrase, text)


def _clock_phrase(m: re.Match) -> str:
    """'half past 8' / 'half 8' / 'saadhe 8' -> '8:30', 'quarter past 8' / 'sawa 8' -> '8:15', 'quarter to 9' /
    'paune 9' -> '8:45' (how times are often said)."""
    hour = int(m.group("hour"))
    if m.group("half") or m.group("sadhe"):
        return f"{hour}:30"
    if m.group("sawa") or (m.group("quarter") and m.group("dir").lower() == "past"):
        return f"{hour}:15"
    return f"{(hour - 1) % 12 or 12}:45"


def _dedh_dhai(m: re.Match) -> str:
    half = "1" if m.group("dedh") else "2"
    return f"{half}:30 {m.group('clock')}" if m.group("clock") else f"{half}.5 "


def _mult(word: str) -> int:
    word = word.lower()
    return next((value for prefix, value in _MULT_WORDS if word.startswith(prefix)), 1)


def _dec(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", ""))
    except InvalidOperation:
        return None


def _fmt(value: Decimal) -> str:
    """'20' / '20.50' - via Decimal, never int(), so a 5,000-digit 'number' can't hit Python's int-str limit."""
    return format(value.to_integral_value(), "f") if value == value.to_integral_value() else f"{value:.2f}"


def _digits(raw: str) -> str:
    """'08' -> '8', '1,000' -> '1000', '000' -> '0'."""
    return raw.replace(",", "").lstrip("0") or "0"


def _date(day: int, month: int, year: int | None) -> _Fact | None:
    if not (1 <= day <= 31 and 1 <= month <= 12):
        return None
    if year is not None and year < 100:
        year += 2000
    canon = f"{day}/{month}" + (f"/{year}" if year else "")
    return _Fact(canon, "date", (day, month, year))


def _ints(*parts: str) -> list[_Fact]:
    return [_Fact(str(int(p)), "int", Decimal(int(p))) for p in parts if p and p.isdigit()]


def _fact_from(m: re.Match, text: str) -> list[_Fact]:
    """Turn one _FACT match into facts; a match that fails validation (month 13, 25:99) falls back to plain ints."""
    g = m.groupdict()
    if g["cpa"] or g["cwa"]:
        amount = _dec(g["cpa"] or g["cwa"])
        mult = g["cpm"] or g["cwm"]
        if amount is None:
            return []
        amount *= _mult(mult) if mult else 1
        word = (g["cp"] or g["cw"] or "").lower()
        cur = _CURRENCY.get(word) or ("₹" if re.match(_CUR_INDIC, word) else "")
        return [_Fact(f"{cur}{_fmt(amount)}", "money", amount, cur)]
    if g["ma"]:
        amount = _dec(g["ma"])
        if amount is None:
            return []
        amount *= _mult(g["mw"])
        return [_Fact(_fmt(amount), "int" if amount == amount.to_integral_value() else "dec", amount)]
    if g["pa"]:
        amount = Decimal(g["pa"]) / 100
        return [_Fact(f"£{_fmt(amount)}", "money", amount, "£")]
    if g["iy"]:
        fact = _date(int(g["id"]), int(g["im"]), int(g["iy"]))
        return [fact] if fact else _ints(g["iy"], g["im"], g["id"])
    if g["nd"]:
        fact = _date(int(g["nd"]), int(g["nm"]), int(g["ny"]))
        return [fact] if fact else _ints(g["nd"], g["nm"], g["ny"])
    if g["sd"]:
        fact = _date(int(g["sd"]), int(g["sm"]), None)
        return [fact] if fact else _ints(g["sd"], g["sm"])
    if g["wm"] or g["mm"]:
        month = _MONTHS[(g["wm"] or g["mm"])[:3].lower()]
        day, year = (g["wd"], g["wy"]) if g["wm"] else (g["md"], g["my"])
        fact = _date(int(day), month, int(year) if year else None)
        return [fact] if fact else _ints(day, year)
    if g["th"]:
        hour, minute, ampm = int(g["th"]), int(g["tm"]), (g["tap"] or "").lower()
        dotted = g["ts"] == "."
        is_time = hour <= 24 and minute <= 59
        if is_time and dotted and not ampm:  # "8.30" is a UK time; "20.50" is an amount unless "at 20.50"
            is_time = hour <= 12 or bool(_TIME_CONTEXT.search(text[max(0, m.start() - 16):m.start()]))
        if not is_time:
            if dotted:
                return [_Fact(f"{hour}.{g['tm']}", "dec", Decimal(f"{hour}.{g['tm']}"))]
            return _ints(g["th"], g["tm"])
        if ampm:
            hour = hour % 12 + (12 if ampm.startswith("p") else 0) if hour <= 12 else hour
        alt = Decimal(f"{int(g['th'])}.{g['tm']}") if dotted and not ampm else None
        explicit = bool(ampm) or hour > 12 or hour == 0
        return [_Fact(f"{hour}:{minute:02d}", "time", hour * 60 + minute, "", explicit, alt)]
    if g["ah"]:
        hour, ampm = int(g["ah"]), g["aap"].lower()
        if hour > 12:
            return _ints(g["ah"])
        hour = hour % 12 + (12 if ampm.startswith("p") else 0)
        return [_Fact(f"{hour}:00", "time", hour * 60, "", True)]
    if g["dec"]:
        whole, frac = g["dec"].split(".")
        return [_Fact(f"{_digits(whole)}.{frac}", "dec", Decimal(g["dec"]))]
    if g["int"]:
        value = _dec(g["int"])
        return [_Fact(_digits(g["int"]), "int", value)] if value is not None else []
    return []


def _facts(masked: str) -> list[_Fact]:
    """Numeric facts in text whose contacts are already blanked out (so phone digits aren't 'numbers' too)."""
    text = _words_to_digits(masked)
    facts: list[_Fact] = []
    seen: set[str] = set()
    for m in _FACT.finditer(text):
        for fact in _fact_from(m, text):
            if fact.canon not in seen:
                seen.add(fact.canon)
                facts.append(fact)
    return facts


def numbers(text: str) -> list[str]:
    """Numeric facts as canonical strings, after normalise_digits and with contacts left out.

    Times: '08:30' -> '8:30', '8pm' -> '20:00', '8.30' -> '8:30'. Amounts: '£20', '20 pounds' -> '£20', '₹500',
    '50p' -> '£0.50', '20.50'. Dates: '25/10', '25 Oct' -> '25/10', '25th October 2026' -> '25/10/2026'.
    Integers: '8', '1,000' -> '1000', '10k' / '10 thousand' -> '10000', '2 lakh' -> '200000'; English number words
    'twenty five' -> '25'; 'half eight' / 'saadhe 8' -> '8:30'; Telugu / Hindi / Welsh number words before a unit
    ('ఎనిమిది గంటలకు', 'आठ बजे', "wyth o'r gloch") -> '8'. De-duplicated, in text order.
    """
    return [fact.canon for fact in _facts(_scan(text)[2])]


def _as_minutes(fact: _Fact) -> tuple[int, bool] | None:
    """(minutes, unambiguous) when a fact can be read as a clock time: '8' -> 8:00, '8.30' -> 8:30."""
    if fact.kind == "time":
        return fact.value, fact.explicit
    if fact.kind == "int" and fact.value == fact.value.to_integral_value() and 0 <= fact.value <= 24:
        hour = int(fact.value)
        return hour * 60, hour > 12 or hour == 0
    if fact.kind == "dec":
        whole, _, frac = fact.canon.partition(".")
        if len(frac) == 2 and len(whole) <= 2 and int(whole) <= 24 and int(frac) <= 59:
            return int(whole) * 60 + int(frac), int(whole) > 12
    return None


def _same(a: _Fact, b: _Fact) -> bool:
    """Do two facts state the same thing? '8' ~ '8pm' ~ '20:00', '£20' ~ '20', but '£20' != '₹20' and '8am' != '8pm'."""
    if a.kind == "date" or b.kind == "date":
        if a.kind != b.kind or a.value[:2] != b.value[:2]:
            return False
        return a.value[2] is None or b.value[2] is None or a.value[2] == b.value[2]
    if a.kind == "time" or b.kind == "time":
        time, other = (a, b) if a.kind == "time" else (b, a)
        if time.alt is not None and other.kind in ("dec", "money") and other.value == time.alt:
            return True
        ma, mb = _as_minutes(a), _as_minutes(b)
        if ma is None or mb is None:
            return False
        return ma[0] == mb[0] or (not (ma[1] and mb[1]) and ma[0] % 720 == mb[0] % 720)
    if a.value != b.value:
        return False
    return not (a.cur and b.cur and a.cur != b.cur)


# ---------- risk topics ----------

# Kept short on purpose: each hit only asks for a tap. English and Welsh words match whole words (plurals and Welsh
# mutated forms listed: talu/dalu/thalu/nhalu = pay); romanised Hindi/Telugu match as word prefixes (they take
# suffixes: dabbulu, paisalu); Telugu/Devanagari script matches as a substring, since suffixes attach directly
# (ఆసుపత్రికి = to the hospital). Before matching, invisible characters are dropped ('hos\u200bpital').
_RISK_WORDS: dict[str, dict[str, tuple[str, ...]]] = {
    "money": {
        "en": ("money", "cash", "pay", "pays", "paid", "paying", "payment", "payments", "bank", "transfer",
               "transferred", "loan", "loans", "debt", "debts", "owe", "owes", "owed", "rent", "bills", "the bill",
               "invoice", "fee", "fees", "price", "cost", "costs", "refund", "deposit", "savings", "pound", "pounds",
               "quid", "rupee", "rupees", "dollar", "dollars", "euro", "euros", "pence", "upi", "gpay", "paytm",
               "paypal", "venmo", "otp", "cheque", "bitcoin", "crypto", "gift card", "gift cards", "account number",
               "funds", "wire", "wired", "iban", "sort code", "pin number", "password", "passcode", "verification code",
               "security code", "voucher", "vouchers", "western union", "moneygram", "revolut", "monzo", "zelle",
               "phonepe", "lend", "lent", "borrow", "borrowed", "mortgage", "pension", "tax", "hmrc", "insurance"),
        # Welsh: arian (money), punt/punnoedd (pound/s), talu (pay), banc, dyled (debt), rhent, benthyg (loan).
        "cy": ("arian", "punt", "bunt", "phunt", "mhunt", "punnoedd", "bunnoedd", "talu", "dalu", "thalu", "nhalu",
               "banc", "manc", "fanc", "dyled", "ddyled", "nyled", "rhent", "benthyg", "fenthyg", "menthyg"),
        # Hindi: paisa/paise (money), rupaye, udhaar (loan), karz (debt). Telugu: dabbu/dabbulu, paisalu, rupaayalu.
        "roman": ("paisa", "paise", "paisay", "paison", "paisalu", "rupay", "rupai", "rupiya", "udhaar", "udhar",
                  "karz", "dabbu"),
        "script": ("पैसा", "पैसे", "पैसों", "रुपय", "रुपए", "रुपये", "बैंक", "उधार", "कर्ज", "क़र्ज़",
                   "డబ్బు", "పైస", "రూపాయ", "బ్యాంక"),
    },
    "health": {
        "en": ("hospital", "hospitals", "doctor", "doctors", "gp", "nurse", "clinic", "a&e", "ambulance", "sick",
               "unwell", "not well", "pain", "fever", "medicine", "medicines", "medication", "tablets", "pills",
               "prescription", "surgery", "blood", "diagnosis", "cancer", "diabetes", "injury", "injured", "covid",
               "nhs", "pharmacy", "chemist", "dentist", "emergency", "vaccine", "therapy", "x-ray", "stroke",
               "heart attack", "ill", "illness", "hospice", "mri", "a and e"),
        # Welsh: ysbyty (hospital), meddyg (doctor), sâl (ill), moddion/tabledi (medicine), poen (pain).
        "cy": ("ysbyty", "meddyg", "feddyg", "meddygon", "sâl", "salwch", "moddion", "foddion", "tabledi", "dabledi",
               "poen", "boen", "mhoen", "nyrs", "ambiwlans", "fferyllfa", "deintydd", "ddeintydd", "llawdriniaeth"),
        # Hindi: aspatal (hospital), dawai/dawa (medicine), bimar (ill), bukhar (fever), dard (pain), ilaaj
        # (treatment). Telugu: aasupatri (hospital), mandulu (medicines), jvaram (fever), noppi (pain).
        "roman": ("aspatal", "haspatal", "dawai", "dawaai", "davai", "bimar", "beemar", "bukhar", "dard", "ilaj",
                  "ilaaj", "aasupatri", "asupatri", "aspatri", "mandulu", "jvaram", "jwaram", "noppi"),
        "script": ("अस्पताल", "डॉक्टर", "डाक्टर", "दवा", "बीमार", "बुखार", "दर्द", "इलाज",
                   "ఆసుపత్రి", "ఆస్పత్రి", "హాస్పిటల్", "డాక్టర్", "మందు", "జ్వరం", "నొప్పి", "అనారోగ్య"),
    },
    "legal": {
        "en": ("court", "courts", "lawyer", "lawyers", "solicitor", "barrister", "attorney", "legal", "lawsuit",
               "sue", "sued", "suing", "police", "arrest", "arrested", "bail", "tribunal", "divorce", "custody",
               "visa", "immigration", "magistrate", "judge", "deportation", "asylum", "contract", "eviction",
               "evicted"),
        # Welsh: llys (court), cyfreithiwr (solicitor), heddlu (police), ysgariad (divorce), mewnfudo (immigration).
        "cy": ("llys", "lys", "cyfreithiwr", "gyfreithiwr", "nghyfreithiwr", "chyfreithiwr", "cyfreithiol",
               "gyfreithiol", "heddlu", "barnwr", "farnwr", "ynad", "tribiwnlys", "ysgariad", "mewnfudo", "fisa"),
        # Hindi/Telugu: vakil/vakeelu (lawyer), adalat (court). Not romanised 'thana' (police station): in Telugu
        # 'tana/thana' means 'own'.
        "roman": ("vakil", "vakeel", "wakil", "adalat"),
        "script": ("वकील", "अदालत", "कोर्ट", "पुलिस", "थाना", "లాయర్", "వకీల", "కోర్టు", "న్యాయవాది", "పోలీస"),
    },
    "work": {
        "en": ("office", "boss", "manager", "salary", "salaries", "wages", "payroll", "job", "jobs", "colleague",
               "colleagues", "coworker", "interview", "shift", "resign", "resigned", "resignation", "fired",
               "sacked", "redundancy", "redundant", "promotion", "appraisal", "employer", "client", "deadline",
               "at work", "from work", "to work", "my work", "workplace"),
        # Welsh: gwaith (work), swydd/swyddfa (job/office), cyflog (salary), rheolwr (manager), cyfweliad (interview).
        "cy": ("gwaith", "waith", "ngwaith", "swydd", "swyddfa", "cyflog", "gyflog", "nghyflog", "chyflog", "bos",
               "rheolwr", "reolwr", "cyfweliad", "gyfweliad", "cyflogwr", "gyflogwr", "shifft"),
        # Hindi: naukri (job), daftar (office), tankhwah (salary). Telugu: udyogam (job), jeetham (salary).
        "roman": ("naukri", "naukari", "daftar", "tankhwah", "tankha", "udyog", "jeetham", "jeetam"),
        "script": ("नौकरी", "दफ्तर", "दफ़्तर", "ऑफिस", "ऑफ़िस", "बॉस", "तनख्वाह", "तनख़्वाह", "सैलरी",
                   "ఉద్యోగ", "ఆఫీస", "జీతం", "మేనేజర్", "బాస్"),
    },
}


def _risk_regex(words: dict[str, tuple[str, ...]]) -> re.Pattern:
    english = "|".join(re.escape(w).replace(r"\ ", r"\s+") for w in words["en"] + words["cy"])
    roman = "|".join(re.escape(w) for w in words["roman"])
    script = "|".join(re.escape(unicodedata.normalize("NFC", w)) for w in words["script"])
    return re.compile(rf"(?<![\w&])(?:{english})(?![\w&])|\b(?:{roman})\w*|(?:{script})", re.I)


_RISK = {topic: _risk_regex(words) for topic, words in _RISK_WORDS.items()}
_CURRENCY_SIGN = re.compile(r"[£$€₹]")


def risk_topics(text: str) -> list[str]:
    """Which of money / health / legal / work the text touches, in that order - each means 'ask for a tap'."""
    text = _clean(text)
    found = [topic for topic in RISK_TOPICS if _RISK[topic].search(text)]
    if "money" not in found and _CURRENCY_SIGN.search(text):
        found.insert(0, "money")
    return found


# ---------- the check ----------

def check_draft(transcript: str, draft: str) -> dict:
    """Compare a draft with what the person said.

    Returns {"blocked": [{"kind", "value"}], "flags": [{"kind", "value", "in_transcript"}], "risk": [topics],
    "needs_tap": bool}. blocked = contacts in the draft that were never said (the caller must refuse to approve).
    flags = numbers in the draft not said ("number", in_transcript False) and numbers said but dropped from the
    draft ("missing_number", in_transcript True), and capitalised 'Word.Word/path' text that may be a link
    ("possible_link"). needs_tap is True when there is any risk topic or any flag.
    """
    said_text, said, said_masked, _ = _scan(transcript)
    _, drafted, drafted_masked, drafted_spoken = _scan(draft)

    blocked = [{"kind": _KIND_NAME[key], "value": value}
               for key in CONTACT_KINDS for value in drafted[key]
               if not _was_said(key, value, said, said_text, value in drafted_spoken)]

    said_facts, draft_facts = _facts(said_masked), _facts(drafted_masked)
    flags = [{"kind": "number", "value": f.canon, "in_transcript": False}
             for f in draft_facts if not any(_same(f, s) for s in said_facts)]
    flags += [{"kind": "missing_number", "value": s.canon, "in_transcript": True}
              for s in said_facts if not any(_same(s, f) for f in draft_facts)]
    flags += [{"kind": "possible_link", "value": value, "in_transcript": False}  # 'Photos.Family/ravi': check it
              for value in drafted["maybe_urls"] if not _was_said("maybe_urls", value, said, said_text)]

    topics = set(risk_topics(transcript)) | set(risk_topics(draft))
    risk = [topic for topic in RISK_TOPICS if topic in topics]
    return {"blocked": blocked, "flags": flags, "risk": risk, "needs_tap": bool(risk or flags)}
