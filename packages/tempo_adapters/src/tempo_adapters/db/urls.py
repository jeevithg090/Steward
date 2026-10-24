"""DATABASE_URL in whatever form a provider gives it.

Tiger Data, Neon and others hand out `postgres://...?sslmode=require`. SQLAlchemy's asyncpg
driver wants `postgresql+asyncpg://` and an `ssl` argument, while libpq-style clients (asyncpg's
own DSN parser in `make doctor`, psycopg for Mem0) want `postgresql://` and `sslmode`. Paste the
provider's string as is; these two functions turn it into what each client needs.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SCHEMES = ("postgres", "postgresql", "postgresql+asyncpg", "postgresql+psycopg")
LIBPQ_ONLY = ("channel_binding",)  # Neon adds it; asyncpg doesn't take it


def _split(url: str) -> tuple[Any, dict[str, str]]:
    parts = urlsplit(url.strip())
    if parts.scheme not in SCHEMES:
        raise ValueError(f"DATABASE_URL must be a Postgres URL, not {parts.scheme or 'empty'}://")
    return parts, dict(parse_qsl(parts.query))


def asyncpg_url(url: str) -> tuple[str, dict[str, Any]]:
    """The SQLAlchemy URL and the extra connect arguments (SSL) for create_async_engine."""
    parts, query = _split(url)
    ssl = query.pop("sslmode", None) or query.pop("ssl", None)
    for key in LIBPQ_ONLY:
        query.pop(key, None)
    clean = urlunsplit(parts._replace(scheme="postgresql+asyncpg", query=urlencode(query)))
    return clean, ({"ssl": ssl} if ssl else {})


def libpq_url(url: str) -> str:
    """`postgresql://...?sslmode=...`, for asyncpg.connect and psycopg."""
    parts, query = _split(url)
    if "ssl" in query:
        query["sslmode"] = query.pop("ssl")
    return urlunsplit(parts._replace(scheme="postgresql", query=urlencode(query)))
