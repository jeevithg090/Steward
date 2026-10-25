"""The person's payee and biller book: who "my son" is, exactly as the bank spells them, and the limits.

Lives in tempo-hub/data/payees.json (mode 600, this computer only). Nothing is ever added to it by voice or by a
model: a new payee is set up deliberately (navigator setup), then waits out a cooling-off period.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "payees.json"
_TITLES = re.compile(r"\b(mr|mrs|ms|miss|dr|prof|sir|dame|shri|smt)\b\.?", re.I)
_LEADING = re.compile(r"^(?:my|the|our|to)\s+", re.I)


def normalise(s: str) -> str:
    """lower-case, no accents, no titles/punctuation, single spaces: 'Mr. Arjun  GADDAM' -> 'arjun gaddam'."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = _TITLES.sub(" ", s.lower())
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return " ".join(s.split())


def similarity(a: str, b: str) -> float:
    """0..1: the best of character similarity and word-set similarity ('gaddam arjun' = 'Arjun Gaddam')."""
    a, b = normalise(a), normalise(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    chars = SequenceMatcher(None, a, b).ratio()
    wa, wb = set(a.split()), set(b.split())
    words = len(wa & wb) / len(wa | wb)
    return max(chars, words if wa == wb else min(words, 0.9))


@dataclass
class Limits:
    currency: str = "GBP"
    per_transaction: Decimal = Decimal("500")
    daily: Decimal = Decimal("1000")
    new_payee_cooling_hours: int = 24
    duplicate_window_minutes: int = 10
    unusual_multiplier: int = 3
    approval_ttl_seconds: int = 90
    hold_seconds: int = 0  # an "undo window" after approval before Confirm is pressed (0 for the demo)

    @classmethod
    def from_dict(cls, d: dict) -> "Limits":
        out = cls()
        for k, v in (d or {}).items():
            if hasattr(out, k):
                cur = getattr(out, k)
                setattr(out, k, Decimal(str(v)) if isinstance(cur, Decimal) else type(cur)(v))
        return out

    def to_dict(self) -> dict:
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in asdict(self).items()}


@dataclass
class Payee:
    id: str
    display_name: str                    # how the person knows them: "Arjun Gaddam"
    aliases: List[str] = field(default_factory=list)  # "my son", "arjun"
    kind: str = "person"                 # person | biller
    bank_name: str = ""                  # the name the bank shows on the review screen (Confirmation of Payee)
    account_last4: str = ""
    sort_code: str = ""
    phone: str = ""                      # mobile money number
    reference: str = ""                  # billers: the customer/account reference
    app: str = "oxbank"                  # which bank skill pays them
    currency: str = "GBP"
    usual_amount: Optional[Decimal] = None
    max_amount: Optional[Decimal] = None
    added_at: Optional[str] = None       # ISO time; the cooling-off period runs from here
    trusted: bool = True
    due_day: Optional[int] = None        # billers: day of month the bill is due

    @classmethod
    def from_dict(cls, d: dict) -> "Payee":
        d = dict(d)
        for k in ("usual_amount", "max_amount"):
            if d.get(k) is not None:
                d[k] = Decimal(str(d[k]))
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("usual_amount", "max_amount"):
            if d[k] is not None:
                d[k] = str(d[k])
        return d

    def names(self) -> List[str]:
        return [self.display_name] + list(self.aliases) + ([self.bank_name] if self.bank_name else [])

    def cooling_until(self, hours: int) -> Optional[datetime]:
        if not self.added_at:
            return None
        try:
            t = datetime.fromisoformat(self.added_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t + timedelta(hours=hours)

    def describe(self) -> str:
        """For reading back: 'Arjun Gaddam, account ending 4821' / 'Octopus Energy, reference A-7731-22'."""
        bits = [self.display_name]
        if self.kind == "biller" and self.reference:
            bits.append(f"reference {self.reference}")
        elif self.account_last4:
            bits.append(f"account ending {self.account_last4}")
        elif self.phone:
            bits.append(f"number ending {self.phone[-4:]}")
        return ", ".join(bits)


@dataclass
class Resolution:
    status: str                      # match | ambiguous | unknown
    payee: Optional[Payee] = None
    candidates: List[Payee] = field(default_factory=list)
    how: str = ""                    # alias | name | fuzzy
    score: float = 0.0


class Book:
    def __init__(self, payees: Optional[List[Payee]] = None, limits: Optional[Limits] = None, path: Optional[Path] = None):
        self.payees: List[Payee] = payees or []
        self.limits: Limits = limits or Limits()
        self.path = path

    # ---- persistence ----
    @classmethod
    def load(cls, path: Optional[Path] = None, create_demo: bool = False) -> "Book":
        path = Path(path or DEFAULT_PATH)
        if not path.exists():
            book = demo_book() if create_demo else cls()
            book.path = path
            if create_demo:
                book.save()
            return book
        data = json.loads(path.read_text())
        return cls([Payee.from_dict(p) for p in data.get("payees", [])], Limits.from_dict(data.get("limits", {})), path)

    def save(self, path: Optional[Path] = None) -> Path:
        path = Path(path or self.path or DEFAULT_PATH)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"payees": [p.to_dict() for p in self.payees], "limits": self.limits.to_dict()}, indent=2))
        os.chmod(tmp, 0o600)
        tmp.replace(path)
        self.path = path
        return path

    # ---- lookup ----
    def get(self, payee_id: str) -> Optional[Payee]:
        return next((p for p in self.payees if p.id == payee_id), None)

    def billers(self) -> List[Payee]:
        return [p for p in self.payees if p.kind == "biller"]

    def resolve(self, phrase: str, kind: Optional[str] = None) -> Resolution:
        """Who the person means. Exact alias first, then whole-name words, then a careful fuzzy match.
        Two different payees at the same level -> ambiguous (ask), nothing -> unknown (never guess)."""
        q = normalise(phrase)
        q_short = _LEADING.sub("", q).strip()
        q_short = re.sub(r"\b(s|bill|account|payment)\b", " ", q_short).strip()
        q_short = " ".join(q_short.split())
        pool = [p for p in self.payees if kind is None or p.kind == kind]
        if not q_short:
            return Resolution("unknown")
        tiers = [
            ("alias", lambda p: any(normalise(a) in (q, q_short) for a in p.aliases) or normalise(p.display_name) in (q, q_short)),
            ("name", lambda p: (set(q_short.split()) <= set(normalise(p.display_name).split()))
                               or any(set(q_short.split()) <= set(normalise(a).split()) for a in p.aliases)),
        ]
        for how, test in tiers:
            hits = [p for p in pool if test(p)]
            if len({p.id for p in hits}) == 1:
                return Resolution("match", hits[0], hits, how, 1.0)
            if len(hits) > 1:
                return Resolution("ambiguous", None, hits, how, 1.0)
        scored = []
        for p in pool:
            best = max(similarity(q_short, n) for n in p.names())
            if best >= 0.85:
                scored.append((best, p))
        scored.sort(key=lambda t: -t[0])
        if not scored:
            return Resolution("unknown", candidates=[])
        if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.05:
            return Resolution("ambiguous", None, [p for _, p in scored[:3]], "fuzzy", scored[0][0])
        return Resolution("match", scored[0][1], [scored[0][1]], "fuzzy", scored[0][0])

    def add(self, payee: Payee, now: Optional[datetime] = None) -> Payee:
        if self.get(payee.id):
            raise ValueError(f"payee {payee.id} exists")
        payee.added_at = payee.added_at or (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
        self.payees.append(payee)
        return payee


def demo_book(now: Optional[datetime] = None) -> Book:
    """The book used by the OxBank demo. 'Tom Baker' was added an hour ago, so he is still cooling off."""
    now = now or datetime.now(timezone.utc)
    long_ago = (now - timedelta(days=200)).isoformat(timespec="seconds")
    recent = (now - timedelta(hours=1)).isoformat(timespec="seconds")
    payees = [
        Payee("son", "Arjun Gaddam", ["my son", "arjun", "son"], "person", "ARJUN GADDAM", "4821", "04-00-04",
              phone="07700900821", usual_amount=Decimal("200"), max_amount=Decimal("500"), added_at=long_ago),
        Payee("daughter", "Priya Gaddam", ["my daughter", "priya", "daughter"], "person", "PRIYA GADDAM", "0193", "20-00-00",
              phone="07700900193", usual_amount=Decimal("100"), max_amount=Decimal("500"), added_at=long_ago),
        Payee("landlord", "Oxford Lettings Ltd", ["my landlord", "landlord", "the rent", "rent"], "person", "OXFORD LETTINGS LTD",
              "7710", "40-00-00", reference="FLAT 4B", usual_amount=Decimal("950"), max_amount=Decimal("1000"), added_at=long_ago),
        Payee("tom", "Tom Baker", ["tom", "tom baker"], "person", "T BAKER", "3344", "60-83-71", usual_amount=None,
              max_amount=Decimal("200"), added_at=recent),
        Payee("electricity", "Octopus Energy", ["electricity", "the electricity", "electric", "octopus", "energy", "power"],
              "biller", "OCTOPUS ENERGY LTD", "9001", "", reference="A-7731-22", usual_amount=Decimal("86.40"),
              max_amount=Decimal("300"), added_at=long_ago, due_day=28),
        Payee("water", "Thames Water", ["water", "the water", "thames water"], "biller", "THAMES WATER UTILITIES",
              "5520", "", reference="TW-00419-8", usual_amount=Decimal("31.00"), max_amount=Decimal("150"), added_at=long_ago, due_day=1),
        Payee("council", "Oxford City Council", ["council tax", "the council", "council"], "biller", "OXFORD CITY COUNCIL",
              "1180", "", reference="CT 55012290", usual_amount=Decimal("164.00"), max_amount=Decimal("400"), added_at=long_ago, due_day=1),
        Payee("mobile", "giffgaff", ["mobile", "my phone bill", "phone bill", "giffgaff", "sim"], "biller", "GIFFGAFF LTD",
              "2210", "", reference="GG 7700900123", usual_amount=Decimal("10.00"), max_amount=Decimal("50"), added_at=long_ago, due_day=15),
    ]
    limits = Limits(currency="GBP", per_transaction=Decimal("1000"), daily=Decimal("1500"), new_payee_cooling_hours=24,
                    duplicate_window_minutes=10, unusual_multiplier=3, approval_ttl_seconds=90, hold_seconds=0)
    return Book(payees, limits)
