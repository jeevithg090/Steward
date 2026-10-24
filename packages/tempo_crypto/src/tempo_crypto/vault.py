"""The Vault: per-person, per-mission ciphertext (build plan S8.3).

The store keeps sealed blobs and wrapped data keys, never K_user and never plaintext. Callers
pass K_user for each operation (it comes from the device, S8.4) and the store forgets it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from tempo_crypto.envelope import CannotOpen, aad, new_key, open_, rewrap, seal, unwrap, wrap


class VaultStore(Protocol):
    """Where ciphertext lives: rows of bytes, keyed by person, mission and name."""

    async def put(self, user_id: str, mission_id: str, name: str, blob: bytes) -> None: ...
    async def get(self, user_id: str, mission_id: str, name: str) -> bytes | None: ...
    async def put_key(self, user_id: str, mission_id: str, wrapped: bytes) -> None: ...
    async def get_key(self, user_id: str, mission_id: str) -> bytes | None: ...
    async def keys_of(self, user_id: str) -> dict[str, bytes]: ...
    async def delete_keys(self, user_id: str) -> int: ...
    async def sample(self, user_id: str) -> bytes | None:
        """One stored blob, exactly as an operator would see it (the Privacy Proof panel)."""
        ...


class MemoryVaultStore:
    def __init__(self) -> None:
        self.blobs: dict[tuple[str, str, str], bytes] = {}
        self.keys: dict[tuple[str, str], bytes] = {}

    async def put(self, user_id: str, mission_id: str, name: str, blob: bytes) -> None:
        self.blobs[(user_id, mission_id, name)] = blob

    async def get(self, user_id: str, mission_id: str, name: str) -> bytes | None:
        return self.blobs.get((user_id, mission_id, name))

    async def put_key(self, user_id: str, mission_id: str, wrapped: bytes) -> None:
        self.keys[(user_id, mission_id)] = wrapped

    async def get_key(self, user_id: str, mission_id: str) -> bytes | None:
        return self.keys.get((user_id, mission_id))

    async def keys_of(self, user_id: str) -> dict[str, bytes]:
        return {m: k for (u, m), k in self.keys.items() if u == user_id}

    async def sample(self, user_id: str) -> bytes | None:
        return next((b for (u, _, _), b in self.blobs.items() if u == user_id), None)

    async def delete_keys(self, user_id: str) -> int:
        mine = [k for k in self.keys if k[0] == user_id]
        for k in mine:
            del self.keys[k]
        return len(mine)


class Vault:
    def __init__(self, store: VaultStore, *, new_data_key: Callable[[], bytes] = new_key) -> None:
        self.store, self.new_data_key = store, new_data_key

    async def put(
        self, k_user: bytes, user_id: str, mission_id: str, name: str, plaintext: bytes
    ) -> None:
        wrapped = await self.store.get_key(user_id, mission_id)
        if wrapped is None:
            data_key = self.new_data_key()
            await self.store.put_key(
                user_id, mission_id, wrap(k_user, data_key, user_id, mission_id)
            )
        else:
            data_key = unwrap(k_user, wrapped, user_id, mission_id)
        sealed = seal(data_key, plaintext, aad(user_id, mission_id))
        await self.store.put(user_id, mission_id, name, sealed)

    async def get(self, k_user: bytes, user_id: str, mission_id: str, name: str) -> bytes:
        wrapped, blob = (
            await self.store.get_key(user_id, mission_id),
            await self.store.get(user_id, mission_id, name),
        )
        if wrapped is None or blob is None:
            raise CannotOpen("nothing readable is stored here")
        return open_(unwrap(k_user, wrapped, user_id, mission_id), blob, aad(user_id, mission_id))

    async def rotate(self, old: bytes, new: bytes, user_id: str) -> int:
        """A new K_user: every data key is rewrapped; no data is re-encrypted."""
        rewrapped = {
            m: rewrap(old, new, w, user_id, m)
            for m, w in (await self.store.keys_of(user_id)).items()
        }
        for mission_id, wrapped in rewrapped.items():
            await self.store.put_key(user_id, mission_id, wrapped)
        return len(rewrapped)

    async def shred(self, user_id: str) -> int:
        """ "Forget me": without the wrapped keys the ciphertext can never be opened again."""
        return await self.store.delete_keys(user_id)
