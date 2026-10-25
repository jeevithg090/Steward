#!/usr/bin/env python3
"""Make the shared secret the hub uses to check that WhatsApp messages really come from wacli on this computer.

    .venv/bin/python scripts/wacli_secret.py      # creates data/wacli.secret (mode 600) if it doesn't exist

Then start wacli with  --webhook-secret "$(cat data/wacli.secret)". The secret is never printed. It also keys the
pseudonyms that replace phone numbers, so making a new one (delete the file, run this again) changes them.
"""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hub import db  # noqa: E402


def main() -> None:
    path = db.DB_PATH.parent / "wacli.secret"
    if path.exists():
        print(f"{path} already exists (not shown). Delete it and run this again to make a new one.")
        return
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(secrets.token_hex(32) + "\n")
    print(f"Made {path} (mode 600, not shown). Use: --webhook-secret \"$(cat {path})\"")


if __name__ == "__main__":
    main()
