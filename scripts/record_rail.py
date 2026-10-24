"""Record real delayed journeys as fixtures (raw vendor responses + parsed replay files).

Usage: uv run python scripts/record_rail.py OXF PAD 2026-10-23 08:12 17:42

Needs RTT_TOKEN and/or HSP_* in .env. Writes fixtures/rail/{hsp,rtt}/ and fixtures/rail/replay/.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import date
from pathlib import Path

import httpx

from tempo_adapters.rail import rail_port
from tempo_adapters.rail._http import TIMEOUT
from tempo_adapters.settings import Settings

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "rail"


def _raw_name(request: httpx.Request) -> tuple[str, str]:
    url = request.url
    if "serviceMetrics" in url.path or "serviceDetails" in url.path:
        body = json.loads(request.content)
        name = (
            f"service_details_{body['rid']}"
            if "rid" in body
            else f"service_metrics_{body['from_loc']}_{body['to_loc']}_{body['from_date']}"
        )
        return "hsp", name
    if url.path.endswith("/location"):
        return (
            "rtt",
            f"location_{url.params['code']}_{url.params['filterTo']}_{url.params['timeFrom'][:10]}",
        )
    return "rtt", f"service_{url.params.get('identity', 'unknown')}"


async def main(origin: str, destination: str, day: date, departures: list[str]) -> None:
    async def save(response: httpx.Response) -> None:
        await response.aread()
        if response.status_code == 200:
            folder, name = _raw_name(response.request)
            path = FIXTURES / folder / f"{name}.json"
            path.write_text(json.dumps(response.json(), indent=2) + "\n")
            print(f"saved {path.relative_to(FIXTURES.parents[1])}")

    settings = Settings().model_copy(update={"tempo_mode": "live"})
    async with httpx.AsyncClient(timeout=TIMEOUT, event_hooks={"response": [save]}) as http:
        port = rail_port(settings, http)
        for departure in departures:
            journey = await port.service_delay(origin, destination, day, departure)
            path = (
                FIXTURES
                / "replay"
                / f"{origin}-{destination}-{day}-{departure.replace(':', '')}.json"
            )
            path.write_text(journey.model_dump_json(indent=2) + "\n")
            print(
                f"{departure}: {journey.delay_minutes} min late ({journey.source}) -> {path.name}"
            )


if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    origin_crs, destination_crs, when, *times = sys.argv[1:]
    asyncio.run(main(origin_crs, destination_crs, date.fromisoformat(when), times))
