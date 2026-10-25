#!/usr/bin/env python3
"""The only thing the iPhone's SSH key may run on this Mac (forced command in ~/.ssh/authorized_keys).

The iPhone Shortcut "Run Script Over SSH" sends one line, e.g.  ask Did anything happen with my train today?
sshd puts that line in SSH_ORIGINAL_COMMAND and runs this script instead of a shell. The line is parsed
here, never passed to a shell.

This is only a sandbox together with `restrict` on the key's line. `command=` alone still lets the key
forward ports (ssh -N -L ...), which would reach the hub from loopback. The line must be:
  restrict,command="/usr/bin/python3 /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-hub/phone/tempo_ssh.py" ssh-ed25519 AAAA... iphone-tempo
(`restrict` turns off port/agent/X11 forwarding and the PTY.) With password logins off in sshd (see
phone/README or the shared notes), this key is the only way in.

Commands:
  ask <question>     ask the Tempo hub (local model); prints only the answer, for "Speak Text"
  status             is the hub up
  mission <request>  placeholder for Milestone 2 (background agents); says it isn't built yet
  help

It acts as the hub device "iPhone (SSH Shortcut)". That device is ask-only (capability 'ask': /api/ask and
/api/me, no vault data in answers). Its token is in phone/.device_token (chmod 600). Loopback requests no
longer join the hub by themselves, so if the device is removed it can only re-join while "Add a device now"
is open in the hub. To cut the shortcut off: remove the device in the hub, or delete the key's line in
~/.ssh/authorized_keys.
Stdlib only (runs on macOS's /usr/bin/python3 3.9).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
HUB = os.environ.get("TEMPO_HUB_URL", "http://127.0.0.1:8787")
TOKEN_FILE = HERE / ".device_token"
LOG = HERE / "ssh.log"
DEVICE_NAME = "iPhone (SSH Shortcut)"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def log(verb: str, status: str) -> None:
    # Verb and outcome only: questions are personal and already live in the hub, not in a log file.
    try:
        with LOG.open("a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {verb} {status}\n")
    except OSError:
        pass


def call(method: str, path: str, body=None, token=None, timeout=40):
    req = urllib.request.Request(HUB + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def device_token(fresh: bool = False) -> str:
    if not fresh and TOKEN_FILE.exists():
        return TOKEN_FILE.read_text().strip()
    dev = call("POST", "/api/devices/register",
               {"name": DEVICE_NAME, "platform": "ios", "kind": "phone", "capabilities": ["ask"]})
    TOKEN_FILE.write_text(dev["device_token"])
    TOKEN_FILE.chmod(0o600)
    return dev["device_token"]


def ask(question: str) -> str:
    try:
        res = call("POST", "/api/ask", {"question": question}, device_token())
    except urllib.error.HTTPError as e:
        if e.code != 401:  # 401: the device was removed in the hub, so join again once
            raise
        res = call("POST", "/api/ask", {"question": question}, device_token(fresh=True))
    return (res.get("answer") or "Tempo had no answer.").strip()


def main() -> int:
    line = (os.environ.get("SSH_ORIGINAL_COMMAND") or " ".join(sys.argv[1:])).strip()
    verb, _, rest = line.partition(" ")
    verb, rest = verb.lower(), rest.strip()
    try:
        if verb == "ask" and rest:
            print(ask(rest))
        elif verb == "status":
            hello = call("GET", "/api/hello", timeout=5)
            print(f"Tempo hub is up ({hello.get('hub', 'Tempo')} {hello.get('version', '')}).")
        elif verb == "mission" and rest:
            print("Background missions aren't built yet. For now, try: ask " + rest)
        else:
            print("Say or type: ask <your question>. Other commands: status, help.")
            verb = "help" if verb == "help" else "refused"
        log(verb, "ok")
        return 0
    except urllib.error.HTTPError as e:
        log(verb, f"hub-{e.code}")
        if e.code in (403, 410):  # 410: the device was removed in the hub; 403: it couldn't re-join
            print("This shortcut isn't connected to Tempo any more. In the hub, tap 'Add a device now', then ask again.")
        else:
            print(f"Tempo hub said {e.code}. Check the hub on the Mac.")
    except (urllib.error.URLError, OSError, TimeoutError):
        log(verb, "hub-down")
        print("Can't reach the Tempo hub on the Mac. Is it running?")
    return 1


if __name__ == "__main__":
    sys.exit(main())
