#!/usr/bin/env bash
# Assemble the OpenMinis skill folder: tempo-hub/dist/kairos-navigator/ (+ .zip). Import it into the Minis app on the
# iPhone (Skills > import a folder; share the zip to the phone with AirDrop or Files).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../dist/kairos-navigator"
rm -rf "$OUT" && mkdir -p "$OUT/scripts/navigator/skills" "$OUT/scripts/data"
cp "$HERE/minis-skill/SKILL.md" "$OUT/"
cp "$HERE/minis-skill/scripts/"*.sh "$OUT/scripts/"
cp "$HERE/"*.py "$OUT/scripts/navigator/"
cp "$HERE/skills/"*.json "$OUT/scripts/navigator/skills/"
cp "$HERE/../../phone-control/iCTRL/Scripts/ictrl_rpc.py" "$OUT/scripts/navigator/"
cp "$HERE/README.md" "$OUT/scripts/navigator/README.md"
rm -f "$OUT/scripts/navigator/build_minis_skill.sh"
chmod +x "$OUT/scripts/"*.sh
( cd "$OUT/.." && rm -f kairos-navigator.zip && zip -qr kairos-navigator.zip kairos-navigator )
echo "skill folder: $OUT"
echo "zip:          $OUT.zip  ($(du -h "$OUT.zip" | cut -f1))"
