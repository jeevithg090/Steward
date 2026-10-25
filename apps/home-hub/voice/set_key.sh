#!/usr/bin/env bash
# Saves the ElevenLabs API key from the CLIPBOARD into .env (gitignored, chmod 600).
# Nothing is typed, nothing is shown, nothing lands in shell history. The clipboard is cleared afterwards.
# Usage: click "Copy" next to the new key in ElevenLabs, then run this script.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
key="$(pbpaste)"
key="${key//[[:space:]]/}"
key="${key//\"/}"
case "$key" in
  sk_*) ;;
  *) echo "The clipboard doesn't hold an ElevenLabs key (it should start with sk_). Copy the key in the dashboard, then run this again. Nothing saved."; exit 1 ;;
esac
KEY="$key" awk 'BEGIN{done=0} /^ELEVENLABS_API_KEY=/{print "ELEVENLABS_API_KEY=" ENVIRON["KEY"]; done=1; next} {print} END{if(!done) print "ELEVENLABS_API_KEY=" ENVIRON["KEY"]}' .env > .env.tmp
mv .env.tmp .env
chmod 600 .env
printf '' | pbcopy
echo "Saved to .env (ends in ...${key: -4}). Clipboard cleared. Now run check_key.sh"
