#!/usr/bin/env bash
# Start the Tempo hub. Creates the virtualenv on first run (uv if installed, else python3 >= 3.10).
# No access log: app URLs carry ?key=..., which must not end up in logs or on a projected terminal.
set -euo pipefail
umask 077  # the database, logs and backups it creates are readable by this user only
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.12 .venv
  else
    python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null || {
      echo "Tempo needs Python 3.10 or newer (macOS ships 3.9). Install uv (brew install uv) or a newer python3."; exit 1; }
    python3 -m venv .venv
  fi
fi
if [ ! -x .venv/bin/uvicorn ]; then  # also repairs an install that was interrupted
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python .venv/bin/python -r requirements.txt
  else
    .venv/bin/python -m pip install -q -r requirements.txt
  fi
fi
mkdir -p data && chmod 700 data 2>/dev/null || true  # the life log and its backups: this user only
# Kairos server settings (KAIROS_SERVER_MODE, KAIROS_LOCAL_MODELS, TEMPO_LLM_*): data/kairos.env if present, so
# whoever restarts the hub gets the same settings. Secrets for providers stay in voice/.env and agents/.env (read by
# the hub, never printed). Kill switches (KAIROS_KILL_VOICE / KAIROS_KILL_SEND=1) work live from voice/.env.
if [ -f "${KAIROS_ENV:-data/kairos.env}" ]; then set -a; . "${KAIROS_ENV:-data/kairos.env}"; set +a; fi
exec .venv/bin/uvicorn hub.main:app --host 0.0.0.0 --port "${TEMPO_PORT:-8787}" --no-access-log --no-proxy-headers
