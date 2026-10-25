#!/bin/sh
# Run the Kairos Navigator ON this phone: bank app through the iCTRL runner on loopback, approval card in Kairos.
# Usage: bash scripts/run.sh "send fifty pounds to my son for rent" [--mock] [--mode cop_mismatch]
set -eu
cd "$(dirname "$0")"
TEXT=""
EXTRA=""
for a in "$@"; do
  case "$a" in
    --approve) echo "refused: --approve is for tests only; the person approves on the Kairos card" >&2; exit 2 ;;
    --*) EXTRA="$EXTRA $a" ;;
    *) TEXT="$TEXT $a" ;;
  esac
done
export TEMPO_HUB_URL="${TEMPO_HUB_URL:-http://127.0.0.1:9}"   # no hub on the phone: the ledger stays local
# shellcheck disable=SC2086
exec python3 -m navigator $TEXT --phone "${ICTRL_HOST:-127.0.0.1:8200}" --card --port "${KAIROS_CARD_PORT:-8790}" \
  --book "$HOME/.kairos/payees.json" --pair-as kairos-navigator $EXTRA
