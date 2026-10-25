#!/usr/bin/env bash
# Start (or restart) the iCTRL runner on the user's iPhone, detached. Needed after the phone reboots.
# Phone must be unlocked, on the same Wi-Fi (or cabled), with Developer Mode + Settings > Developer >
# Enable UI Automation on. Then on the phone: long-press "iCTRL Server Ready" > Enable Remote Access.
# The pairing key stays valid (~/.ictrl/token.json), so no re-pairing is needed.
# Free Apple ID: the app expires 7 days after it was built (24 Oct 2026) -> rebuild with Xcode after that.
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd "$(dirname "$0")/iCTRL"
UDID=$(xcodebuild -showdestinations -project iCTRL.xcodeproj -scheme iCTRL 2>/dev/null \
  | grep -E "platform:iOS, arch:arm64, id:[0-9A-F-]+, name:" | grep -v Placeholder | head -1 | sed -E 's/.*id:([0-9A-Fa-f-]+),.*/\1/')
[ -n "$UDID" ] || { echo "iPhone not visible to Xcode: unlock it, same Wi-Fi or cable, Developer Mode on."; exit 1; }
pkill -f "xcodebuild test-without-building -xctestrun" 2>/dev/null || true
nohup xcodebuild test-without-building -xctestrun "$(ls build/Build/Products/*.xctestrun | head -1)" \
  -destination "id=$UDID" > ../runner.log 2>&1 < /dev/null &
disown || true
for _ in $(seq 1 40); do grep -qE "server ready|not trusted|TEST EXECUTE FAILED" ../runner.log 2>/dev/null && break; sleep 2; done
grep -qE "server ready" ../runner.log && echo "iCTRL server ready on the iPhone. Turn on Remote Access from its notification." \
  || { echo "Runner didn't start:"; grep -E "rror|ailed|trusted" ../runner.log | sort -u | head -5; exit 1; }
