"""Calibrate the Arbiter's delay model and backtest it (build plan S6.3).

    uv run python scripts/calibrate_delay_model.py           # synthetic history, labelled so
    uv run python scripts/calibrate_delay_model.py --live    # 8 weeks of HSP (needs HSP keys)

Fits P(arriving ≥ 15 / 30 / 60 min late) for Oxford → Paddington by service, with
empirical-Bayes shrinkage, holds out the last week, and writes:
- docs/calibration.png: the reliability diagram on the holdout week
- docs/backtest.md: Brier scores against a route-average baseline, and what a commuter gets back
  by never claiming, claiming by hand, or with Tempo
"""

from __future__ import annotations

import argparse
import asyncio
import math
import random
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from tempo_core.delay_model import (
    THRESHOLDS,
    Bin,
    DelayModel,
    Run,
    brier,
    day_type,
    fit,
    reliability,
    split,
)
from tempo_core.models import ProofTrace
from tempo_core.rules import RulePackRegistry
from tempo_core.rules.engine import evaluate_delay_repay

ROOT = Path(__file__).resolve().parents[1]
END = date(2026, 10, 23)
COMMUTER = ("0812", "1742")  # Margaret's trains, there and back, every weekday
FARE = Decimal("28.40")
TIME_VALUE_GBP_H = Decimal(18)
MINUTES_BY_HAND = 12  # (assumption) find the form, type the journey, upload the ticket
MINUTES_WITH_TEMPO = 1  # read the question, Face ID


def timetable(day: date) -> list[str]:
    hours = range(6, 22) if day_type(day) == "WEEKDAY" else range(8, 21)
    return [f"{h:02d}{m}" for h in hours for m in ("12", "42")]


def true_p15(day: date, departure: str) -> float:
    """The made-up route's real chance of a 15-minute delay (known only because we made it up)."""
    if departure == "0812" and day_type(day) == "WEEKDAY":
        return 0.40
    p15 = 0.22 if int(departure[:2]) in (7, 8, 16, 17, 18) else 0.10
    return p15 * (1.3 if day.weekday() == 4 else 1.0)


def true_p(run: Run, t: int) -> float:
    return true_p15(run.day, run.departure) * {15: 1.0, 30: 0.45, 60: 0.45 * 0.35}[t]


def synthetic_history(end: date = END, weeks: int = 8, seed: int = 26) -> list[Run]:
    """A made-up route: peaks worse than off-peak, Fridays worse, and a chronically late 08:12."""
    rng = random.Random(seed)  # noqa: S311  (a simulation, not security)
    runs = []
    for offset in range(weeks * 7):
        day = end - timedelta(days=offset)
        for departure in timetable(day):
            draw, run = rng.random(), Run(day, departure, frozenset())
            late = frozenset(t for t in THRESHOLDS if draw < true_p(run, t))
            runs.append(Run(day, departure, late))
    return sorted(runs, key=lambda r: (r.day, r.departure))


async def live_history(end: date, weeks: int) -> list[Run]:
    import httpx

    from tempo_adapters.rail import HspSource
    from tempo_adapters.settings import Settings

    settings = Settings()
    if not settings.hsp_base_url:
        raise SystemExit("Set HSP_BASE_URL and HSP_API_KEY (or HSP_USER/HSP_PASS) for --live.")
    key = settings.hsp_api_key.get_secret_value() if settings.hsp_api_key else None
    auth = (
        (settings.hsp_user, settings.hsp_pass.get_secret_value())
        if settings.hsp_user and settings.hsp_pass
        else None
    )
    async with httpx.AsyncClient(timeout=30) as http:
        source = HspSource(http, base_url=settings.hsp_base_url, api_key=key, basic_auth=auth)
        runs = []
        for offset in range(weeks * 7):
            runs += await source.day_runs("OXF", "PAD", end - timedelta(days=offset))
    return sorted(runs, key=lambda r: (r.day, r.departure))


def predictions(model: DelayModel, runs: list[Run], t: int) -> tuple[list[float], list[bool]]:
    return [model.p(r, t) for r in runs], [t in r.late for r in runs]


def claim_amount(run: Run, registry: RulePackRegistry) -> Decimal:
    """What the rules pay for the lateness band the run reached (its lower edge: conservative)."""
    minutes = max(run.late)
    result = evaluate_delay_repay(
        registry.delay_repay("GWR"), delay_minutes=minutes, fare_gbp=FARE, facts=(), trace_id="bt"
    )
    return result.amount_gbp if isinstance(result, ProofTrace) else Decimal(0)


def draw_reliability(path: Path, bins: dict[int, list[Bin]], label: str) -> None:
    size, margin = 560, 70
    image = Image.new("RGB", (size, size), "white")
    pen = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=14)
    small = ImageFont.load_default(size=12)
    plot = size - 2 * margin

    def xy(px: float, py: float) -> tuple[float, float]:
        return margin + px * plot, size - margin - py * plot

    pen.rectangle([xy(0, 1), xy(1, 0)], outline="#334155")
    pen.line([xy(0, 0), xy(1, 1)], fill="#94a3b8", width=2)
    for tick in (0, 0.25, 0.5, 0.75, 1):
        x, y = xy(tick, 0)
        pen.text((x - 10, y + 6), f"{tick:.2f}", fill="#334155", font=small)
        x, y = xy(0, tick)
        pen.text((x - 40, y - 7), f"{tick:.2f}", fill="#334155", font=small)
    colours = {15: "#0f766e", 30: "#b45309", 60: "#7c3aed"}
    for t, points in bins.items():
        centres = [xy(b.predicted, b.observed) for b in points]
        if len(centres) > 1:
            pen.line(centres, fill=colours[t], width=2)
        for b, (cx, cy) in zip(points, centres, strict=True):
            r = 3 + math.sqrt(b.runs) / 2
            pen.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colours[t])
    for i, t in enumerate(bins):  # the default font has no symbols, so the legend dots are drawn
        y = margin + 12 + 18 * i
        pen.ellipse([margin + 10, y + 3, margin + 20, y + 13], fill=colours[t])
        pen.text((margin + 26, y), f"at least {t} min late", fill=colours[t], font=font)
    title = "Delay model reliability, holdout week (Oxford to Paddington)"
    pen.text((margin, 20), title, fill="#0f172a", font=font)
    pen.text((margin, 40), label, fill="#b91c1c" if "SYNTHETIC" in label else "#334155", font=small)
    pen.text((size / 2 - 60, size - 30), "predicted probability", fill="#334155", font=small)
    pen.text((8, margin - 22), "observed", fill="#334155", font=small)
    image.save(path)


def report(
    train: list[Run], test: list[Run], model: DelayModel, label: str, *, synthetic: bool
) -> str:
    registry = RulePackRegistry.from_directory(ROOT / "skills" / "clawback-uk-rail")
    lines = [
        "# Delay model backtest (S6.3)", "", f"**Data:** {label}", "",
        f"- Route: Oxford → Paddington. Training: {min(r.day for r in train)} to "
        f"{max(r.day for r in train)} ({len(train)} runs). Holdout: {min(r.day for r in test)} to "
        f"{max(r.day for r in test)} ({len(test)} runs), strictly after training.",
        "- Model: P(late ≥ t) per service, shrunk to its hour of day and the hour to the route "
        "(empirical Bayes, prior strength from the data).", "",
        "## Brier score on the holdout week (lower is better)", "",
        "| Late by at least | Tempo's model | Route average | Improvement | Best possible |",
        "|---|---|---|---|---|",
    ]  # fmt: skip
    for t in THRESHOLDS:
        p, outcomes = predictions(model, test, t)
        ours, base = brier(p, outcomes), brier([model.route[t]] * len(outcomes), outcomes)
        better = f"{(base - ours) / base * 100:.1f}%" if base else "n/a"
        best = f"{brier([true_p(r, t) for r in test], outcomes):.4f}" if synthetic else "unknown"
        lines.append(f"| {t} min | {ours:.4f} | {base:.4f} | {better} | {best} |")
    lines += [
        "", "Most of a Brier score is luck that no model can remove; \"best possible\" (only "
        "known for synthetic data) is the score of the true probabilities. One week is a small "
        "sample, so expect these numbers to move from week to week.",
    ]  # fmt: skip
    commute = [r for r in test if r.departure in COMMUTER and day_type(r.day) == "WEEKDAY"]
    late = [r for r in commute if 15 in r.late]
    recovered = sum((claim_amount(r, registry) for r in late), Decimal(0))
    expected = sum(model.p(r, 15) for r in commute)
    lines += [
        "", "## What a commuter gets back in the holdout week", "",
        f"Margaret's trains ({' and '.join(COMMUTER)}, every weekday): {len(commute)} journeys, "
        f"{len(late)} at least 15 min late (the model expected {expected:.1f}). GWR Delay Repay "
        f"on a £{FARE} fare, paying the lower edge of each lateness band.", "",
        "| | Claims | £ back | Her time | Net, at £18/h |", "|---|---|---|---|---|",
        "| Never claim | 0 | £0.00 | 0 min | £0.00 |",
    ]  # fmt: skip
    for name, minutes in (("By hand", MINUTES_BY_HAND), ("With Tempo", MINUTES_WITH_TEMPO)):
        spent = minutes * len(late)
        net = recovered - TIME_VALUE_GBP_H * spent / 60
        lines.append(f"| {name} | {len(late)} | £{recovered:.2f} | {spent} min | £{net:.2f} |")
    lines += [
        "", f"Assumptions: {MINUTES_BY_HAND} min to claim by hand, {MINUTES_WITH_TEMPO} min with "
        "Tempo (read the question, Face ID); amounts from the GWR rule pack, which still has "
        "demo values until checked against GWR's published terms.",
    ]  # fmt: skip
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--live", action="store_true", help="8 weeks of HSP history (needs keys)")
    parser.add_argument("--weeks", type=int, default=8)
    parser.add_argument("--out", type=Path, default=ROOT / "docs")
    args = parser.parse_args()
    if args.live:
        runs = asyncio.run(live_history(END, args.weeks))
        label = f"HSP history, {args.weeks} weeks to {END}"
    else:
        runs = synthetic_history(END, args.weeks)
        label = (
            "SYNTHETIC history (made up, to show the method). Use the live option with HSP keys."
        )
    train, test = split(runs, holdout_days=7)
    model = fit(train)
    bins = {t: reliability(*predictions(model, test, t)) for t in THRESHOLDS}
    args.out.mkdir(parents=True, exist_ok=True)
    draw_reliability(args.out / "calibration.png", bins, label)
    backtest = report(train, test, model, label, synthetic=not args.live)
    (args.out / "backtest.md").write_text(backtest, encoding="utf-8")
    print(f"Wrote {args.out / 'calibration.png'} and {args.out / 'backtest.md'} ({label})")


if __name__ == "__main__":
    main()
