#!/usr/bin/env python3
"""Local device admin for the hub owner (needs file access to the hub's database, i.e. this computer).

    .venv/bin/python scripts/device_admin.py list
    .venv/bin/python scripts/device_admin.py add-agent --name "ElevenLabs voice agent" --token-file voice/.hub_token
    .venv/bin/python scripts/device_admin.py remove d_XXXXXXXX
    .venv/bin/python scripts/device_admin.py vault d_XXXXXXXX on|off
    .venv/bin/python scripts/device_admin.py add-hands --name "Tempo hands (iPhone)" --token-file data/hands.token
    .venv/bin/python scripts/device_admin.py app-link --token-file data/kairos_app.token --copy

app-link builds the Kairos app's setup link (kairos://setup?k=<phone key>&u=<tunnel URL>&t=<device token>) and puts
it on the clipboard (--copy; paste it into Safari or Notes on the iPhone and tap it) and/or in a mode-600 file
(--file). It is never printed. The phone key and tunnel URL come from voice/.env.

add-agent creates an ASK-ONLY device (kind=agent, capabilities=['ask']): it can call /api/ask and /api/me,
never read events, keys or links, never administer, and never sees vault data. The token is written to
--token-file (mode 600) and is never printed, so it can't end up in a chat, terminal recording or log.

vault on lets one ask-only device's answers use private data (health, location, notification text, desktop).
For the voice agent that means those answers are spoken through ElevenLabs. Off by default; only this
script (the hub computer's owner) can grant it, never a device registering itself.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hub import db  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    add = sub.add_parser("add-agent")
    add.add_argument("--name", required=True)
    add.add_argument("--token-file", required=True)
    hands = sub.add_parser("add-hands")
    hands.add_argument("--name", required=True)
    hands.add_argument("--token-file", required=True)
    guard = sub.add_parser("add-guardian")  # the Guardian process: reads events, writes guardian.* (python -m guardian run does this itself)
    guard.add_argument("--name", default="Kairos Guardian")
    guard.add_argument("--token-file", default="data/guardian.token")
    appdev = sub.add_parser("add-device")  # the Kairos app (server mode): reads and asks, never administers
    appdev.add_argument("--name", required=True)
    appdev.add_argument("--token-file", required=True)
    applink = sub.add_parser("app-link")  # kairos://setup?k=&u=&t= for the iPhone app: clipboard or mode-600 file
    applink.add_argument("--token-file", default="data/kairos_app.token")
    applink.add_argument("--file")
    applink.add_argument("--copy", action="store_true")
    link = sub.add_parser("join-link")  # the owner's personal join link, written to a mode-600 file, never printed
    link.add_argument("--file", required=True)
    rm = sub.add_parser("remove")
    rm.add_argument("device_id")
    va = sub.add_parser("vault")
    va.add_argument("device_id")
    va.add_argument("state", choices=["on", "off"])
    args = ap.parse_args()

    db.init()
    person = db.owner()
    if args.cmd == "list":
        for d in db.list_devices(person["id"]):
            print(f"{d['id']}  {d['name']:<36} kind={d.get('kind')} via={d.get('joined_via')} caps={d.get('capabilities')}")
    elif args.cmd == "app-link":
        from urllib.parse import urlencode
        from hub import providers
        token = Path(args.token_file).read_text().strip() if Path(args.token_file).exists() else ""
        key, base = providers.env("TEMPO_PHONE_KEY"), (providers.env("TEMPO_PUBLIC_HUB_URL") or "").rstrip("/")
        if not token or not key or not base.startswith("https://"):
            print("Need the app's token file (add-device), plus TEMPO_PHONE_KEY and an https TEMPO_PUBLIC_HUB_URL in "
                  "voice/.env. Nothing written.")
            return
        if not (args.file or args.copy):
            print("Say where the link goes: --copy (clipboard) and/or --file PATH. It is never printed.")
            return
        url = "kairos://setup?" + urlencode({"k": key, "u": base, "t": token})
        if args.file:
            path = Path(args.file)
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(url + "\n")
            os.chmod(path, 0o600)
            print(f"Wrote the app's setup link to {path} (mode 600, not shown).")
        if args.copy:
            import subprocess
            subprocess.run(["pbcopy"], input=url.encode(), check=True)
            print("The app's setup link is on the clipboard (not shown). On the iPhone, paste it into Safari or Notes "
                  "and tap it; then clear the clipboard (copy something else).")
    elif args.cmd == "join-link":
        base = (os.environ.get("TEMPO_PUBLIC_URL") or "").rstrip("/")
        if not base:
            print("Set TEMPO_PUBLIC_URL (the tunnel's https URL) first: the link must work from anywhere.")
            return
        path = Path(args.file)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(f"{base}/join#t={person['join_token']}\n")
        os.chmod(path, 0o600)
        print(f"Wrote the personal join link to {path} (mode 600, not shown). Anyone with it can join: share it only "
              "with your own devices, and rotate it after the demo (POST /api/keys/rotate).")
    elif args.cmd in ("add-agent", "add-hands", "add-guardian", "add-device"):
        if args.cmd == "add-device":  # owner-cli isn't an admin join: the app reads and asks, never administers
            dev = db.add_device(person["id"], args.name, "kairos-app", "phone", ["web"], "owner-cli")
        elif args.cmd == "add-agent":
            dev = db.add_device(person["id"], args.name, "voice", "agent", ["ask"], "owner-cli")
        elif args.cmd == "add-guardian":  # reads the log, writes guardian.*; never administers
            dev = db.add_device(person["id"], args.name, "guardian", "guardian", ["guardian"], "owner-cli")
        else:  # write-only: POST /api/hands/log and /api/me, from this computer only
            dev = db.add_device(person["id"], args.name, "hands", "hands", ["hands"], "owner-cli")
        path = Path(args.token_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(dev["token"] + "\n")
        os.chmod(path, 0o600)
        what = {"add-agent": "ask-only", "add-hands": "hands-log-only", "add-guardian": "guardian",
                "add-device": "app (read/ask, not admin)"}[args.cmd]
        print(f"Created {what} device {dev['id']} ({args.name}); token written to {path} (mode 600, not shown).")
    elif args.cmd == "vault":
        c = db.conn()
        row = c.execute("SELECT capabilities FROM devices WHERE id=? AND person_id=? AND removed=0",
                        (args.device_id, person["id"])).fetchone()
        if not row:
            print("no such device")
            return
        caps = [x for x in json.loads(row["capabilities"] or "[]") if x != "vault"]
        if args.state == "on":
            caps.append("vault")
        c.execute("UPDATE devices SET capabilities=? WHERE id=?", (json.dumps(caps), args.device_id))
        c.commit()
        print(f"{args.device_id}: private data in its answers is now {args.state.upper()} (capabilities {caps})")
    elif args.cmd == "remove":
        ok = db.remove_device(person["id"], args.device_id)
        print("removed" if ok else "no such device")


if __name__ == "__main__":
    main()
