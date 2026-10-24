"""Write fixtures/crypto/release_vector.json: a signed worker report and its test-only keys, so
the device code (apps/web/lib/release.ts) is checked against the Python side (S8.4).

    uv run python scripts/make_release_vector.py
"""

from __future__ import annotations

import json
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from tempo_crypto.envelope import new_key
from tempo_crypto.worker_identity import RAW, WorkerReport, b64, sign_report

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "crypto" / "release_vector.json"


def main() -> None:
    deploy, worker = Ed25519PrivateKey.generate(), X25519PrivateKey.generate()
    report = WorkerReport(
        image_digest="sha256:" + "e" * 64,
        ephemeral_pub=b64(worker.public_key().public_bytes(*RAW)),
        nonce="vector-nonce-1",
        issued_at="2026-10-24T19:00:00+00:00",
    )
    vector = {
        "note": "TEST ONLY: throwaway keys for an interop test; never used anywhere else",
        "deploy_pub": b64(deploy.public_key().public_bytes(*RAW)),
        "signed_report": sign_report(report, deploy).to_json(),
        "worker_private": b64(worker.private_bytes_raw()),
        "data_key": b64(new_key()),
        "user_id": "u_margaret", "mission_id": "m_1", "step": "file_claim",
    }  # fmt: skip
    OUT.write_text(json.dumps(vector, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
