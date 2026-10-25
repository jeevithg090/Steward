#!/usr/bin/env python3
"""Give the agents service its own device in the hub, the owner's way (file access to the hub's database, like
scripts/device_admin.py). The hub only lets a device join by itself while an 'Add a device now' window is open,
so this is how the letter reader joins on the hub computer:

    .venv/bin/python agents/scripts/join_hub.py            # creates "Kairos letter reader" once (idempotent)
    .venv/bin/python agents/scripts/join_hub.py --remove   # removes it (the hub keeps what it already remembered)

The token goes to agents/data/hub_device.json (mode 600) and is never printed. The device has a phone's rights
(it can write and read events); it runs on this Mac only and the service that uses it answers loopback only.
Its kind is "service", not "agent": the hub makes every kind=agent device ask-only, and this one must write.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HUB_DIR = HERE.parents[1]
sys.path.insert(0, str(HUB_DIR))
from hub import db  # noqa: E402
from agents.core.config import DATA_DIR  # noqa: E402
from agents.core.memory import DEVICE_NAME  # noqa: E402

TOKEN_FILE = DATA_DIR / "hub_device.json"


def main() -> int:
    db.init()
    person = db.owner()
    mine = [d for d in db.list_devices(person["id"]) if d["name"] == DEVICE_NAME and not d.get("removed")]
    stale = [d for d in mine if d.get("kind") != "service"]  # an older run made it kind=agent, which can't write
    if "--remove" in sys.argv or stale:
        for d in (mine if "--remove" in sys.argv else stale):
            db.remove_device(person["id"], d["id"])
            print(f"removed {d['id']} (kind={d.get('kind')})")
        TOKEN_FILE.unlink(missing_ok=True)
        if "--remove" in sys.argv:
            return 0
        mine = [d for d in mine if d not in stale]
    if mine and TOKEN_FILE.exists():
        print(f"{DEVICE_NAME} is already joined ({mine[0]['id']}); token file present. Nothing to do.")
        return 0
    dev = db.add_device(person["id"], DEVICE_NAME, "agents", "service", [], "owner-cli")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"device_id": dev["id"], "device_token": dev["token"]}, f)
    db.insert_events(person["id"], dev["id"], [{"kind": "device.joined", "class": "mission",
                     "payload": {"name": DEVICE_NAME, "platform": "agents", "kind": "service", "via": "owner-cli"}}],
                     source="hub", trust_level="hub")
    print(f"{DEVICE_NAME} joined as {dev['id']}. Token saved to {TOKEN_FILE} (not printed).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
