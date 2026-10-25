"""Record Scam Shield's showcase answers from a real replay-mode Gateway (docs/scam-shield.md).

Writes apps/web/showcase/shield-{hmrc,grey,genuine,loan,status}.json: exactly what POST /scam/check
and GET /scam/shield answered, so the Vercel showcase (no Gateway) shows nothing invented. Re-run
after the model, the rules or the sandbox fixtures change.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "apps" / "web" / "showcase"
SAMPLES = {
    "hmrc": "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim",
    "grey": "Here is the link you asked for: rb.gy/4k2q",
    "genuine": "Your HSBC one-time passcode is 482913. Never share this code with anyone. "
    "Call 159.",
    "loan": "Congratulations! Instant loan of Rs 50,000 approved, no documents, no CIBIL. Pay "
    "processing fee 499 to get disbursal. Download the app: http://quick-rupee-loan.top/app.apk",
}


def main(tmp: Path) -> int:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True,
        tempo_api_token="showcase",  # noqa: S106  a demo token for an in-process Gateway
        checkpoint_dir=str(tmp / "cp"), mesh_file=str(tmp / "mesh.json"),
    )  # fmt: skip
    auth = {"Authorization": "Bearer showcase"}
    with TestClient(build(settings)) as client:
        for name, text in SAMPLES.items():
            body = client.post(
                "/scam/check", headers=auth, json={"text": text, "user_id": "u_margaret"}
            ).json()
            (OUT / f"shield-{name}.json").write_text(
                json.dumps(body, indent=1, ensure_ascii=False) + "\n"
            )
            print(f"shield-{name}.json: {body['level']} / {body['zone']}")
        status = client.get("/scam/shield", params={"user_id": "u_margaret"}, headers=auth).json()
        (OUT / "shield-status.json").write_text(
            json.dumps(status, indent=1, ensure_ascii=False) + "\n"
        )
        print(f"shield-status.json: {status['today']}")
    return 0


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        sys.exit(main(Path(tmp)))
