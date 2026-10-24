"""Shared HTTP handling for rail sources: every failure becomes a typed domain error."""

from __future__ import annotations

from typing import Any

import httpx

from tempo_core.errors import RailDataUnavailable, ServiceNotFound

TIMEOUT = httpx.Timeout(15.0, connect=5.0)


def hhmm(value: str) -> str:
    """Accept "08:12" or "0812"; return "0812"."""
    digits = value.replace(":", "")
    if len(digits) != 4 or not digits.isdigit():
        raise ValueError(f"expected a departure time like 08:12, got {value!r}")
    return digits


async def send(
    http: httpx.AsyncClient,
    request: httpx.Request,
    what: str,
    auth: tuple[str, str] | None = None,
) -> Any:
    try:
        response = await http.send(request, auth=auth)
    except httpx.HTTPError as exc:
        raise RailDataUnavailable(f"{what}: {type(exc).__name__}") from exc
    if response.status_code in (204, 404):
        raise ServiceNotFound(f"{what}: no matching service")
    if response.status_code >= 400:
        raise RailDataUnavailable(f"{what}: HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise RailDataUnavailable(f"{what}: the response was not JSON") from exc
