"""Read a CSV bank statement: date, description, amount (signed; money in is positive).

Lines that start with `#` are comments. A date is ISO (2026-10-09) or UK style (09/10/2026); an
amount may carry a pound sign or thousands commas. A transaction's id is a hash of its row, so it
is the same every time the statement is read.
"""

from __future__ import annotations

import csv
import hashlib
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

COLUMNS = ("date", "description", "amount")
_PENNY = Decimal("0.01")


@dataclass(frozen=True, slots=True)
class Transaction:
    id: str
    day: date
    description: str
    amount: Decimal
    row: int  # its line among the statement's rows, so same-day rows keep their order

    @property
    def amount_gbp(self) -> str:
        """Signed, two decimals: "+23.40" for money in, "-45.00" for money out."""
        return f"{self.amount:+.2f}"


def parse_statement(text: str) -> list[Transaction]:
    """Every transaction in the statement, in the order written."""
    lines = [line for line in text.splitlines() if not line.lstrip().startswith("#")]
    reader = csv.DictReader(lines)
    columns = {name.strip().lower(): name for name in reader.fieldnames or ()}
    missing = [c for c in COLUMNS if c not in columns]
    if missing:
        raise ValueError(
            "a statement needs the columns date, description and amount; "
            f"this one has no {', '.join(missing)}"
        )
    seen: Counter[tuple[date, str, Decimal]] = Counter()
    transactions: list[Transaction] = []
    for row_number, row in enumerate(reader, start=1):
        raw_day = (row.get(columns["date"]) or "").strip()
        if not raw_day:
            continue  # a blank line or a footer
        try:
            day = parse_day(raw_day)
            amount = parse_amount(row.get(columns["amount"]) or "")
        except ValueError as exc:
            raise ValueError(f"row {row_number}: {exc}") from exc
        description = " ".join((row.get(columns["description"]) or "").split())
        key = (day, description, amount)
        transactions.append(
            Transaction(
                id=transaction_id(day, description, amount, seen[key]),
                day=day,
                description=description,
                amount=amount,
                row=row_number,
            )
        )
        seen[key] += 1
    return transactions


def newest_first(
    transactions: Iterable[Transaction], since: date | None = None, limit: int = 50
) -> list[Transaction]:
    """Transactions on or after `since`, newest first (same-day ones latest row first)."""
    kept = (t for t in transactions if since is None or t.day >= since)
    return sorted(kept, key=lambda t: (t.day, t.row), reverse=True)[:limit]


def transaction_id(day: date, description: str, amount: Decimal, repeat: int = 0) -> str:
    """A hash of the row; `repeat` tells apart identical rows (two coffees on one day)."""
    row = f"{day.isoformat()}|{description}|{amount:+.2f}|{repeat}"
    return "tx_" + hashlib.sha256(row.encode()).hexdigest()[:16]


def parse_day(value: str) -> date:
    text = value.strip()
    for read in (date.fromisoformat, lambda v: datetime.fromisoformat(v).date(), _uk_date):
        try:
            return read(text)
        except ValueError:
            continue
    raise ValueError(f"{value!r} is not a date like 2026-10-09 or 09/10/2026")


def parse_amount(value: str) -> Decimal:
    text = value.strip().replace("£", "").replace(",", "").replace(" ", "")
    try:
        amount = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"{value!r} is not an amount like -45.00 or 23.40") from exc
    if not amount.is_finite():
        raise ValueError(f"{value!r} is not an amount like -45.00 or 23.40")
    return amount.quantize(_PENNY, rounding=ROUND_HALF_UP) + 0  # + 0 turns -0.00 into 0.00


def _uk_date(value: str) -> date:
    return datetime.strptime(value, "%d/%m/%Y").date()
