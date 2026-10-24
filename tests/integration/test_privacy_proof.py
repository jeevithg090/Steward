"""The Privacy Proof panel's facts (S8.7): checked by the Gateway, never just claimed."""

from __future__ import annotations

import base64
import json
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_crypto.envelope import new_key
from tempo_crypto.vault import MemoryVaultStore, Vault
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services
from tempo_gateway.mesh import Mesh

DIGEST = "sha256:" + "7" * 64
AUTH = {"Authorization": "Bearer t"}


def signed_allowlist(folder: Path, digests: list[str]) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    document = json.dumps(
        {"images": [{"name": "tempo-gateway", "digest": d} for d in digests]}
    ).encode()
    folder.mkdir(parents=True)
    (folder / "allowlist.json").write_bytes(document)
    (folder / "allowlist.json.sig").write_text(
        base64.b64encode(key.sign(document, ec.ECDSA(hashes.SHA256()))).decode()
    )
    pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    (folder / "cosign.pub").write_bytes(pem)


def gateway(
    tmp_path: Path, *, digest: str | None, mode: str = "cloud-private"
) -> tuple[TestClient, Mesh, MemoryVaultStore]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_deploy=mode, tempo_api_token="t",
        image_digest=digest, checkpoint_dir=str(tmp_path / "cp"),
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    mesh, store = Mesh(rp_id="localhost", origins=["http://localhost:3000"]), MemoryVaultStore()
    app = create_app(
        service,
        settings,
        bus,
        memory=memory,
        mesh=mesh,
        vault=store,
        transparency=tmp_path / "transparency",
    )
    return TestClient(app), mesh, store


async def test_privacy_proof_shows_digest_match_key_holder_and_ciphertext(tmp_path: Path) -> None:
    signed_allowlist(tmp_path / "transparency", [DIGEST])
    client, mesh, store = gateway(tmp_path, digest=DIGEST)
    phone, _ = mesh.add_device("u_margaret", "Margaret's iPhone", ["approve.biometric"])
    mesh._update(phone, credential_id="cred", public_key="pk")  # a passkey, as S5.2 registers it
    await Vault(store).put(new_key(), "u_margaret", "m_1", "capsule", b"Margaret, 14.20, BB-4417")

    proof = client.get("/privacy", params={"user_id": "u_margaret"}, headers=AUTH).json()

    assert proof["mode"] == "cloud-private" and proof["third_parties"] == []
    assert (proof["allowlist"], proof["image_allowlisted"]) == ("signed", True)
    assert proof["key_held_on"] == ["Margaret's iPhone"]
    shown = bytes.fromhex(proof["operator_view"]["bytes"])
    assert b"Margaret" not in shown and b"14.20" not in shown  # the operator sees ciphertext


def test_privacy_proof_is_honest_about_gaps(tmp_path: Path) -> None:
    client, _, _ = gateway(tmp_path, digest=None, mode="cloud-standard")

    proof = client.get("/privacy", params={"user_id": "u_margaret"}, headers=AUTH).json()

    assert proof["third_parties"] == ["cortex", "elevenlabs", "gemini"]
    assert (proof["allowlist"], proof["image_allowlisted"]) == ("missing", False)
    assert (proof["key_held_on"], proof["operator_view"]) == ([], None)
    assert client.get("/privacy", params={"user_id": "u_margaret"}).status_code == 401


def test_a_tampered_allowlist_lists_nothing(tmp_path: Path) -> None:
    signed_allowlist(tmp_path / "transparency", [DIGEST])
    document = tmp_path / "transparency" / "allowlist.json"
    document.write_bytes(document.read_bytes().replace(b"7777", b"8888"))
    client, _, _ = gateway(tmp_path, digest=DIGEST)

    proof = client.get("/privacy", params={"user_id": "u"}, headers=AUTH).json()

    assert (proof["allowlist"], proof["image_allowlisted"]) == ("signed", False)
