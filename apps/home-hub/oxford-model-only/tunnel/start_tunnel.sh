#!/usr/bin/env bash
# Start the public HTTPS tunnel to the Tempo hub (port 8787) for the ElevenLabs voice agent, in its own
# session so it outlives this terminal. Uses the ngrok account already configured on this Mac (its free
# static domain, so the URL stays the same). Prints the public URL of THIS agent.
#
# Safety, always:
#   --traffic-policy-file elevenlabs-policy.yml  only POST /api/ask and GET /api/hello are public,
#                                                bodies > 64 KB get 413, /api/ask is rate-limited
#   --inspect=false                              ngrok's local inspector (127.0.0.1:4040) records nothing,
#                                                so hub tokens and answers are never stored there
# Reuse: a running agent is kept ONLY if its command line is exactly the one below and it started after
# the policy file was last changed (ngrok reads the policy once, at start). Any other ngrok agent for port
# 8787 is stopped, and the script waits until it has really exited. It refuses (exit 1, touching nothing)
# if the phone-voice tunnel (ngrok-voice.yml) or an unrelated ngrok agent is running.
# Stop it:  kill "$(pgrep -fx 'ngrok http 8787 --traffic-policy-file .*')"   (or: pkill -x ngrok)
set -euo pipefail
cd "$(dirname "$0")"
POLICY="$PWD/elevenlabs-policy.yml"
LOG="$HOME/Library/Logs/tempo-ngrok.log"
PREFIX="ngrok http 8787 --traffic-policy-file $POLICY --inspect=false"
PORT_RE='(^|[[:space:]])((https?://)?(localhost|127\.0\.0\.1|0\.0\.0\.0)?:)?8787([[:space:]]|$)'

started() {  # process start time, epoch seconds (0 if unknown)
  local lt; lt="$(ps -o lstart= -p "$1" 2>/dev/null | sed 's/  */ /g; s/ *$//')" || true
  date -j -f '%a %b %e %T %Y' "$lt" +%s 2>/dev/null || echo 0
}
policy_mtime() { stat -f %m "$POLICY"; }

# Pass 1: classify every real ngrok binary; change nothing yet.
reuse=""; stop=""
for pid in $(pgrep -x ngrok || true); do
  args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
  rest="${args#"$PREFIX"}"; rest="${rest# --log }"
  case "$args" in
    "") ;;  # vanished meanwhile
    *ngrok-voice.yml*)
      echo "The phone-voice tunnel is running (pid $pid). Leaving everything alone; stop it first to use this one."
      exit 1 ;;
    "$PREFIX"|"$PREFIX --log "*)
      if [[ "$rest" != *" "* ]] && [ -z "$reuse" ] && [ "$(started "$pid")" -gt "$(policy_mtime)" ]; then
        reuse="$pid"
      else
        stop="$stop $pid"  # duplicate, extra flags, or started before the policy changed
      fi ;;
    *)
      if [[ "$args" =~ $PORT_RE ]]; then
        stop="$stop $pid"
      else
        echo "Another ngrok agent is running (pid $pid: ${args%% --*} ...). Free ngrok plans allow one agent;"
        echo "stop it yourself first. Nothing was changed."
        exit 1
      fi ;;
  esac
done

# Pass 2: stop the unsafe or stale agents and wait until they have really exited.
for pid in $stop; do
  echo "Stopping ngrok pid $pid: not started exactly with the current Tempo policy and inspection off."
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  if kill -0 "$pid" 2>/dev/null; then echo "ngrok pid $pid did not exit; not starting a second agent."; exit 1; fi
done

if [ -n "$reuse" ]; then
  agent="$reuse"
  echo "Tunnel already running with the current policy and inspection off (pid $agent):"
else
  # New session (setsid) so a Ctrl-C here or a killed parent process group can't take the tunnel down.
  nohup /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec { "ngrok" } @ARGV or die "ngrok: $!\n"' \
    ngrok http 8787 --traffic-policy-file "$POLICY" --inspect=false --log "$LOG" >/dev/null 2>&1 < /dev/null &
  agent=$!
  disown || true
fi

# Wait for THIS agent's tunnel to 8787 and print its URL (never another agent's).
url=""
for _ in $(seq 1 60); do
  kill -0 "$agent" 2>/dev/null || { echo "ngrok exited during start-up. Last log lines:"; tail -5 "$LOG"; exit 1; }
  out="$(curl -sf -m 1 http://127.0.0.1:4040/api/tunnels || true)"
  url="$(printf '%s' "$out" | /usr/bin/python3 -c 'import json,sys
try: ts = json.load(sys.stdin)["tunnels"]
except Exception: ts = []
print(next((t["public_url"] for t in ts if t.get("config", {}).get("addr", "").endswith(":8787")
            and t.get("config", {}).get("inspect") is False), ""))' 2>/dev/null || true)"
  [ -n "$url" ] && break
  sleep 0.5
done
[ -n "$url" ] || { echo "No tunnel came up in 30 s; see $LOG"; exit 1; }
echo "$url"
