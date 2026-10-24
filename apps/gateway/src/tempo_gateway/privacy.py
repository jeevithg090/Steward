"""The Privacy Proof panel's facts (build plan S8.7): what is true of this deployment, each
checked rather than claimed."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from tempo_core.config import Profile
from tempo_crypto.allowlist import AllowlistInvalid, verify_allowlist
from tempo_crypto.vault import VaultStore
from tempo_gateway.mesh import Mesh


def signed_digests(transparency: Path) -> list[str] | None:
    """The allowlist's digests, only if its cosign signature verifies; None if there's none."""
    document, signature, key = (
        transparency / n for n in ("allowlist.json", "allowlist.json.sig", "cosign.pub")
    )
    if not (document.exists() and signature.exists() and key.exists()):
        return None
    try:
        return verify_allowlist(
            document.read_bytes(), signature.read_text().strip(), key.read_bytes()
        )
    except AllowlistInvalid:
        return []  # present but not trustworthy: treat as listing nothing


async def privacy_proof(
    user_id: str,
    *,
    deployment: Profile,
    image_digest: str | None,
    transparency: Path,
    mesh: Mesh | None,
    vault: VaultStore | None,
) -> dict[str, Any]:
    digests = signed_digests(transparency)
    sample = await vault.sample(user_id) if vault is not None else None
    holders = (
        [d.name for d in mesh.devices_of(user_id) if d.credential_id and d.active] if mesh else []
    )
    return {
        "mode": deployment.mode.value,
        "region": deployment.region,
        "third_parties": sorted(deployment.third_parties),
        "image_digest": image_digest,
        "allowlist": "missing" if digests is None else "signed",
        "image_allowlisted": bool(image_digest and digests and image_digest in digests),
        "key_held_on": holders,
        "operator_view": None
        if sample is None
        else {"table": "vault_blobs", "bytes": sample[:40].hex()},
        "canary_test": "tests/integration/test_canary.py, on every commit in CI",
        "attestation": "simulated (S8.8)"
        if deployment.mode.value == "cloud-confidential"
        else "n/a",
    }
