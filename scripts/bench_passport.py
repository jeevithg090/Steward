"""How long a mandate check takes (build plan P5). Not a CI gate: a figure from this machine.

    uv run python scripts/bench_passport.py            # 1,000 runs each
    uv run python scripts/bench_passport.py --runs 5000

Checks the signed fixture (fixtures/passport/signed_mandate.json, a real passkey signature) the
same way every time, prints p50 and p99 in milliseconds, and writes them into the "Latency"
section of docs/passport_redteam.md (the red-team test keeps that section when it rewrites the
table).
"""

from __future__ import annotations

import argparse
import platform
import statistics
import time
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

from tempo_passport import SignedMandate, Verdict, check_envelope, verify

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "passport" / "signed_mandate.json"
DOC = ROOT / "docs" / "passport_redteam.md"
LATENCY = "## Latency"


def timings(call: Callable[[], Verdict], runs: int) -> tuple[float, float]:
    """(p50, p99) in milliseconds, after a warm-up run. Every run must pass."""
    call()
    samples = []
    for _ in range(runs):
        started = time.perf_counter()
        verdict = call()
        samples.append((time.perf_counter() - started) * 1000)
        if not verdict.ok:
            raise SystemExit(f"the fixture didn't verify: {verdict.reason}")
    cuts = statistics.quantiles(samples, n=100, method="inclusive")
    return cuts[49], cuts[98]


def section(rows: list[tuple[str, float, float]], runs: int) -> str:
    machine = f"{platform.system()} {platform.machine()}, Python {platform.python_version()}"
    return "\n".join(
        [
            LATENCY,
            "",
            f"`scripts/bench_passport.py`: the same signed mandate checked {runs:,} times on "
            f"one laptop ({machine}). Not a CI gate.",
            "",
            "| Call | p50 (ms) | p99 (ms) |",
            "|---|---|---|",
            *(f"| {name} | {p50:.3f} | {p99:.3f} |" for name, p50, p99 in rows),
            "",
        ]
    )


def write(text: str) -> None:
    doc = DOC.read_text(encoding="utf-8") if DOC.exists() else "# Agent Passport: red team\n\n"
    head = doc[: doc.index(LATENCY)] if LATENCY in doc else doc.rstrip("\n") + "\n\n"
    DOC.write_text(head + text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=int, default=1000)
    runs = parser.parse_args().runs
    envelope = FIXTURE.read_text(encoding="utf-8")
    signed = SignedMandate.model_validate_json(envelope)
    now = signed.mandate.issued_at + timedelta(hours=4)
    company = signed.mandate.counterparty
    rows = [
        ("`verify`: signature, window and revocation", *timings(
            lambda: verify(signed, now=now, revoked=lambda _: False), runs)),
        ("`check_envelope`: read the JSON, verify, then check the request", *timings(
            lambda: check_envelope(envelope, now=now, counterparty=company, action="claim",
                                   revoked=lambda _: False), runs)),
    ]  # fmt: skip
    for name, p50, p99 in rows:
        print(f"{name}: p50 {p50:.3f} ms, p99 {p99:.3f} ms")
    write(section(rows, runs))
    print(f"wrote {DOC.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
