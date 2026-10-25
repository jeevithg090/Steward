# Tempo signal node for Android (build plan S5.3, P2; Scam Shield tier 1)

A small app that reads notifications **on the phone** (Android's NotificationListenerService,
which the person switches on in Settings) and checks each one against the skills' filters
(`skills/*/signals.yaml`, fetched from the Gateway's `GET /mesh/signals`). Only a matching
notification's declared fields leave the phone (`POST /mesh/signals`); the notification itself
never does. Every send is written to a privacy log on the phone: what left, when, for which skill.

## Scam Shield on the phone (docs/scam-shield.md)

For the `scam_text` signal the phone decides first, in milliseconds, with the same three gates the
Gateway uses: the keyword families (`SignalFilter.kt`), the link rules (`Links.kt`: a brand's
name inside a domain that is not the brand's, look-alike letters, shorteners, bare addresses, app
files) and the text model (`ScamModel.kt`, the same `model.json` the Gateway ships, fetched from
`GET /mesh/signals/model` and run here with no library).

- A plain trick (a keyword family or a pressure sign together with a doubtful link, a brand
  look-alike link, a request for a code, a "safe account") is spoken **now**, with the phone's own
  offline voice (`Speaker.kt`, Android TextToSpeech) in the language chosen in the app:
  *"Do not touch that message. It is a trick trying to take your money. Ring the firm on a number
  you already know."* A full-screen card (`ShieldActivity.kt`) shows the same words in the largest
  text, with three big buttons: **Read it again**, **I know this sender** (phone numbers only; a
  sender name like "HSBC" is exactly what a scammer spoofs, so it is refused), **I'm fine**.
- A doubtful message (a shortened link, a model score in the grey zone) is held: *"I'm checking
  that message. Don't tap anything in it yet."* Only four fields leave: `rules`, `sender_domain`,
  `link_hosts`, `score`. The Gateway's sandbox looks behind the link and sends back the words to
  say; the phone speaks them.
- Messages from trusted numbers and (with the optional READ_CONTACTS permission) from contacts are
  not checked. A genuine bank one-time code ("your code is 482913, never share it") matches no
  gate and leaves nothing.
- Android 15 hides one-time codes from untrusted notification listeners. The node never reads or
  needs the code; a *request* for a code is recognised from its words.

`SignalFilter.kt`, `Links.kt` and `ScamModel.kt` mirror `tempo_core.signals`, `tempo_core.links`
and `tempo_core.scam_model`; all are tested against the shared vectors in `fixtures/signals/`
(`notifications.json`, `scam_messages.json`, `model_vectors.json`, `scam_text.spec.json`).

**Not built here.** This machine has no JDK or Android SDK, so the app has not been compiled or
run. To build and test:

```bash
cd apps/android-signal
gradle wrapper && ./gradlew test assembleDebug   # needs JDK 17 and the Android SDK
```

Then install the debug APK, pair it as a device with the `notifications.read` capability
(Mission Control → Your devices), paste its token, choose a language, allow notification access,
and press **Hear the warning**. Manual check: a text from an unknown number reading "HMRC: you are
due a tax refund… http://hmrc-refunds-gov.uk/claim" makes the phone speak the warning and show the
card; "Here is the link you asked for: rb.gy/4k2q" makes it say "I'm checking that message" and
then the Gateway's verdict; a bank's genuine one-time code does nothing at all.
