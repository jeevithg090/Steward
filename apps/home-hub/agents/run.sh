#!/usr/bin/env bash
# Start Tempo's agents service (document/letter interpreter and friends) on 127.0.0.1:8789, loopback only.
# Phones reach it through voice/token_server.py (/voice/agents/*), which checks the phone key first.
# Uses the hub's virtualenv (../.venv, Python 3.12). No access log: requests carry photos of personal letters.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo "Run ./run.sh (the hub) once first: it creates .venv."; exit 1
fi
.venv/bin/python -c 'import google.genai, PIL' 2>/dev/null || {
  if command -v uv >/dev/null 2>&1; then uv pip install --python .venv/bin/python -r agents/requirements.txt
  else .venv/bin/python -m pip install -q -r agents/requirements.txt; fi
}
mkdir -p agents/data && chmod 700 agents/data
exec .venv/bin/uvicorn agents.server:app --host 127.0.0.1 --port "${TEMPO_AGENTS_PORT:-8789}" --no-access-log --no-proxy-headers
