"""Memory never decides money (spec §17.3): a remembered amount can't become the claim."""

from __future__ import annotations

from decimal import Decimal

import pytest

from tempo_core.models import ProofStep, ProofTrace
from tempo_harness.policies import Action, Point, ProofRequired, Seen
from tempo_memory.contract import said
from tempo_memory.in_memory import InMemoryMemory
from tempo_memory.provider import HEADER, memory_line

TRACE = ProofTrace(
    id="pt_31c",
    steps=(
        ProofStep(
            fact_keys=("arrival_delay_min", "fare_gbp"),
            rule_id="uk-rail.gwr.delay-repay",
            rule_version="0.1.0",
            citation_url="https://www.gwr.com/",
            explanation="38 min late → 50% of £28.40 under GWR DR15",
        ),
    ),
    amount_gbp=Decimal("14.20"),
)
GUARD = ProofRequired(traces=lambda trace_id: TRACE if trace_id == "pt_31c" else None)


@pytest.mark.parametrize(
    ("amount", "action"),
    [
        ("14.25", Action.DENY),  # half of a remembered "usual fare £28.50"
        ("28.50", Action.DENY),  # the remembered fare itself
        ("14.20", Action.ALLOW),  # the amount the rules give
    ],
)
async def test_memory_cannot_change_entitlement_amount(amount: str, action: Action) -> None:
    memory = InMemoryMemory()
    remembered = await memory.add(said("usual fare is £28.50", category="journey"))
    file_claim = Seen(
        Point.PRE_TOOL, tool="file_claim", args={"proof_trace_id": "pt_31c", "amount_gbp": amount}
    )

    assert GUARD.check(file_claim).action is action
    assert "Memory never sets an amount" in HEADER  # what the model is told with every memory
    assert memory_line(remembered).endswith("usual fare is £28.50")  # shown as a suggestion only
