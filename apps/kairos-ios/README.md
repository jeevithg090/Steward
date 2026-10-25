# Kairos for iPhone

The native iPhone front end for the home hub (`apps/home-hub`): one big button, voice first, built for older people.

- **Voice:** ElevenLabs Conversational AI (elevenlabs-swift-sdk 3.4.0). The ElevenLabs key never reaches the phone: the hub mints a short-lived call token (`/api/voice/session` with the app's device token, or `/voice/token` with the phone key).
- **Write for me (Communications Bridge):** speak a message, the hub drafts it in the recipient's language, you check the card and tap Send, and WhatsApp, Messages or Mail opens with the exact approved text (`TempoApp/Bridge/`). Numbers stay on the phone; the server only sees `recipient_ref`.
- **In a call:** the agent's client tools `draft_message`, `deliver_message` and `cancel_message` drive the same card. The model never supplies the text or the recipient, and only the person's tap on the visible card can send.
- **Launch:** "Hey Siri, talk to Kairos", or Back Tap (Settings > Accessibility > Touch > Back Tap > Talk to Kairos).

## Build

```bash
brew install xcodegen
printf 'DEVELOPMENT_TEAM = <your team id>\nDEVELOPMENT_TEAM_LOWER = <team id in lowercase>\n' > Config/Local.xcconfig   # gitignored
xcodegen generate
xcodebuild -resolvePackageDependencies -project Tempo.xcodeproj -scheme Tempo -clonedSourcePackagesDirPath .build/spm
xcodebuild build -project Tempo.xcodeproj -scheme Tempo -destination 'id=<device udid>' \
  -clonedSourcePackagesDirPath .build/spm -derivedDataPath build -allowProvisioningUpdates
xcrun devicectl device install app --device <device id> build/Build/Products/Debug-iphoneos/Tempo.app
```

A free Apple ID works (the build expires after 7 days). Connect the app to the hub once with the setup link
(`apps/home-hub/scripts/device_admin.py app-link --copy`, then paste it into Safari on the phone). Links are only accepted
for first setup or when they carry the phone key already stored, so a link in a message can't re-point the app.
