"""`make demo-dry-run`: the scripted demo, text only, in replay mode, with timings (milestone M1).

Margaret's 08:12 Oxford -> Paddington arrived 38 minutes late. Tempo finds the delay, works out
Delay Repay with a Proof Trace, asks her once, and claims. Halfway through, the Gateway is
"killed" and restarted: the mission resumes from its checkpoint and asks the same question.

Exits 1 if any beat goes wrong, so it can gate a demo.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from collections.abc import Awaitable, Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

from tempo_adapters.settings import Settings
from tempo_gateway.main import build_service
from tempo_gateway.missions import MissionService, StartMission
from tempo_missions.clawback_rail import SignedApproval

MARGARET = StartMission(
    user_id="u_margaret",
    display_name="Margaret",
    origin_crs="OXF",
    destination_crs="PAD",
    travel_date="2026-10-23",
    departure="08:12",
    fare_gbp=Decimal("28.40"),
    time_value_gbp_h=Decimal("18"),
)

Check = tuple[str, bool]


async def beat(
    name: str, work: Callable[[], Awaitable[Any]], timings: list[tuple[str, float]]
) -> Any:
    start = time.perf_counter()
    result = await work()
    timings.append((name, (time.perf_counter() - start) * 1000))
    return result


async def main(checkpoints: Path) -> list[Check]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", checkpoint_dir=str(checkpoints)
    )
    service, _ = build_service(settings)
    timings: list[tuple[str, float]] = []

    view = await beat("start mission", lambda: service.start(MARGARET), timings)
    print(f"\nTempo: {view.message}\n")
    ask = view.ask

    # The Gateway dies here. Only the database and the checkpoint files survive.
    restarted = MissionService(service.deps, checkpoints, service._bus)
    recovered = await beat("restart + recover", restarted.recover, timings)
    request_id = restarted.pending_for(view.id)

    yes = SignedApproval(approved=True, scopes=("file_claim",), device_sig="demo:passkey")
    done = await beat("approve + claim", lambda: restarted.answer(request_id or "", yes), timings)
    print(f"Tempo: {done.message}\n")

    for name, ms in timings:
        print(f"  {name:<22} {ms:7.1f} ms")
    print("  timeline: " + " → ".join(t["to"] for t in done.timeline))

    claims = service.deps.claims
    return [
        ("asked once, for £14.20", ask is not None and ask.amount_gbp == "14.20"),
        ("the Proof Trace is in the question", ask is not None and "38 min late" in ask.summary),
        (
            "recovered after the restart",
            recovered == [view.id] and request_id == ask.request_id if ask else False,
        ),
        ("claimed exactly once", getattr(claims, "calls", None) == 1),
        ("mission completed", done.state.value == "completed"),
        ("whole run under 2 s", sum(ms for _, ms in timings) < 2000),
    ]


def run() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        checks = asyncio.run(main(Path(tmp)))
    print()
    for name, ok in checks:
        print(f"{'✅' if ok else '❌'} {name}")
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(run())
