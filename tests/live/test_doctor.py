"""Real vendor smoke test: one cheap call per service (`make doctor`, or `pytest -m live`)."""

from tempo_adapters.doctor import Status, render, run_checks
from tempo_adapters.settings import Settings


async def test_all_services_reachable() -> None:
    results = await run_checks(Settings())

    failing = [r for r in results if r.required and r.status is not Status.OK]
    assert not failing, "\n" + render(results)
