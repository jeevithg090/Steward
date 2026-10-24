"""Alembic environment: async engine, URL from -x url=..., sqlalchemy.url or DATABASE_URL."""

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy.engine import Connection

from alembic import context
from tempo_adapters.db import make_engine
from tempo_adapters.db.models import Base
from tempo_adapters.db.urls import asyncpg_url
from tempo_adapters.settings import Settings
from tempo_memory.fallback_sql import metadata as memory_metadata
from tempo_memory.temporal_sql import temporal_facts  # noqa: F401  (registers its tables)

config = context.config
if config.config_file_name and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = [Base.metadata, memory_metadata]


def _url() -> str:
    url = (
        context.get_x_argument(as_dictionary=True).get("url")
        or config.get_main_option("sqlalchemy.url")
        or os.environ.get("DATABASE_URL")
        or _from_dotenv()
    )
    if not url:
        raise RuntimeError("set DATABASE_URL in .env (or pass -x url=...) to run migrations")
    return url


def _from_dotenv() -> str | None:
    """The same .env the Gateway reads, so `make db-migrate` needs nothing exported."""
    secret = Settings().database_url
    return secret.get_secret_value() if secret is not None else None


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = make_engine(_url())
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(
        url=asyncpg_url(_url())[0], target_metadata=target_metadata, literal_binds=True
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(_run_async())
