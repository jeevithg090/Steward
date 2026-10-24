"""DATABASE_URL as providers give it: one string works for the Gateway, Alembic, doctor, Mem0."""

from __future__ import annotations

import pytest

from tempo_adapters.db.urls import asyncpg_url, libpq_url
from tempo_memory.mem0_store import psycopg_url

TIGER = "postgres://tsdbadmin:s3cret@abc123.tsdb.cloud.timescale.com:34567/tsdb?sslmode=require"
NEON = "postgresql://neondb_owner:s3cret@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"


def test_a_tiger_data_string_works_for_sqlalchemy_and_libpq() -> None:
    url, connect = asyncpg_url(TIGER)

    assert url == "postgresql+asyncpg://tsdbadmin:s3cret@abc123.tsdb.cloud.timescale.com:34567/tsdb"
    assert connect == {"ssl": "require"}
    assert libpq_url(TIGER) == TIGER.replace("postgres://", "postgresql://")


def test_neon_drops_what_asyncpg_cannot_take() -> None:
    url, connect = asyncpg_url(NEON)

    assert "channel_binding" not in url and connect == {"ssl": "require"}
    assert "channel_binding=require" in libpq_url(NEON)  # libpq clients understand it


def test_the_asyncpg_form_also_converts_back() -> None:
    ours = "postgresql+asyncpg://tempo@localhost:5432/tempo?ssl=require"

    assert asyncpg_url(ours) == (
        "postgresql+asyncpg://tempo@localhost:5432/tempo",
        {"ssl": "require"},
    )
    assert libpq_url(ours) == "postgresql://tempo@localhost:5432/tempo?sslmode=require"
    assert psycopg_url(ours) == "postgresql://tempo@localhost:5432/tempo?sslmode=require"
    assert psycopg_url(TIGER) == TIGER.replace("postgres://", "postgresql://")
    assert asyncpg_url("postgresql://tempo@localhost/tempo") == (
        "postgresql+asyncpg://tempo@localhost/tempo",
        {},
    )


def test_a_non_postgres_url_is_refused() -> None:
    with pytest.raises(ValueError, match="mysql://"):
        asyncpg_url("mysql://root@localhost/tempo")
    with pytest.raises(ValueError, match="empty://"):
        libpq_url("not a url")
