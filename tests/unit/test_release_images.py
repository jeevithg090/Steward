"""Signed, reproducible images (S8.6): pinned by digest, and a signed allowlist."""

from __future__ import annotations

import base64
import importlib.util
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from tempo_crypto.allowlist import AllowlistInvalid, pinned, verify_allowlist

ROOT = Path(__file__).resolve().parents[2]
DIGEST = "sha256:" + "ab" * 32


def load(path: str) -> Any:
    spec = importlib.util.spec_from_file_location(Path(path).stem, ROOT / path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_deploy_config_pins_digest_not_tag() -> None:
    for dockerfile in (ROOT / "deploy").glob("*.Dockerfile"):
        bases = re.findall(r"^FROM\s+(\S+)", dockerfile.read_text(), re.MULTILINE)
        assert bases and all(pinned(b) for b in bases), f"{dockerfile.name}: {bases}"
    deploy = load("deploy/runpod/deploy.py")
    assert deploy.template_update("tpl1", f"registry.example/tempo-worker@{DIGEST}")["variables"][
        "input"
    ]["imageName"].endswith(DIGEST)
    with pytest.raises(SystemExit, match="by digest"):
        deploy.template_update("tpl1", "registry.example/tempo-worker:latest")
    ci = (ROOT / ".gitlab-ci.yml").read_text()
    assert "deploy/runpod/deploy.py" in ci and "@$DIGEST" in ci  # CI deploys the digest it built


def cosign_style(document: bytes) -> tuple[str, bytes, ec.EllipticCurvePrivateKey]:
    """Like `cosign sign-blob --key`: ECDSA P-256 over SHA-256, base64 DER."""
    key = ec.generate_private_key(ec.SECP256R1())
    signature = base64.b64encode(key.sign(document, ec.ECDSA(hashes.SHA256()))).decode()
    pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return signature, pem, key


def test_allowlist_signature_verifies() -> None:
    document = json.dumps(
        {"images": [{"name": "tempo-worker", "digest": DIGEST}], "git_sha": "abc"}
    ).encode()
    signature, pem, _ = cosign_style(document)
    _, other_pem, _ = cosign_style(document)

    assert verify_allowlist(document, signature, pem) == [DIGEST]
    with pytest.raises(AllowlistInvalid, match="signature"):
        verify_allowlist(document.replace(b"ab", b"cd"), signature, pem)  # a digest swapped in
    with pytest.raises(AllowlistInvalid, match="signature"):
        verify_allowlist(document, signature, other_pem)
    tag_only = json.dumps({"images": [{"name": "tempo-worker", "digest": "latest"}]}).encode()
    tag_signature, tag_pem, _ = cosign_style(tag_only)
    with pytest.raises(AllowlistInvalid, match="digests"):
        verify_allowlist(tag_only, tag_signature, tag_pem)


def test_allowlist_needs_an_ecdsa_cosign_key() -> None:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    pem = (
        Ed25519PrivateKey.generate()
        .public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    )
    with pytest.raises(AllowlistInvalid, match="P-256"):
        verify_allowlist(b"{}", "", pem)


def test_allowlist_is_written_from_build_metadata() -> None:
    writer = load("deploy/transparency/write_allowlist.py")
    metadata = [
        {
            "image.name": "registry.example/tempo-worker:v1,registry.example/tempo-worker:latest",
            "containerimage.digest": DIGEST,
        },
        {
            "image.name": "registry.example/tempo-gateway:v1",
            "containerimage.digest": "sha256:" + "cd" * 32,
        },
    ]

    document = writer.allowlist(metadata, "abc123", datetime(2026, 10, 24, tzinfo=UTC))

    assert document == {
        "images": [
            {"name": "registry.example/tempo-worker", "digest": DIGEST},
            {"name": "registry.example/tempo-gateway", "digest": "sha256:" + "cd" * 32},
        ],
        "git_sha": "abc123",
        "built_at": "2026-10-24T00:00:00+00:00",
    }
