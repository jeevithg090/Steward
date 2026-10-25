#!/usr/bin/env bash
# Saves the Gemini API key from the CLIPBOARD into agents/.env (gitignored, chmod 600).
# Nothing is typed, nothing is shown, nothing lands in shell history. The clipboard is cleared afterwards.
# Usage: in Google AI Studio click "Copy" next to the key, then run this script. Then restart agents/run.sh.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
raw="$(pbpaste)"
key="$(printf '%s' "$raw" | tr -d "[:space:]\"'")"
# Older AI Studio keys start with AIza; since 28 May 2026 new keys are "auth keys" with a different shape.
# Accept any single token of key characters, 30-200 long. Never print it.
words="$(printf '%s' "$raw" | wc -w | tr -d ' ')"
if [ "$words" != "1" ] || ! [[ "$key" =~ ^[A-Za-z0-9._~-]{30,200}$ ]]; then
  echo "The clipboard holds ${#raw} characters in ${words} word(s), which doesn't look like a Gemini key."
  echo "In AI Studio, click Copy next to the key (just the key), then run this again. Nothing saved."
  exit 1
fi
KEY="$key" awk 'BEGIN{done=0} /^GEMINI_API_KEY=/{print "GEMINI_API_KEY=" ENVIRON["KEY"]; done=1; next} {print} END{if(!done) print "GEMINI_API_KEY=" ENVIRON["KEY"]}' .env > .env.tmp
mv .env.tmp .env
chmod 600 .env
printf '' | pbcopy
echo "Saved to agents/.env (ends in ...${key: -4}). Clipboard cleared. Restart the agents service: agents/run.sh"
