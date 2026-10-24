"""The Vault in Postgres (S8.3): the database only ever holds ciphertext."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine

from tempo_adapters.db.vault import SqlVaultStore
from tempo_crypto.envelope import CannotOpen, new_key
from tempo_crypto.vault import Vault

CANARIES = [b"Margaret", b"14.20", b"BB-4417", b"ZEBRA-CANARY-7731"]
CAPSULE = b'{"display_name": "Margaret", "amount_gbp": "14.20", "reference": "BB-4417", "note": "ZEBRA-CANARY-7731"}'


async def test_db_rows_are_ciphertext_only(engine: AsyncEngine) -> None:
    vault, k_user = Vault(SqlVaultStore(engine)), new_key()
    await vault.put(k_user, "u_margaret", "m_1", "capsule", CAPSULE)
    await vault.put(k_user, "u_margaret", "m_1", "transcript", b"Margaret said yes to 14.20")

    async with engine.connect() as conn:
        rows = [
            bytes(value)
            for table in ("vault_blobs", "vault_keys")
            for row in await conn.execute(sa.text(f"SELECT * FROM {table}"))  # noqa: S608 (fixed names)
            for value in row
            if isinstance(value, bytes | memoryview)
        ]

    assert len(rows) == 3  # two blobs and one wrapped data key
    assert not [c for c in CANARIES for row in rows if c in row]
    assert await vault.get(k_user, "u_margaret", "m_1", "capsule") == CAPSULE


async def test_crypto_shred_makes_vault_unreadable(engine: AsyncEngine) -> None:
    vault, k_user = Vault(SqlVaultStore(engine)), new_key()
    await vault.put(k_user, "u_margaret", "m_1", "capsule", CAPSULE)
    await vault.put(k_user, "u_amir", "m_2", "capsule", b"Amir's")

    assert await vault.shred("u_margaret") == 1

    with pytest.raises(CannotOpen):
        await vault.get(k_user, "u_margaret", "m_1", "capsule")
    assert await vault.get(k_user, "u_amir", "m_2", "capsule") == b"Amir's"  # only hers is gone
