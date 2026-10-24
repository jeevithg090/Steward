"""Entitlement Check (build plan S7.1): ten questions, then which help is worth claiming.

This is SCREENING, NOT A DECISION: only DWP (or a broadband provider) can decide, and every
answer says so and links to the official checker. Amounts come from
skills/entitlement-check/figures.yaml, which is uprated each April.
"""

from __future__ import annotations

import math
from decimal import Decimal
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

DISCLAIMER = (
    "This is a quick check, not a decision. Only DWP, or your phone and broadband company, can "
    "decide. Use the links to check properly, or ask Age UK or Citizens Advice to help you claim."
)
QUESTIONS: tuple[tuple[str, str], ...] = (
    ("age", "How old are you?"),
    ("couple", "Do you live with a partner?"),
    ("weekly_income_gbp", "Roughly how much comes in each week, from pensions and earnings?"),
    ("savings_gbp", "Roughly how much do you have in savings?"),
    ("benefits", "Do you get any benefits now? For example Universal Credit or PIP."),
    ("needs_care_day", "Do you need help in the day with washing, dressing, eating or the toilet?"),
    ("needs_care_night", "Do you need help at night?"),
    ("care_months", "How many months have you needed that help?"),
    ("terminally_ill", "Has a doctor said you may have less than 12 months to live?"),
    ("has_broadband_or_phone", "Do you pay for broadband or a phone line?"),
)

Likelihood = Literal["likely", "worth_checking", "unlikely"]


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class PensionCredit(_Frozen):
    guarantee_single_weekly_gbp: Decimal
    guarantee_couple_weekly_gbp: Decimal
    savings_disregard_gbp: Decimal
    tariff_per_500_gbp: Decimal
    worth_checking_margin_gbp: Decimal
    signpost: str


class AttendanceAllowance(_Frozen):
    lower_weekly_gbp: Decimal
    higher_weekly_gbp: Decimal
    qualifying_months: int
    signpost: str


class SocialTariff(_Frozen):
    qualifying_benefits: frozenset[str]
    signpost: str


class Figures(_Frozen):
    tax_year: str
    demo_values: bool
    state_pension_age: int
    pension_credit: PensionCredit
    attendance_allowance: AttendanceAllowance
    social_tariff: SocialTariff

    @classmethod
    def from_file(cls, path: Path) -> Figures:
        return cls.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


class Answers(_Frozen):
    age: int = Field(ge=16, le=120)
    couple: bool = False
    weekly_income_gbp: Decimal = Field(ge=0)
    savings_gbp: Decimal = Field(default=Decimal(0), ge=0)
    benefits: frozenset[str] = frozenset()
    needs_care_day: bool = False
    needs_care_night: bool = False
    care_months: int = Field(default=0, ge=0)
    terminally_ill: bool = False
    has_broadband_or_phone: bool = True


class Flag(_Frozen):
    benefit: str
    likelihood: Likelihood
    why: str
    weekly_gbp: Decimal | None = None
    signpost: str


PC, AA, ST = "Pension Credit", "Attendance Allowance", "Cheaper broadband or phone (social tariff)"


def _flag(
    benefit: str, likelihood: Likelihood, why: str, signpost: str, weekly: Decimal | None = None
) -> Flag:
    return Flag(
        benefit=benefit, likelihood=likelihood, why=why, signpost=signpost, weekly_gbp=weekly
    )


def tariff_income(savings: Decimal, pc: PensionCredit) -> Decimal:
    above = savings - pc.savings_disregard_gbp
    return Decimal(math.ceil(above / 500)) * pc.tariff_per_500_gbp if above > 0 else Decimal(0)


def pension_credit(a: Answers, f: Figures) -> Flag:
    pc = f.pension_credit
    if a.age < f.state_pension_age:
        why = f"Pension Credit starts at State Pension age ({f.state_pension_age})."
        return _flag(PC, "unlikely", why, pc.signpost)
    line = pc.guarantee_couple_weekly_gbp if a.couple else pc.guarantee_single_weekly_gbp
    counted = a.weekly_income_gbp + tariff_income(a.savings_gbp, pc)
    if counted < line:
        why = f"Your income counts as about £{counted:.2f} a week. It tops up to £{line:.2f}."
        return _flag(PC, "likely", why, pc.signpost, line - counted)
    if counted < line + pc.worth_checking_margin_gbp:
        why = "You're just over the line, and rent, a disability or caring can raise it."
        return _flag(PC, "worth_checking", why, pc.signpost)
    why = f"Your income counts as about £{counted:.2f} a week, over the £{line:.2f} line."
    return _flag(PC, "unlikely", why, pc.signpost)


def attendance_allowance(a: Answers, f: Figures) -> Flag:
    aa = f.attendance_allowance
    if a.age < f.state_pension_age:
        why = "Attendance Allowance is for State Pension age. PIP is the one to look at."
        return _flag(AA, "unlikely", why, aa.signpost)
    if a.terminally_ill:
        return _flag(AA, "likely", "You can get the higher rate straight away.", aa.signpost,
                     aa.higher_weekly_gbp)  # fmt: skip
    if not (a.needs_care_day or a.needs_care_night):
        return _flag(
            AA, "unlikely", "It's for people who need help with care, day or night.", aa.signpost
        )
    if a.care_months < aa.qualifying_months:
        why = f"You can claim once you've needed help for {aa.qualifying_months} months."
        return _flag(AA, "worth_checking", why, aa.signpost)
    both = a.needs_care_day and a.needs_care_night
    when = "day and night" if both else "in the day or at night"
    weekly = aa.higher_weekly_gbp if both else aa.lower_weekly_gbp
    return _flag(AA, "likely", f"You need help {when}. It isn't means-tested.", aa.signpost, weekly)


def social_tariff(a: Answers, f: Figures, pension_credit_flag: Flag) -> Flag | None:
    st = f.social_tariff
    if not a.has_broadband_or_phone:
        return None
    if a.benefits & st.qualifying_benefits:
        return _flag(ST, "likely", "You get a benefit that most providers accept.", st.signpost)
    if pension_credit_flag.likelihood != "unlikely":
        return _flag(
            ST, "worth_checking", "Once you get Pension Credit, you can ask for one.", st.signpost
        )
    return _flag(
        ST,
        "unlikely",
        "You need to be on a benefit first, such as Universal Credit or PIP.",
        st.signpost,
    )


def screen(answers: Answers, figures: Figures) -> list[Flag]:
    pc = pension_credit(answers, figures)
    flags = [pc, attendance_allowance(answers, figures), social_tariff(answers, figures, pc)]
    return [flag for flag in flags if flag is not None]


def pack(answers: Answers, flags: list[Flag], figures: Figures) -> str:
    """The pre-filled summary to take to an adviser or keep beside the phone when claiming."""
    lines = [
        f"Tempo entitlement check ({figures.tax_year} figures)",
        "",
        DISCLAIMER,
        "",
        "Your answers:",
    ]
    lines += [f"- {text} {_answer(getattr(answers, key))}" for key, text in QUESTIONS]
    lines += ["", "Worth claiming:"]
    for flag in flags:
        amount = f" (about £{flag.weekly_gbp:.2f} a week)" if flag.weekly_gbp is not None else ""
        likelihood = flag.likelihood.replace("_", " ")
        lines.append(f"- {flag.benefit}: {likelihood}{amount}. {flag.why} {flag.signpost}")
    if figures.demo_values:
        lines += ["", "Note: these amounts haven't been checked against this year's rates yet."]
    return "\n".join(lines) + "\n"


def _answer(value: object) -> str:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, frozenset):
        return ", ".join(sorted(v.replace("_", " ") for v in value)) or "None"
    return str(value)
