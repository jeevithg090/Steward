"""The Vault's store in Postgres: ciphertext and wrapped keys, nothing else (S8.3)."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from tempo_adapters.db.models import VaultBlob, VaultKey

BLOBS, KEYS = VaultBlob.__table__, VaultKey.__table__


class SqlVaultStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    async def put(self, user_id: str, mission_id: str, name: str, blob: bytes) -> None:
        row = {"user_id": user_id, "mission_id": mission_id, "name": name, "blob": blob}
        stmt = (
            insert(BLOBS)
            .values(row)
            .on_conflict_do_update(
                index_elements=["user_id", "mission_id", "name"], set_={"blob": blob}
            )
        )
        async with self.engine.begin() as conn:
            await conn.execute(stmt)

    async def get(self, user_id: str, mission_id: str, name: str) -> bytes | None:
        stmt = sa.select(BLOBS.c.blob).where(
            BLOBS.c.user_id == user_id, BLOBS.c.mission_id == mission_id, BLOBS.c.name == name
        )
        async with self.engine.connect() as conn:
            return (await conn.execute(stmt)).scalar_one_or_none()

    async def put_key(self, user_id: str, mission_id: str, wrapped: bytes) -> None:
        stmt = (
            insert(KEYS)
            .values(user_id=user_id, mission_id=mission_id, wrapped=wrapped)
            .on_conflict_do_update(
                index_elements=["user_id", "mission_id"], set_={"wrapped": wrapped}
            )
        )
        async with self.engine.begin() as conn:
            await conn.execute(stmt)

    async def get_key(self, user_id: str, mission_id: str) -> bytes | None:
        stmt = sa.select(KEYS.c.wrapped).where(
            KEYS.c.user_id == user_id, KEYS.c.mission_id == mission_id
        )
        async with self.engine.connect() as conn:
            return (await conn.execute(stmt)).scalar_one_or_none()

    async def keys_of(self, user_id: str) -> dict[str, bytes]:
        stmt = sa.select(KEYS.c.mission_id, KEYS.c.wrapped).where(KEYS.c.user_id == user_id)
        async with self.engine.connect() as conn:
            return {r.mission_id: r.wrapped for r in await conn.execute(stmt)}

    async def delete_keys(self, user_id: str) -> int:
        async with self.engine.begin() as conn:
            result = await conn.execute(KEYS.delete().where(KEYS.c.user_id == user_id))
        return result.rowcount
