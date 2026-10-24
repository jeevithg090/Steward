# Tempo signal node for Android (build plan S5.3, P2)

A tiny app that reads notifications **on the phone** (Android's NotificationListenerService,
which the person switches on in Settings) and checks each one against the skills' filters
(`skills/*/signals.yaml`, fetched from the Gateway's `GET /mesh/signals`). Only a matching
notification's declared fields (for rail: time, origin, destination, minutes late) are sent to
`POST /mesh/signals`; the notification itself never leaves the phone. Every send is written to
a privacy log on the phone: what left, when, and for which skill.

`SignalFilter.kt` mirrors `tempo_core.signals`; both are tested against
`fixtures/signals/notifications.json`.

**Not built here.** This machine has no JDK or Android SDK, so the app hasn't been compiled or
run yet. To build and test:

```bash
cd apps/android-signal
gradle wrapper && ./gradlew test assembleDebug   # needs JDK 17 and the Android SDK
```

Then install the debug APK, pair it as a device with the `notifications.read` capability
(Mission Control → Your devices), paste its token, and allow notification access. Manual
check: a fake "GWR: 08:12 delayed 34 min" notification shows an approval prompt on the phone
that can approve.
