#!/usr/bin/env bash
# Keep WhatsApp (wacli linked device) flowing into the Tempo hub, detached from this terminal.
# Each new message is POSTed to the hub's loopback-only /api/ingest/whatsapp, signed with data/wacli.secret.
# The hub stores it as vault class with phone numbers pseudonymised; voice/ask-only devices never see it.
# Pair first (once, by the user):  WACLI_SYNC_MAX_DB_SIZE=500MB wacli auth --history-days 7
# Stop:  pkill -f "wacli sync --follow"      Unlink: WhatsApp > Settings > Linked devices > Log out
set -euo pipefail
cd "$(dirname "$0")/.."   # tempo-hub
LOG="$HOME/Library/Logs/tempo-wacli.log"

if pgrep -f "wacli sync --follow" >/dev/null; then echo "WhatsApp sync is already running."; exit 0; fi
[ -s data/wacli.secret ] || { echo "No data/wacli.secret: ask the hub owner (scripts/wacli_secret.py)."; exit 1; }
KEY=$(.venv/bin/python -c "from hub import db; db.init(); print(db.owner()['ingest_key'])")

nohup wacli sync --follow --presence-mode quiet --max-db-size 500MB --max-reconnect 0 --stale-threshold 2m --webhook-allow-private \
  --webhook "http://127.0.0.1:8787/api/ingest/whatsapp?key=$KEY" --webhook-secret "$(cat data/wacli.secret)" \
  >> "$LOG" 2>&1 < /dev/null &
disown || true
sleep 3
if pgrep -f "wacli sync --follow" >/dev/null; then
  echo "WhatsApp sync running (log: $LOG)."
else
  echo "WhatsApp sync stopped straight away. Last log lines:"; tail -5 "$LOG"; exit 1
fi
