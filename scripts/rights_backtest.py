"""Fit Rights Decay's hazard curves from real resolution times, score them on months they never
saw, and backtest the planner against simple rules (build plan R3).

    make rights-backtest      # needs .data/ (research_notes/feature-hunt/14-predictions.md §0)

Writes:
- skills/rights-decay/hazards/nyc311.hpd.*.yaml: closure curves fitted on all of 2025
- skills/rights-decay/hazards/uk.fca.*.yaml: coarse UK curves per bank (FCA H1 2026, openpyxl)
- docs/rights_calibration.md and .png: fitted on Jan-Jun 2025, scored on Jul-Dec 2025
- docs/rights_backtest.md: five policies on the held-out half, under stated assumptions
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # rights_data sits next to this script

from rights_data import (
    SOURCE,
    Case,
    Curve,
    Fitted,
    at,
    draw,
    fca,
    fit,
    hazard,
    read_cases,
    slug,
    write_hazard,
)

from tempo_core.arbiter import ActionOption
from tempo_core.delay_model import Bin, brier, reliability
from tempo_core.rights_decay import Right, plan

ROOT = Path(__file__).resolve().parents[1]
SPLIT_DAY = date(2025, 7, 1)
MIN_KIND_N = 2000
# Backtest assumptions, all stated in the report.
OWED, P_CALL, COMPUTE = 32.31, 0.85, 0.20  # Ofcom's missed-appointment rate; a call by Tempo
CLIFF_DAY, REMIND_DAY, HORIZON = 60, 14, 180
TIME_VALUE, ATTENTION = 18.0, 2.0  # £ an hour; minutes a week an open problem costs you
POLICIES = (
    "Never chase",
    "Act at once",
    "Remind at 14 days",
    "Act on the last day",
    "Rights Decay",
)


def auc(scores: Sequence[float], outcomes: Sequence[bool]) -> float:
    """The chance a closed case scores higher than an open one (ties count half)."""
    ranked = sorted(zip(scores, outcomes, strict=True))
    pos = sum(outcomes)
    neg = len(outcomes) - pos
    if not pos or not neg:
        return float("nan")
    rank_sum, i = 0.0, 0
    while i < len(ranked):
        j = i
        while j < len(ranked) and ranked[j][0] == ranked[i][0]:
            j += 1
        rank_sum += (i + j + 1) / 2 * sum(o for _, o in ranked[i:j])
        i = j
    return (rank_sum - pos * (pos + 1) / 2) / (pos * neg)


def _between(curve: Curve, age: float) -> float:
    left = 1 - at(curve, age)
    return (at(curve, age + 14) - at(curve, age)) / left if left > 0 else 0.0


def _row(name: str, p: list[float], base: list[float], y: list[bool]) -> str:
    ours, theirs = brier(p, y), brier(base, y)
    skill = (1 - ours / theirs) * 100 if theirs else float("nan")
    seen, said = sum(y) / len(y), sum(p) / len(p)
    cells = f"{len(y):,} | {seen:.3f} | {said:.3f} | {ours:.4f} | {theirs:.4f} | {skill:+.1f}%"
    return f"| {name} | {cells} | {auc(p, y):.3f} |"


def score(model: Fitted, test: Sequence[Case]) -> tuple[list[str], dict[str, list[Bin]]]:
    """Out-of-sample Brier, skill against one all-requests curve, AUC, and reliability bins."""
    rows, bins = [], {}
    for h in (14, 30, 60):
        y = [c.closed and c.days <= h for c in test]
        p = [at(model.curve(c), h) for c in test]
        rows.append(_row(f"closed within {h} days", p, [at(model.all, h)] * len(y), y))
        bins[f"within {h} days"] = reliability(p, y, bins=10)
    for a in (14, 30):
        still = [c for c in test if c.days > a]
        y = [c.closed and c.days <= a + 14 for c in still]
        p = [_between(model.curve(c), a) for c in still]
        base = [_between(model.all, a)] * len(still)
        rows.append(_row(f"open at day {a}: closed in the next 14 days", p, base, y))
    return rows, bins


def planner_policy(curve: Curve, n: int, share: float) -> tuple[int, str]:
    """What the planner does with a fresh case of this kind: (day, "act" or "stop")."""
    start = date(2025, 1, 1)
    call = ActionOption(
        id="call", label="I call for you", p_success=Decimal(str(P_CALL)),
        amount_gbp=Decimal(str(OWED)), user_minutes=Decimal(0), compute_gbp=Decimal(str(COMPUTE)),
    )  # fmt: skip
    right = Right(
        id="complain", label="Complain", ways=(call,), expires_on=start + timedelta(CLIFF_DAY)
    )
    p = plan(
        [right], hazard=hazard(curve, id="k", n=n, share=share), started_on=start, today=start,
        time_value_gbp_h=Decimal(str(TIME_VALUE)), resolved_value_gbp=Decimal(str(OWED)),
        attention_minutes_per_week=Decimal(str(ATTENTION)), horizon_days=HORIZON,
    )  # fmt: skip
    first = next((d for d in p.days if d.best != "wait"), None)
    if first is None:
        return HORIZON, "stop"
    return (first.day - start).days, "act" if first.best == "complain" else "stop"


def simulate(c: Case, day: int, action: str, share: float) -> tuple[float, float, float, float]:
    """Expected (paid without a fight, calls, £ back, minutes of attention) for one case.

    A closure pays with probability `share`; one that doesn't leaves the problem open, so a
    policy that acts still acts on its day. Stopping means no more calls and no more attention.
    """
    per_day = ATTENTION / 7
    if c.closed and c.days <= day:
        minutes = per_day * (share * c.days + (1 - share) * day)
        if action == "act":
            calls = 1 - share
            return share, calls, share * OWED + calls * P_CALL * OWED, minutes
        return share, 0.0, share * OWED, minutes
    if action == "act":
        return 0.0, 1.0, P_CALL * OWED, per_day * day
    later = share if c.closed and c.days <= HORIZON else 0.0
    return later, 0.0, later * OWED, per_day * day


def backtest(model: Fitted, test: Sequence[Case], share: float) -> dict[str, list[float]]:
    """Per 1,000 held-out cases: paid without a fight, calls, £ back, hours, net £."""
    kinds = {k: planner_policy(cv, n, share) for k, (cv, n) in model.kinds.items()}
    fallback = planner_policy(model.all, len(test), share)
    totals = {name: [0.0] * 4 for name in POLICIES}
    for c in test:
        rules = ((0, "stop"), (0, "act"), (REMIND_DAY, "act"), (CLIFF_DAY, "act"))
        for name, (day, action) in zip(
            POLICIES, (*rules, kinds.get(c.kind, fallback)), strict=True
        ):
            totals[name] = [
                t + x for t, x in zip(totals[name], simulate(c, day, action, share), strict=True)
            ]
    scale = 1000 / len(test)
    out = {}
    for name, (paid, calls, back, minutes) in totals.items():
        net = back - calls * COMPUTE - minutes / 60 * TIME_VALUE
        out[name] = [paid * scale, calls * scale, back * scale, minutes / 60 * scale, net * scale]
    return out


def backtest_report(model: Fitted, test: Sequence[Case], uk_share: float, uk_note: str) -> str:
    main = backtest(model, test, uk_share)
    shares = sorted({uk_share, 0.25, 0.5, 0.75, 1.0})
    sweep = {s: backtest(model, test, s) for s in shares}
    days = sorted({planner_policy(cv, n, uk_share) for cv, n in model.kinds.values()})
    lines = [
        "# Rights Decay backtest (R3)", "",
        f"**Data:** {len(test):,} held-out NYC housing requests (Jul-Dec 2025), a STAND-IN for UK "
        "complaints. The planner only saw curves fitted on Jan-Jun.", "",
        f"**Assumptions (not observed):** each problem is owed £{OWED} (Ofcom's "
        f"missed-appointment rate). A closure pays with probability {uk_share:.0%} ({uk_note}); "
        f"one that doesn't leaves the problem open. Tempo's call works {P_CALL:.0%} of the time "
        f"and costs £{COMPUTE:.2f}. The right to complain ends on day {CLIFF_DAY}. An open problem "
        f"costs {ATTENTION:.0f} minutes a week of your attention at £{TIME_VALUE:.0f} an hour.", "",
        f"## Per 1,000 problems, closures paying {uk_share:.0%} of the time", "",
        "| Policy | Paid without a fight | Calls Tempo makes | £ back | Your attention | Net |",
        "|---|---|---|---|---|---|",
        *(f"| {k} | {v[0]:.0f} | {v[1]:.0f} | £{v[2]:,.0f} | {v[3]:,.0f} h | £{v[4]:,.0f} |"
          for k, v in main.items()),
        "", "The planner's choice by kind of problem (day, then act or stop chasing): "
        + ", ".join(f"day {d} {a}" for d, a in days) + ".", "",
        "## Net £ per 1,000 as the share of closures that pay changes", "",
        "The best simple rule depends on an assumption nobody can see in advance. The planner "
        "reads the same assumption and adapts.", "",
        "| Closures that pay | " + " | ".join(POLICIES) + " | Planner vs best rule |",
        "|---|" + "---|" * (len(POLICIES) + 1),
    ]  # fmt: skip
    for s, result in sweep.items():
        best_rule = max(v[4] for k, v in result.items() if k != "Rights Decay")
        gap = result["Rights Decay"][4] - best_rule
        cells = " | ".join(f"£{result[k][4]:,.0f}" for k in POLICIES)
        lines.append(f"| {s:.0%} | {cells} | {gap:+,.0f} |")
    lines += [
        "", "A positive gap means the planner beat every simple rule at that share; a negative "
        "one is how much it lost to the best of them. Money and minutes here are expected values "
        "under the assumptions above, not observed payments.",
    ]  # fmt: skip
    return "\n".join(lines) + "\n"


def calibration_report(rows: list[str], train: int, test: int) -> str:
    header = (
        "| Question | Cases | Observed | Predicted | Brier: Tempo's model | Brier: one curve "
        "for all | Skill | AUC |"
    )
    return "\n".join([
        "# Rights Decay: how often is a problem closed without a fight? (R3)", "",
        f"**Data:** {SOURCE} (NYC Open Data erm2-nwe9, HPD, fetched 24 Oct 2026), a STAND-IN for "
        "UK companies: housing repairs, not refunds. Requests still open are censored at the "
        "download date.", "",
        f"- Fitted on requests made Jan-Jun 2025 ({train:,}); scored on Jul-Dec 2025 ({test:,}), "
        "which the model never saw.",
        "- Model: Kaplan-Meier per complaint type and descriptor, each descriptor shrunk toward "
        "its type (empirical Bayes, strength from the data). Baseline: one curve for every "
        "request.",
        "", "## Brier score on the held-out months (lower is better)", "",
        header, "|---|---|---|---|---|---|---|---|", *rows, "",
        "**How to read this.** The curve's shape is the finding: the chance of closing in the next "
        "two weeks falls as a case ages, and the held-out months confirm it. Telling one case from "
        "another is weak (AUC about 0.6), so the planner leans on the shape, not on a per-case "
        "score. The \"open at day\" rows are the questions it asks on a decision day.", "",
        "**Drift.** Compare the observed and predicted columns: in Jul-Dec more requests closed "
        "than the Jan-Jun curves expected, so the curves are cautious about cases sorting "
        "themselves out. That errs toward acting, not toward waiting too long. Refitting on a "
        "rolling window would fix it; the curves written to skills/ use all of 2025.", "",
        "![Reliability](rights_calibration.png)", "",
    ]) + "\n"  # fmt: skip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=ROOT / ".data")
    parser.add_argument("--hazards", type=Path, default=ROOT / "skills/rights-decay/hazards")
    parser.add_argument("--docs", type=Path, default=ROOT / "docs")
    args = parser.parse_args()
    cases = read_cases(args.data / "data_nyc" / "hpd_2025.csv")
    split = (
        [c for c in cases if c.created.date() < SPLIT_DAY],
        [c for c in cases if c.created.date() >= SPLIT_DAY],
    )
    model, (rows, bins) = fit(split[0]), score(fit(split[0]), split[1])
    path = args.data / "data_fca" / "fca_h1_2026.xlsx"
    uk = fca(path) if path.exists() else None
    share = uk.upheld_share if uk else 1.0
    note = (
        f"FCA H1 2026: {uk.firms} UK firms upheld {share:.0%} of the banking complaints they closed"
        if uk else "no UK figure loaded, so every closure is assumed to pay"
    )  # fmt: skip
    args.docs.mkdir(parents=True, exist_ok=True)
    args.hazards.mkdir(parents=True, exist_ok=True)
    label = f"{SOURCE}: fitted Jan-Jun ({len(split[0]):,}), scored Jul-Dec ({len(split[1]):,})"
    draw(
        args.docs / "rights_calibration.png",
        {k: bins[k] for k in ("within 14 days", "within 30 days")},
        label,
    )
    (args.docs / "rights_calibration.md").write_text(
        calibration_report(rows, *map(len, split)), encoding="utf-8"
    )
    (args.docs / "rights_backtest.md").write_text(
        backtest_report(model, split[1], share, note), encoding="utf-8"
    )
    everything = fit(cases)
    named = [("nyc311.hpd.all", everything.all, len(cases))] + [
        (f"nyc311.hpd.{slug(k)}", cv, n)
        for k, (cv, n) in sorted(everything.kinds.items())
        if n >= MIN_KIND_N
    ]
    for id, curve, n in named:
        write_hazard(args.hazards, hazard(curve, id=id, n=n, share=share, share_source=note))
    for h in uk.curves if uk else []:
        write_hazard(args.hazards, h)
    print("\n".join(rows))
    print((args.docs / "rights_backtest.md").read_text())


if __name__ == "__main__":
    main()
