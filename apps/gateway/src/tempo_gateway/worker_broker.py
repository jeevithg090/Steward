"""The control plane between a person's device and an ephemeral worker (build plan S8.4).

It carries a worker's signed report to the device and the device's wrapped key back to the
worker, with the step's sealed state. It never holds K_user, a data key or plaintext; every
payload it handles is kept in `handled`, so a test (and an audit) can check exactly that.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from tempo_crypto.worker_identity import EphemeralWorker, ReleaseRefused


class WorkerBroker:
    def __init__(
        self, launch: Callable[[], EphemeralWorker], program: Callable[[bytes], bytes]
    ) -> None:
        self.launch = launch  # boots a fresh worker (RunPod Serverless in Private mode)
        self.program = program  # the step code inside the signed worker image
        self.pending: dict[str, EphemeralWorker] = {}
        self.handled: list[bytes] = []

    def start_step(self) -> dict[str, Any]:
        worker = self.launch()
        step_id = uuid.uuid4().hex
        self.pending[step_id] = worker
        return {"step_id": step_id, "signed_report": worker.signed.to_json()}

    def finish_step(
        self,
        step_id: str,
        wrapped_key: bytes,
        context: bytes,
        sealed_state: bytes,
        state_aad: bytes,
    ) -> bytes:
        self.handled += [wrapped_key, context, sealed_state, state_aad]
        worker = self.pending.pop(step_id, None)
        if worker is None:
            raise ReleaseRefused("no worker is waiting for this step")
        result = worker.run_step(wrapped_key, context, sealed_state, state_aad, self.program)
        self.handled.append(result)
        return result
