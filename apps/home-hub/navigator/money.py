"""Money amounts from a person's literal words. Deterministic on purpose: no model ever supplies a number.

    >>> parse("send fifty pounds to my son")[0].value
    Decimal('50.00')
    >>> parse("pay two hundred and twelve pounds fifty to the landlord")[0]
    Amount(value=Decimal('212.50'), currency='GBP', text='212 pounds 50', words=True)

Understands £/$/€/₹/₦ symbols, currency words (pounds, quid, rupees, shillings, ...), pence, number words
("two hundred and fifty"), and bare numbers right after send/pay/transfer. Phone and account numbers (7+
digits) are never amounts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import List, Optional

CURRENCY_WORDS = {
    "£": "GBP", "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "quid": "GBP", "sterling": "GBP",
    "₹": "INR", "rs": "INR", "rs.": "INR", "inr": "INR", "rupee": "INR", "rupees": "INR",
    "$": "USD", "usd": "USD", "dollar": "USD", "dollars": "USD", "bucks": "USD",
    "€": "EUR", "eur": "EUR", "euro": "EUR", "euros": "EUR",
    "ksh": "KES", "kes": "KES", "shilling": "KES", "shillings": "KES",
    "₦": "NGN", "naira": "NGN", "ngn": "NGN", "cedi": "GHS", "cedis": "GHS", "ghs": "GHS",
    "rand": "ZAR", "zar": "ZAR", "taka": "BDT", "tk": "BDT",
}
SYMBOLS = {"GBP": "£", "USD": "$", "EUR": "€", "INR": "₹", "NGN": "₦", "KES": "KSh ", "GHS": "GH₵", "ZAR": "R", "BDT": "৳"}
UNITS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
         "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
         "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90}
SCALES = {"hundred": 100, "thousand": 1000, "k": 1000, "grand": 1000, "lakh": 100000, "lakhs": 100000,
          "million": 1000000, "crore": 10000000}

_PENCE_TAIL = r"(?:\s?(?:and\s)?(?P<{p}>\d{{1,2}})\s?(?:p|pence)\b|\s(?P<{q}>[1-9]\d?)\b(?!\s*(?:times|percent|%|days?|hours?|minutes?|people|payments?|digits?|pounds?|quid)))?"
_CUR_WORDS = r"pounds?|quid|gbp|sterling|rupees?|rs\.?|inr|dollars?|bucks|usd|euros?|eur|shillings?|ksh|kes|naira|ngn|cedis?|ghs|rand|zar|taka|tk"
_AMOUNT = re.compile(r"""
    (?P<sym>[£$€₹₦])\s?(?P<n1>\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(?P<d1>\d{1,2}))?""" + _PENCE_TAIL.format(p="p1", q="q1") + r"""
  | \b(?P<n2>\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(?P<d2>\d{1,2}))?\s?(?P<word>""" + _CUR_WORDS + r""")\b""" + _PENCE_TAIL.format(p="p2", q="q2") + r"""
  | \b(?P<word0>ksh|kes|rs\.?|inr|gbp|usd|eur|ngn|ghs|zar|tk)\s?(?P<n0>\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(?P<d0>\d{1,2}))?\b
  | \b(?P<n3>\d{1,2})\s?(?:p|pence)\b
""", re.X | re.I)
# A bare number is an amount only right after a money verb ("send 50 to Tom", "pay him 20").
_BARE = re.compile(r"\b(?:send|sends|pay|pays|transfer|give|wire|top\s?up)\s+(?:him|her|them|my\s+\w+|the\s+\w+)?\s*"
                   r"(?P<n>\d{1,3}(?:,\d{3})*|\d{1,6})(?:\.(?P<d>\d{1,2}))?\b(?!\s*(?:digits?|accounts?|sort|%|percent|times|minutes?|hours?|days?))", re.I)
_AND_TO = re.compile(r"\band\s+(?P<n>\d{1,3}(?:,\d{3})*|\d{1,6})(?:\.(?P<d>\d{1,2}))?\s+(?:to|for)\b", re.I)
_LONG_DIGITS = re.compile(r"\d[\d\s-]{6,}\d")  # phone / account numbers: never amounts


@dataclass(frozen=True)
class Amount:
    value: Decimal
    currency: Optional[str]  # ISO code, or None when the person gave a bare number
    text: str                # the words it came from, digitised
    words: bool = False      # True when number words were used ("fifty")

    def spoken(self) -> str:
        """For reading back: '50 pounds' / '12 pounds 50' / '50'."""
        whole, pence = divmod(int(self.value * 100), 100)
        unit = {"GBP": "pound", "USD": "dollar", "EUR": "euro", "INR": "rupee", "KES": "shilling",
                "NGN": "naira", "GHS": "cedi", "ZAR": "rand", "BDT": "taka"}.get(self.currency or "", "")
        if unit:
            unit = unit if whole == 1 else unit + "s"
            return f"{whole} {unit}" + (f" {pence:02d}" if pence else "")
        return f"{whole}" + (f" point {pence:02d}" if pence else "")

    def display(self, default_currency: str = "GBP") -> str:
        """For showing: '£50.00' / '₹500.00'."""
        cur = self.currency or default_currency
        return f"{SYMBOLS.get(cur, cur + ' ')}{self.value:,.2f}"


def words_to_digits(text: str) -> str:
    """Replace spans of English number words with digits: 'two hundred and fifty quid' -> '250 quid'."""
    text = re.sub(r"\b(\d+(?:\.\d+)?)\s?k\b(?=\s|$|[,.])", lambda m: str(int(float(m.group(1)) * 1000)), text or "", flags=re.I)
    tokens = re.split(r"(\s+|-)", text)
    out, i = [], 0
    while i < len(tokens):
        tok = tokens[i]
        low = tok.lower().strip(".,!?")
        if low in UNITS or low in TENS or (low in ("a", "an") and _next_word(tokens, i) in SCALES):
            total, current, j, consumed_any = 0, 0, i, False
            while j < len(tokens):
                w = tokens[j].lower().strip(".,!?")
                if tokens[j].strip() == "" or tokens[j] == "-":
                    j += 1
                    continue
                if w in UNITS:
                    current += UNITS[w]
                elif w in TENS:
                    current += TENS[w]
                elif w in ("a", "an") and _next_word(tokens, j) in SCALES and current == 0:
                    current = 1
                elif w in SCALES:
                    scale = SCALES[w]
                    if scale == 100:
                        current = (current or 1) * 100
                    else:
                        total += (current or 1) * scale
                        current = 0
                elif w == "and" and (current >= 100 or total) and _next_word(tokens, j) in set(UNITS) | set(TENS):
                    pass
                else:
                    break
                consumed_any = True
                j += 1
            if consumed_any:
                # keep the whitespace that followed the last consumed token
                end = j
                while end > i and tokens[end - 1].strip() == "":
                    end -= 1
                out.append(str(total + current))
                i = end
                continue
        out.append(tok)
        i += 1
    return "".join(out)


def _next_word(tokens: List[str], i: int) -> str:
    for t in tokens[i + 1:]:
        if t.strip() and t != "-":
            return t.lower().strip(".,!?")
    return ""


def _dec(whole: str, frac: Optional[str], pence: Optional[str]) -> Optional[Decimal]:
    try:
        v = Decimal(whole.replace(",", ""))
        if frac:
            v += Decimal("0." + frac.ljust(2, "0"))
        if pence:
            v += Decimal(pence) / 100
        return v.quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def parse(text: str) -> List[Amount]:
    """Every distinct amount in the text, in order. Distinct = different (value, currency)."""
    digitised = words_to_digits(text or "")
    masked = _LONG_DIGITS.sub(lambda m: " " * len(m.group(0)), digitised)  # phone/account numbers vanish
    found: List[Amount] = []
    spans = []
    for m in _AMOUNT.finditer(masked):
        if m.group("sym"):
            value = _dec(m.group("n1"), m.group("d1"), m.group("p1") or m.group("q1"))
            cur = CURRENCY_WORDS[m.group("sym")]
        elif m.group("word"):
            value = _dec(m.group("n2"), m.group("d2"), m.group("p2") or m.group("q2"))
            cur = CURRENCY_WORDS[m.group("word").lower()]
        elif m.group("word0"):
            value = _dec(m.group("n0"), m.group("d0"), None)
            cur = CURRENCY_WORDS[m.group("word0").lower()]
        else:
            value = _dec("0", None, m.group("n3"))
            cur = "GBP"
        if value is None:
            continue
        spans.append(m.span())
        found.append(Amount(value, cur, masked[m.start():m.end()].strip(), words=digitised != text))
    for m in list(_BARE.finditer(masked)) + list(_AND_TO.finditer(masked)):
        if any(s <= m.start("n") < e for s, e in spans):
            continue
        value = _dec(m.group("n"), m.group("d"), None)
        if value is not None and value > 0:
            found.append(Amount(value, None, m.group("n") + (("." + m.group("d")) if m.group("d") else ""),
                                words=digitised != text))
    seen, out = set(), []
    for a in found:
        key = (a.value, a.currency)
        if key not in seen:
            seen.add(key)
            out.append(a)
    # "£50" and a bare "50" in the same sentence are the same amount
    if len(out) > 1:
        with_cur = [a for a in out if a.currency]
        bare = [a for a in out if not a.currency]
        out = with_cur + [b for b in bare if all(b.value != a.value for a in with_cur)]
    return out
