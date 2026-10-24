#!/bin/sh
# Tempo in Local mode (build plan S8.7): check what will run, then start it on this machine.
# A released Gateway image (TEMPO_GATEWAY_IMAGE=registry/tempo-gateway@sha256:...) must carry a
# cosign signature that verifies with deploy/transparency/cosign.pub; otherwise nothing starts.
set -eu
cd "$(dirname "$0")/../.."

: "${TEMPO_API_TOKEN:?set TEMPO_API_TOKEN (any long random string; Mission Control uses it)}"
if [ -n "${TEMPO_GATEWAY_IMAGE:-}" ]; then
  case "$TEMPO_GATEWAY_IMAGE" in
    *@sha256:*) ;;
    *) echo "TEMPO_GATEWAY_IMAGE must name a digest (image@sha256:...), not a tag." >&2; exit 1 ;;
  esac
  command -v cosign >/dev/null || { echo "Install cosign to verify the image first." >&2; exit 1; }
  cosign verify --key deploy/transparency/cosign.pub "$TEMPO_GATEWAY_IMAGE" >/dev/null
  echo "Signature verified: $TEMPO_GATEWAY_IMAGE"
  docker compose -f deploy/local/docker-compose.local.yml up -d --no-build
else
  echo "No released image given: building the Gateway from this checkout."
  docker compose -f deploy/local/docker-compose.local.yml up -d --build
fi
docker compose -f deploy/local/docker-compose.local.yml run --rm --entrypoint alembic gateway upgrade head
echo "Tempo is running on http://127.0.0.1:8000 (Local mode: the model runs on this machine)."
