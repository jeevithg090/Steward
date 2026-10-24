"""Integration tests run against a real Postgres: TEST_DATABASE_URL, else Docker, else skip.

They never use DATABASE_URL, because every test resets the schema.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncEngine

from alembic import command
from tempo_adapters.db import SqlRepo, make_engine

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        yield url
        return
    if shutil.which("docker"):
        from testcontainers.postgres import PostgresContainer

        with PostgresContainer("pgvector/pgvector:pg16", driver="asyncpg") as pg:
            yield pg.get_connection_url()
        return
    pytest.skip("set TEST_DATABASE_URL or install Docker to run integration tests")


def alembic_config(url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("sqlalchemy.url", url)
    config.attributes["configure_logger"] = False
    return config


@pytest.fixture
def migrated(database_url: str) -> str:
    """A freshly migrated schema for each test."""
    config = alembic_config(database_url)
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    return database_url


@pytest.fixture
async def engine(migrated: str) -> AsyncIterator[AsyncEngine]:
    engine = make_engine(migrated)
    yield engine
    await engine.dispose()


@pytest.fixture
def repo(engine: AsyncEngine) -> SqlRepo:
    return SqlRepo(engine)
