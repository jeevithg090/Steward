#!/bin/sh
# One-time setup inside the on-phone sandbox (OpenMinis: Alpine Linux). Installs Python if needed and makes the
# payee book folder. Pairing with the iCTRL runner happens on the first run (the person taps Allow on the phone).
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Installing Python 3 (apk)..."
  apk add --no-cache python3 >/dev/null
fi
python3 -c 'import sys; assert sys.version_info >= (3, 9), "Python 3.9+ needed"; print("python", sys.version.split()[0], "ok")'
mkdir -p "$HOME/.kairos" "$HOME/.ictrl"
chmod 700 "$HOME/.kairos"
# The demo payee book is written on the first run if none exists. Check the runner is there:
if wget -q -O - --timeout=3 http://127.0.0.1:8200/whoami >/dev/null 2>&1 || curl -s -m 3 http://127.0.0.1:8200/whoami >/dev/null 2>&1; then
  echo "iCTRL runner: reachable on 127.0.0.1:8200"
else
  echo "iCTRL runner: NOT reachable. Start it on this iPhone first (its 'iCTRL Server Ready' notification)."
fi
echo "Setup done. Try: bash scripts/run.sh \"what's my balance\""
