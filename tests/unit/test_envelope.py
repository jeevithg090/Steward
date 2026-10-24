"""Client-side encryption (S8.3): envelopes, key wrapping, rotation, recovery."""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tempo_crypto.envelope import (
    NONCE_BYTES,
    CannotOpen,
    aad,
    from_recovery_code,
    join_shares,
    new_key,
    open_,
    recovery_code,
    seal,
    split_for_helper,
)
from tempo_crypto.vault import MemoryVaultStore, Vault

MARGARET = aad("u_margaret", "m_1")


def test_seal_open_roundtrip() -> None:
    key = new_key()

    assert (
        open_(key, seal(key, b"Margaret, ref BB-4417", MARGARET), MARGARET)
        == b"Margaret, ref BB-4417"
    )


def test_wrong_aad_fails() -> None:
    key = new_key()
    blob = seal(key, b"secret", MARGARET)

    for elsewhere in (aad("u_amir", "m_1"), aad("u_margaret", "m_2"), aad("u_margaret", "m_1", 2)):
        with pytest.raises(CannotOpen):  # moved to another person, mission or version
            open_(key, blob, elsewhere)
    with pytest.raises(CannotOpen):
        open_(new_key(), blob, MARGARET)
    with pytest.raises(ValueError):
        aad("u_1|m_2", "m_1")  # ids can't fake the separator


def test_tampered_ciphertext_fails() -> None:
    key = new_key()
    blob = bytearray(seal(key, b"amount: 14.20", MARGARET))
    blob[-1] ^= 1

    with pytest.raises(CannotOpen):
        open_(key, bytes(blob), MARGARET)
    with pytest.raises(CannotOpen):
        open_(key, b"short", MARGARET)


def test_nonce_never_reused() -> None:
    key = new_key()
    nonces = {seal(key, b"x", MARGARET)[:NONCE_BYTES] for _ in range(10_000)}

    assert len(nonces) == 10_000


@settings(max_examples=50)
@given(plaintext=st.binary(max_size=2048), user=st.text("abc_123", min_size=1, max_size=12))
def test_any_bytes_round_trip(plaintext: bytes, user: str) -> None:
    key, context = new_key(), aad(user, "m_1")

    assert open_(key, seal(key, plaintext, context), context) == plaintext


async def test_key_rotation_rewraps_without_reencrypting_data() -> None:
    store = MemoryVaultStore()
    vault, old, new = Vault(store), new_key(), new_key()
    await vault.put(old, "u_margaret", "m_1", "capsule", b"Margaret's claim, ref BB-4417")
    await vault.put(old, "u_margaret", "m_2", "capsule", b"Amir? no: Margaret's second claim")
    blobs_before = dict(store.blobs)

    rotated = await vault.rotate(old, new, "u_margaret")

    assert rotated == 2
    assert store.blobs == blobs_before  # not one byte of data was re-encrypted
    assert await vault.get(new, "u_margaret", "m_1", "capsule") == b"Margaret's claim, ref BB-4417"
    with pytest.raises(CannotOpen):
        await vault.get(old, "u_margaret", "m_1", "capsule")


async def test_vault_reads_need_the_right_person_and_key() -> None:
    vault, key = Vault(MemoryVaultStore()), new_key()
    await vault.put(key, "u_margaret", "m_1", "capsule", b"v1")
    await vault.put(key, "u_margaret", "m_1", "capsule", b"v2")  # same mission: same data key

    assert await vault.get(key, "u_margaret", "m_1", "capsule") == b"v2"
    with pytest.raises(CannotOpen):
        await vault.get(new_key(), "u_margaret", "m_1", "capsule")
    with pytest.raises(CannotOpen):
        await vault.get(key, "u_margaret", "m_1", "nothing-here")
    assert await vault.shred("u_margaret") == 1
    with pytest.raises(CannotOpen):  # "Forget me": the ciphertext is still there, and useless
        await vault.get(key, "u_margaret", "m_1", "capsule")


def test_recovery_code_and_helper_shares_rebuild_the_key() -> None:
    key = new_key()
    code = recovery_code(key)
    mine, helper = split_for_helper(key)

    assert from_recovery_code(code.lower().replace("-", " ")) == key
    assert len(code.split("-")) == 13 and all(len(g) <= 4 for g in code.split("-"))
    assert join_shares(mine, helper) == key
    assert mine != key and helper != key
    with pytest.raises(ValueError):
        from_recovery_code("ABCD-EFGH")
