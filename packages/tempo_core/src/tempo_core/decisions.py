"""Letter Explainer and Decision Challenger for PIP decisions (build plan S7.2).

The explanation and the reconsideration letter use only what the decision letter says and what
the person told Tempo. The draft is built from a template, never invented: `unsupported_claims`
lists any number, date or name in a draft that the evidence doesn't contain, so a model asked
to polish the letter can't slip in a "fact".
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date

from tempo_core.deadlines import ReconsiderationDeadline
from tempo_core.models import Fact

READ_BACK_BELOW = 0.8

# Points needed for each PIP component (Social Security (PIP) Regulations 2013, reg. 5 and 6).
STANDARD, ENHANCED = 8, 12


@dataclass(frozen=True)
class PipDecision:
    decision_date: str  # as printed, e.g. "14 October 2026"
    daily_living_points: int
    mobility_points: int
    reference: str | None = None


@dataclass(frozen=True)
class Evidence:
    activity: str  # "Preparing food"
    what_happens: str  # the person's own words
    source: str = "what I told Tempo"


def decision_from_facts(facts: Iterable[Fact]) -> tuple[PipDecision | None, list[str]]:
    """A decision from what was read off the letter, or the fields to read back first."""
    found = {f.key: f for f in facts}
    needed = ("decision_date", "daily_living_points", "mobility_points")
    unsure = [k for k in needed if k not in found or found[k].confidence < READ_BACK_BELOW]
    if unsure:
        return None, unsure
    ref = found.get("reference")
    decided = date.fromisoformat(str(found["decision_date"].value))
    return PipDecision(
        decision_date=f"{decided:%-d %B %Y}",
        daily_living_points=int(str(found["daily_living_points"].value)),
        mobility_points=int(str(found["mobility_points"].value)),
        reference=str(ref.value) if ref is not None else None,
    ), []


def rate(points: int) -> str:
    if points >= ENHANCED:
        return "the enhanced rate"
    return "the standard rate" if points >= STANDARD else "no award"


def explain(decision: PipDecision, deadline: ReconsiderationDeadline) -> str:
    daily, mobility = decision.daily_living_points, decision.mobility_points
    return (
        f"DWP gave you {daily} points for daily living ({rate(daily)}) and {mobility} points for "
        f"getting around ({rate(mobility)}). You need {STANDARD} points for the standard rate "
        f"and {ENHANCED} for the enhanced rate. If you think this is wrong, you can ask them to "
        f"look again. This is called a mandatory reconsideration. They must get it by "
        f"{deadline.deadline:%-d %B %Y}, so post it by {deadline.post_by:%-d %B %Y}."
    )


def draft_reconsideration(decision: PipDecision, evidence: list[Evidence]) -> str:
    ref = f" (reference {decision.reference})" if decision.reference else ""
    points = "\n".join(f"- {e.activity}: {e.what_happens}" for e in evidence)
    return (
        "[Your name]\n[Your address]\n[Your National Insurance number]\n\n"
        f"Dear DWP,\n\nI am asking for a mandatory reconsideration of my PIP decision dated "
        f"{decision.decision_date}{ref}.\n\nI disagree with how my needs were assessed. "
        f"This is what happens day to day:\n\n{points}\n\n"
        "Please look at the decision again and send me your reasons in writing.\n\n"
        "Yours faithfully,\n[Your name]\n"
    )


MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
FACTLIKE = re.compile(  # dates first, so "3 March" is one claim, not a number
    rf"\b\d{{1,2}} (?:{MONTHS})(?: \d{{4}})?\b|£?\d[\d,.:]*|\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b"
)
PLACEHOLDER = re.compile(r"\[[^\]]*\]")  # "[Your name]": for the person to fill in
TEMPLATE_WORDS = frozenset({"Dear DWP", "Yours", "Please", "This"})


def unsupported_claims(draft: str, decision: PipDecision, evidence: list[Evidence]) -> list[str]:
    """Numbers, dates and names in the draft that neither the letter nor the person gave."""
    allowed = " ".join(
        [decision.decision_date, decision.reference or "", str(decision.daily_living_points),
         str(decision.mobility_points)] + [f"{e.activity} {e.what_happens}" for e in evidence]
    )  # fmt: skip
    given = set(_claims(allowed)) | {decision.reference or ""}
    return [
        f
        for f in _claims(PLACEHOLDER.sub("", draft))
        if f not in given and not any(f.startswith(w) for w in TEMPLATE_WORDS)
    ]


def _claims(text: str) -> list[str]:
    """Whole fact-like tokens, so "5" isn't "supported" by appearing inside "PIP-55021"."""
    return [c for m in FACTLIKE.finditer(text) if (c := m.group(0).rstrip(".,:"))]
