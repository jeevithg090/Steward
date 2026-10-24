"""How likely is this train to be late? A calibrated delay model for the Arbiter (build plan S6.3).

P(arrives ≥ 15 / 30 / 60 min late) by service, from history (HSP), with empirical-Bayes
shrinkage: a service seen a few times borrows strength from its hour of day, and the hour from
the whole route, so one bad morning doesn't make a train look hopeless. Scored by the Brier score
on a holdout that is strictly later than the training data.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

THRESHOLDS: tuple[int, ...] = (15, 30, 60)
MIN_STRENGTH, MAX_STRENGTH = 2.0, 200.0  # prior strength bounds, in pseudo-runs


def day_type(day: date) -> str:
    return {5: "SATURDAY", 6: "SUNDAY"}.get(day.weekday(), "WEEKDAY")


@dataclass(frozen=True)
class Run:
    """One service on one day: which lateness thresholds it reached at the destination."""

    day: date
    departure: str  # "0812"
    late: frozenset[int]  # e.g. {15, 30}: at least 30 min late

    @property
    def group(self) -> tuple[str, str]:
        return day_type(self.day), self.departure

    @property
    def hour(self) -> tuple[str, int]:
        return day_type(self.day), int(self.departure[:2])


@dataclass(frozen=True)
class Tally:
    late: int
    runs: int

    @property
    def rate(self) -> float:
        return self.late / self.runs if self.runs else 0.0


def tally(runs: Iterable[Run], threshold: int) -> Tally:
    counted = list(runs)
    return Tally(sum(threshold in r.late for r in counted), len(counted))


def prior_strength(groups: Sequence[Tally], mean: float) -> float:
    """Method of moments for a beta-binomial: how many pseudo-runs the prior is worth.

    The spread of group rates beyond what binomial noise explains is the real between-group
    variance; the less of it there is, the harder sparse groups are pulled to the mean.
    """
    groups = [g for g in groups if g.runs > 0]
    if len(groups) < 2 or mean <= 0.0 or mean >= 1.0:
        return MAX_STRENGTH
    total = sum(g.runs for g in groups)
    observed = sum(g.runs * (g.rate - mean) ** 2 for g in groups) / total
    noise = mean * (1 - mean) * len(groups) / total  # the average binomial variance of a rate
    between = observed - noise
    if between <= 0:
        return MAX_STRENGTH
    return min(MAX_STRENGTH, max(MIN_STRENGTH, mean * (1 - mean) / between - 1))


def shrink(group: Tally, toward: float, strength: float) -> float:
    return (group.late + strength * toward) / (group.runs + strength)


@dataclass(frozen=True)
class DelayModel:
    route: dict[int, float]
    hours: dict[int, dict[tuple[str, int], float]]
    services: dict[int, dict[tuple[str, str], float]]
    strength: dict[int, tuple[float, float]]  # (hour level, service level) per threshold

    def p(self, run: Run, threshold: int) -> float:
        """P(this run is at least `threshold` min late). Unseen services fall back to their hour,
        unseen hours to the route."""
        service = self.services[threshold].get(run.group)
        if service is not None:
            return service
        return self.hours[threshold].get(run.hour, self.route[threshold])


def fit(runs: Sequence[Run], thresholds: Sequence[int] = THRESHOLDS) -> DelayModel:
    if not runs:
        raise ValueError("no history to learn from")
    by_hour: dict[tuple[str, int], list[Run]] = defaultdict(list)
    by_service: dict[tuple[str, str], list[Run]] = defaultdict(list)
    for run in runs:
        by_hour[run.hour].append(run)
        by_service[run.group].append(run)
    route, hours, services, strength = {}, {}, {}, {}
    for t in thresholds:
        mean = tally(runs, t).rate
        hour_tallies = {h: tally(rs, t) for h, rs in by_hour.items()}
        k_hour = prior_strength(list(hour_tallies.values()), mean)
        hours[t] = {h: shrink(g, mean, k_hour) for h, g in hour_tallies.items()}
        service_tallies = {s: tally(rs, t) for s, rs in by_service.items()}
        k_service = prior_strength(list(service_tallies.values()), mean)
        services[t] = {
            s: shrink(g, hours[t][(s[0], int(s[1][:2]))], k_service)
            for s, g in service_tallies.items()
        }
        route[t], strength[t] = mean, (k_hour, k_service)
    return DelayModel(route, hours, services, strength)


def split(runs: Sequence[Run], holdout_days: int = 7) -> tuple[list[Run], list[Run]]:
    """Train on everything before the last `holdout_days` days; test on those days only."""
    if not runs:
        return [], []
    last = max(r.day for r in runs)
    cutoff = date.fromordinal(last.toordinal() - holdout_days + 1)
    return [r for r in runs if r.day < cutoff], [r for r in runs if r.day >= cutoff]


def brier(predictions: Sequence[float], outcomes: Sequence[bool]) -> float:
    """Mean squared error of probabilities against what happened (0 is perfect)."""
    if len(predictions) != len(outcomes) or not predictions:
        raise ValueError("need one prediction per outcome")
    return sum((p - o) ** 2 for p, o in zip(predictions, outcomes, strict=True)) / len(outcomes)


@dataclass(frozen=True)
class Bin:
    predicted: float  # mean prediction in the bin
    observed: float  # how often it actually happened
    runs: int


def reliability(predictions: Sequence[float], outcomes: Sequence[bool], bins: int = 5) -> list[Bin]:
    """The reliability diagram's points: calibrated predictions sit on the diagonal."""
    grouped: dict[int, list[tuple[float, bool]]] = defaultdict(list)
    for p, o in zip(predictions, outcomes, strict=True):
        grouped[min(int(p * bins), bins - 1)].append((p, o))
    return [
        Bin(
            predicted=sum(p for p, _ in pairs) / len(pairs),
            observed=sum(o for _, o in pairs) / len(pairs),
            runs=len(pairs),
        )
        for _, pairs in sorted(grouped.items())
    ]
