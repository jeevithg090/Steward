"""Write the transparency allowlist from `docker buildx build --metadata-file` outputs (S8.6).

    python deploy/transparency/write_allowlist.py worker.json gateway.json > allowlist.json

CI then signs it (`cosign sign-blob`) and checks the signature before any deploy.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def allowlist(metadata: list[dict[str, Any]], git_sha: str, built_at: datetime) -> dict[str, Any]:
    images = [
        {
            "name": m["image.name"].split(",")[0].rsplit(":", 1)[0],
            "digest": m["containerimage.digest"],
        }
        for m in metadata
    ]
    return {"images": images, "git_sha": git_sha, "built_at": built_at.isoformat()}


def main(paths: list[str]) -> None:
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True)  # noqa: S607
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))  # the commit time: reproducible
    metadata = [json.loads(Path(p).read_text()) for p in paths]
    document = allowlist(metadata, sha.stdout.strip(), datetime.fromtimestamp(epoch, UTC))
    sys.stdout.write(json.dumps(document, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
