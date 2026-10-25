#!/usr/bin/env bash
# Start, stop, restart or check Tempo's agents service (agents/run.sh on 127.0.0.1:8789), detached from this
# terminal. Log: ~/Library/Logs/tempo-agents.log (no request bodies are ever logged).
#   agents/service.sh start|stop|restart|status
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${TEMPO_AGENTS_PORT:-8789}"
LOG="$HOME/Library/Logs/tempo-agents.log"
pid() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }
stop() {
  local p; p="$(pid)"
  [ -z "$p" ] && { echo "agents service: not running"; return 0; }
  kill "$p"; for _ in $(seq 1 50); do kill -0 "$p" 2>/dev/null || break; sleep 0.2; done
  echo "agents service: stopped (pid $p)"
}
start() {
  [ -n "$(pid)" ] && { echo "agents service: already running (pid $(pid))"; return 0; }
  nohup /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec { $ARGV[0] } @ARGV or die "exec: $!\n"' "$PWD/agents/run.sh" >> "$LOG" 2>&1 < /dev/null &
  disown || true
  for _ in $(seq 1 40); do curl -sf -m 2 "http://127.0.0.1:$PORT/agents/health" >/dev/null 2>&1 && break; sleep 0.25; done
  status
}
status() {
  if out="$(curl -sf -m 3 "http://127.0.0.1:$PORT/agents/health" 2>/dev/null)"; then
    echo "agents service: up on 127.0.0.1:$PORT"
    printf '%s' "$out" | .venv/bin/python -c 'import sys,json; d=json.load(sys.stdin); print("  model:", "Gemini " + d["model"] if d["gemini_key_set"] else "no Gemini key -> local " + d["local_model"] + (" (loaded)" if d.get("local_loaded") else " (not loaded)")); print("  voice:", d["voice"], "| hub memory:", d["hub_memory"], "| agents:", ", ".join(d["agents"]))'
  else
    echo "agents service: down (log: $LOG)"; return 1
  fi
}
case "${1:-status}" in
  start) start ;; stop) stop ;; restart) stop; start ;; status) status ;;
  *) echo "usage: agents/service.sh start|stop|restart|status"; exit 2 ;;
esac
