"""The timer loop: wakes missions whose Watchdog timers are due (spec §16.5)."""

from __future__ import annotations

import asyncio

import structlog

from tempo_gateway.missions import MissionService

log = structlog.get_logger(__name__)


async def run_scheduler(service: MissionService, interval_s: float = 30.0) -> None:
    while True:
        try:
            fired = await service.tick()
            if fired:
                log.info("timers_fired", missions=len(fired))
        except Exception:  # one bad mission must not stop every other timer
            log.exception("scheduler_tick_failed")
        await asyncio.sleep(interval_s)
