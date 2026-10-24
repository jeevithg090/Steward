"""An ephemeral mission worker (build plan S8.4, S8.6).

At boot it makes a one-time X25519 key pair and a report signed with the deploy key (a RunPod
secret), naming the image digest it was deployed as. A device that trusts the report releases
one step's data key to it; the worker opens the state in memory, runs the step, re-seals it,
then recycles its key pair, so a released key is good for exactly one step. It writes nothing
to disk and logs no requests.

Run: IMAGE_DIGEST=sha256:... DEPLOY_SIGNING_KEY=<base64url Ed25519 seed> python -m tempo_worker
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from tempo_crypto.worker_identity import EphemeralWorker, ReleaseRefused, b64, unb64

Program = Callable[[bytes], bytes]


class Step(BaseModel):
    wrapped_key: str
    context: str
    sealed_state: str
    state_aad: str


def file_claim(state: bytes) -> bytes:
    """The demo step: mark the sealed mission state as filed. Real workflow steps move in here."""
    data: dict[str, Any] = json.loads(state)
    data["state"] = "claim_filed"
    return json.dumps(data, sort_keys=True).encode()


def create_worker(
    image_digest: str,
    signer: Ed25519PrivateKey,
    *,
    program: Program = file_claim,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> FastAPI:
    app = FastAPI(title="Tempo worker", docs_url=None, redoc_url=None, openapi_url=None)
    current = {"worker": EphemeralWorker(image_digest, signer, now=now)}

    @app.get("/report")
    def report() -> dict[str, object]:
        return current["worker"].signed.to_json()

    @app.post("/step")
    def step(body: Step) -> dict[str, str]:
        worker = current["worker"]
        current["worker"] = EphemeralWorker(image_digest, signer, now=now)  # recycle: one step
        try:
            sealed = worker.run_step(
                unb64(body.wrapped_key), body.context.encode(), unb64(body.sealed_state),
                body.state_aad.encode(), program,
            )  # fmt: skip
        except ReleaseRefused as e:
            raise HTTPException(403, str(e)) from None
        return {"sealed_state": b64(sealed)}

    return app


def main() -> None:
    signer = Ed25519PrivateKey.from_private_bytes(unb64(os.environ["DEPLOY_SIGNING_KEY"]))
    app = create_worker(os.environ["IMAGE_DIGEST"], signer)
    uvicorn.run(app, host="0.0.0.0", port=8080, access_log=False, log_level="warning")  # noqa: S104 (in a container)
