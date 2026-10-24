"""Point the RunPod worker template at a released image, by digest only (S8.6).

    RUNPOD_API_KEY=... python deploy/runpod/deploy.py <template-id> <registry/image@sha256:...>

(check) RunPod's GraphQL `saveTemplate` mutation and fields against the current API docs.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from typing import Any

API = "https://api.runpod.io/graphql"
PINNED = re.compile(r"^[^@\s]+@sha256:[0-9a-f]{64}$")  # as tempo_crypto.allowlist.pinned


def pinned(image_ref: str) -> bool:
    return bool(PINNED.match(image_ref))


def template_update(template_id: str, image_ref: str) -> dict[str, Any]:
    if not pinned(image_ref):
        raise SystemExit(
            f"refusing {image_ref!r}: deploy by digest (image@sha256:...), never a tag"
        )
    mutation = (
        "mutation($input: SaveTemplateInput) { saveTemplate(input: $input) { id imageName } }"
    )
    return {"query": mutation, "variables": {"input": {"id": template_id, "imageName": image_ref}}}


def main(template_id: str, image_ref: str) -> None:
    body = json.dumps(template_update(template_id, image_ref)).encode()
    auth = f"Bearer {os.environ['RUNPOD_API_KEY']}"
    headers = {"Content-Type": "application/json", "Authorization": auth}
    request = urllib.request.Request(API, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        print(response.read().decode())


if __name__ == "__main__":
    main(*sys.argv[1:3])
