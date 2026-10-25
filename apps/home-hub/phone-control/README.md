# Phone control (demo only)

The phone agent (`apps/home-hub/phone/phone_agent.py`) drives the iPhone's screen through **iCTRL**
(https://github.com/OpenMinis/iCTRL, Apache-2.0), an XCUITest runner. It is not vendored here.

1. `git clone https://github.com/OpenMinis/iCTRL` and apply `iCTRL-xcode26.0.1-type-annotation.patch` (one type annotation so it builds with Xcode 26.0.1).
2. Build and install it for your device (see iCTRL's README). On the phone: Developer Mode on, Settings > Developer > Enable UI Automation on, trust the developer certificate.
3. `start_ictrl.sh` (re)starts the runner after a reboot; then long-press "iCTRL Server Ready" > Enable Remote Access and pair once.

It needs Developer Mode and a Mac nearby, so it can't ship in the App Store. A shippable app acts through App Intents, Shortcuts, compose sheets and deep links instead.
