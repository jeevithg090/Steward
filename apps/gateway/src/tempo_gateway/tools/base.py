"""What every look-up tool shares (plan.md §17): the result's sources, the refusal, the request
helpers with Tempo's user agent and time limits, and the place lookup most tools start from."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import httpx

USER_AGENT = "Tempo/0.2 (open-source assistant; https://github.com/jeevithg090/Tempo)"
TIMEOUT = httpx.Timeout(10.0, connect=5.0)


@dataclass(frozen=True)
class Source:
    """Where an answer came from: shown under the reply as a link."""

    title: str
    url: str


class Refused(ValueError):
    """A request a tool won't make (a private address, a missing town, too big): the brain is told
    why, in plain words."""


@dataclass
class Context:
    """What a tool may use: the shared HTTP client, today's date, and any keys that were set."""

    http: httpx.AsyncClient
    today: Callable[[], date]
    keys: dict[str, str] = field(default_factory=dict)

    async def get_json(self, url: str, **kwargs: Any) -> Any:
        headers = {"User-Agent": USER_AGENT, **kwargs.pop("headers", {})}
        response = await self.http.get(url, headers=headers, timeout=TIMEOUT, **kwargs)
        response.raise_for_status()
        return response.json()

    async def get_text(self, url: str, **kwargs: Any) -> str:
        headers = {"User-Agent": USER_AGENT, **kwargs.pop("headers", {})}
        response = await self.http.get(url, headers=headers, timeout=TIMEOUT, **kwargs)
        response.raise_for_status()
        return response.text


Result = tuple[dict[str, Any], list[Source]]
Handler = Callable[[Context, dict[str, str]], Awaitable[Result]]


@dataclass(frozen=True)
class Tool:
    """One look-up: what the model sees (name, description, parameters), the code that runs it, the
    line it adds to the reply's steps, and who answers it (for /health and the Privacy Proof)."""

    name: str
    description: str
    params: dict[str, dict[str, Any]]
    required: tuple[str, ...]
    run: Handler
    label: Callable[[dict[str, str]], str]
    provider: str

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": self.params,
                    "required": list(self.required),
                },
            },
        }


def text(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def need(args: dict[str, str], key: str, what: str, limit: int = 120) -> str:
    """A required argument, trimmed; refused in plain words when it's missing."""
    value = (args.get(key) or "").strip()[:limit]
    if not value:
        raise Refused(f"say {what}")
    return value


async def geocode(ctx: Context, place: str) -> dict[str, Any]:
    """A place's name, region, coordinates and time zone, from Open-Meteo: the UK first."""
    for country in ("GB", None):
        params: dict[str, Any] = {"name": place, "count": 1}
        if country:
            params["countryCode"] = country
        found = await ctx.get_json("https://geocoding-api.open-meteo.com/v1/search", params=params)
        if found.get("results"):
            spot: dict[str, Any] = found["results"][0]
            return spot
    raise Refused(f"no place called {place!r} was found")


def where(spot: dict[str, Any]) -> str:
    return f"{spot['name']}, {spot.get('admin1') or spot.get('country', '')}".strip(", ")
