# Kairos on iPhone: what a native app can and can't do (verified)

> Researched 24 Oct 2026 for an iPhone 12 Pro Max on iOS 26.5, in the UK, with a free Apple ID (paid noted where it matters).
> Five researchers each covered one area, and an adversarial fact-checker re-checked every verdict against sources (mostly Apple's own docs).
> Statuses: confirmed / corrected (the checker fixed details) / refuted. Platform rules change, so trust Apple's current docs over this page.

## Buttons, Siri and launching

### ❌ No — Replace Siri on long-press of the side button with Kairos, or get a Siri-or-Kairos choice, for a UK user
*Fact-check: confirmed*

**What's possible:** A third-party side-button option exists, but only in Japan. iOS 26.2 added AppSchema.AssistantIntent with the schema `.assistant.activate`. It requires the entitlement `com.apple.developer.side-button-access.allow` (named 'Side Button Access' in Xcode, iOS/iPadOS 26.2+). Apple's docs, as of Oct 2026, say it is 'only available on iPhone in Japan'. On a production device the Apple Account region must be Japan and the phone must physically be in Japan; region strings such as APP_NOT_AVAILABLE_FOR_SIDE_BUTTON_IN_REGION enforce this. Even in Japan the system has no 'Siri OR app' chooser. The user picks one default side-button app in Settings, and 'Hey Siri' stays Siri's. The Developer Program License Agreement §3.3.3(J)(iv) (Dec 2025) requires the app to open straight into a voice experience and to answer questions and carry out actions. That clause names no region, which press reads as a sign of wider rollout, but nothing has expanded as of 24 Oct 2026.

**How (for Kairos):** For the demo, use Siri plus an App Shortcut instead (see the other findings). To be ready for later: once on Xcode 26.2 or newer, add the Side Button Access capability and an intent `@AppIntent(schema: .assistant.activate) struct ActivateKairos { static let supportedModes: IntentModes = .foreground; func perform() async throws -> some IntentResult { /* go to talk scene + start AVAudioSession/ElevenLabs */ } }`. Gate it with `if #available(iOS 26.2, *)`. Apple's note 'During development, install your provisioning profile on your iPhone test device' might mean a development build can be tested outside Japan. That is unverified (low confidence) and would need a paid team.

**Limits:** Not available on iOS 26.5 in the UK. Needs the iOS 26.2+ SDK (Xcode 26.2+; the user has 26.0.1). For production: Japan account region plus physical presence. The portal-side App ID capability effectively needs a paid team. Even where available, there is no per-press Siri/Kairos chooser.

**Evidence:** Apple's AssistantIntent page (iOS/iPadOS/Mac Catalyst 26.2+) and the side-button article both say the feature is only for iPhone in Japan and needs com.apple.developer.side-button-access.allow. They say a production device needs the Apple Account region set to Japan and physical presence in Japan. The entitlement page is iOS 26.2+. Sources: https://developer.apple.com/documentation/appintents/appschema/assistantintent , https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.side-button-access.allow . Forum thread 808549: the original poster's accepted answer says the capability became available in Xcode 26.2 (https://developer.apple.com/forums/thread/808549). OpenMinis #466: the entitlement breaks signing until the portal capability is enabled (https://github.com/OpenMinis/OpenMinis/issues/466). A web search found no expansion beyond Japan as of Oct 2026. The driver is Japan's Mobile Software Competition Act.

**Sources:** <https://developer.apple.com/documentation/appintents/launching-your-voice-based-conversational-app-from-the-side-button-of-iphone> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.side-button-access.allow> · <https://developer.apple.com/documentation/appintents/appschema/assistantintent> · <https://developer.apple.com/forums/thread/808549> · <https://github.com/OpenMinis/OpenMinis/issues/466> · <https://9to5mac.com/2025/12/18/apple-updates-developer-agreement-with-new-privacy-rules/> · <https://www.macrumors.com/2025/11/17/ios-26-2-iphone-users-eu-siri-replacement/>

### ❌ No — Whether UK (CMA) or EU (DMA) rules give Kairos side-button or default-assistant access in 2026
*Fact-check: confirmed*

**What's possible:** UK: in Oct 2025 the CMA designated Apple as having Strategic Market Status (DMCCA). Apple's voluntary commitments were finalised on 1 Apr 2026. They cover app review, ranking, data use and a dedicated feedback channel where developers can ask for interoperable access to iOS features. That channel is open only to Developer Program members in good standing who are registered in the UK, and Apple keeps discretion over the answer. The only conduct requirements consulted on in 2026 are Steering (30 Jun, responses 14 Aug) and NFC access (consultation opened 20 Oct 2026). Nothing addresses Siri, default voice assistants or the side button. EU: no side-button or default-assistant choice has shipped. Instead Apple held back 'Siri AI' from iOS 27/iPadOS 27 in the EU, citing the DMA. It said the Commission rejected its 'Trusted System Agent' proposal for rival assistants, and the Commission says the delay is Apple's own choice. The UK is not in the EU, so the EU delay does not apply to this user, but no UK assistant choice exists either.

**How (for Kairos):** There is nothing to implement for the UK today. After moving to a paid, UK-registered Apple Developer Program team, Kairos could file an interoperability request for side-button / voice-assistant access through Apple's CMA commitments channel. Present this as roadmap or advocacy, not as a demo feature.

**Limits:** As of 24 Oct 2026. The UK channel needs a paid ADP membership registered in the UK, gives no guaranteed outcome and no timeline. It is roadmap/advocacy only and not demoable.

**Evidence:** The gov.uk case page lists these 2026 updates: 10 Feb proposed commitments; 1 Apr final commitments; 30 Jun Steering consultation and NFC call for evidence; 14 Aug Steering responses; 20 Oct NFC access consultation. None covers voice assistants, default apps or the side button (https://www.gov.uk/cma-cases/apples-mobile-platform). The commitments PDF opens the interoperability channel only to Developer Program members in good standing whose membership is registered in the UK, gives a status update within about 4 weeks, and leaves outcomes to Apple's discretion. The first report covers 1 Jan–30 Jun 2026 (https://www.apple.com/legal/dmcca/dmcca-commitments.pdf). In the EU newsroom post, Apple says it won't ship Siri AI on iOS/iPadOS 27 in the EU and that the Commission rejected its Trusted System Agent plan (https://www.apple.com/newsroom/2026/06/due-to-dma-siri-ai-delayed-in-eu-for-ios-27-and-ipados-27/).

**Sources:** <https://www.gov.uk/cma-cases/apples-mobile-platform> · <https://competitionandmarkets.blog.gov.uk/2026/02/10/improving-the-way-apple-and-google-deliver-app-store-services-and-enhancing-ios-interoperability-in-the-uk> · <https://www.apple.com/legal/dmcca/dmcca-commitments.pdf> · <https://www.apple.com/newsroom/2026/06/due-to-dma-siri-ai-delayed-in-eu-for-ios-27-and-ipados-27/> · <https://www.techtimes.com/articles/318136/20260610/eu-rejects-apple-siri-ai-exemption-commission-says-dma-never-blocked-launch.htm>

### ✅ Yes — Long-press side button → Siri → Kairos (the practical UK version)
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Two steps (hold the button or say 'Siri', then the phrase), and Siri speaks first. A locked phone needs a Face ID/passcode unlock before Kairos comes forward. Phrase recognition in en-GB for 'Kairos' must be tested on the device. Works on a free team.

**Evidence:** Apple's App Shortcuts docs say App Shortcuts are available as soon as someone installs the app, with no registration needed (https://developer.apple.com/documentation/appintents/app-shortcuts). WWDC23 10102 says all trigger phrases must contain the app name or an app-name synonym; it also covers Flexible Matching and the App Shortcuts Preview tool (https://developer.apple.com/videos/play/wwdc2023/10102/). Apple's capability table lists Siri for ADP/ADEP only, not for 'Apple Developer' (free) (https://developer.apple.com/help/account/reference/supported-capabilities-ios). The SiriKit synonyms doc gives the INAlternativeAppNames limit of 3 and the Intents-extension caveat (https://developer.apple.com/documentation/sirikit/specifying-synonyms-for-your-app-name). Code: /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/TempoApp/TempoApp.swift.

### 🟡 Partly — Siri (or any trigger) opens Kairos and it starts listening immediately; behaviour on a locked phone
*Fact-check: corrected*

**What's possible:** In the iOS 26 SDK `openAppWhenRun` is deprecated (iOS 16.0–26.0) and replaced by `static let supportedModes: IntentModes`. The options are `.background`, `.foreground` / `.foreground(.immediate)` (the app comes forward right after the system resolves parameters), `.foreground(.dynamic)` (the intent decides, by checking `systemContext.currentMode.canContinueInForeground` and calling `try await continueInForeground(alwaysConfirm: false)`), and `.foreground(.deferred)`. With `.foreground`, perform() runs with the app in the foreground, so it can start the audio session and ElevenLabs session right away. Apple's side-button guide recommends exactly that. Locked phone: Apple DTS says a foreground launch always requires the user to unlock, because the app gets full access to lock-protected data. `authenticationPolicy = .alwaysAllowed` does not change that; it only affects intents that run in the background. Forum reports show the intent can be interrupted or hang after the unlock prompt when it asks for parameters (requestDisambiguation).

**Correction:** The core claims are right; the corrections are about the implementation advice. (1) The project's deployment target is iOS 17.0 (project.pbxproj) and the intent uses `static let openAppWhenRun = true`. IntentModes/supportedModes are iOS 26.0+, so the suggested `static let supportedModes` needs @available(iOS 26, *) gating or a deployment target of 26.0. Apple says openAppWhenRun is deprecated in 26.0 but can still be set to true for intents that run inside the app. For tomorrow's demo no change is needed. The app also already auto-starts listening when scenePhase becomes active, which covers cold launch by Siri. (2) Forum thread 732466 has no replies and no mention of requestDisambiguation. It only reports that an openAppWhenRun intent run by Siri on a locked phone asks for unlock and the shortcut gets interrupted. (3) Apple confirms the default authenticationPolicy is alwaysAllowed, which lets an intent run without authentication even when the device is locked; that applies to background intents only.

**How (for Kairos):** Set `struct TalkToKairosIntent: AppIntent { static let supportedModes: IntentModes = .foreground(.immediate); static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication; func perform() async throws -> some IntentResult { await KairosSession.shared.start(); return .result() } }`. Give it no parameters so nothing stalls after unlock. Add `@available(*, deprecated) static var openAppWhenRun: Bool { true }` only if you also target iOS < 26. Siri may still be holding the mic when perform() runs; if `AVAudioSession.setActive` fails, retry after about 300–800 ms or wait for the interruption-ended notification (low confidence, not documented). For one-shot questions while locked, add a second background intent ('Ask Kairos') with `supportedModes = .background` and a String parameter Siri asks for. It calls the Mac hub and returns `.result(dialog:)`, which Siri reads aloud without unlocking. Use `.requiresAuthentication` for anything personal.

**Limits:** iOS 26.5 is fine. No third-party UI over the Lock Screen, and any foreground launch needs an unlock. A background 'Ask Kairos' intent can speak a .result(dialog:) while locked; personal data should use .requiresAuthentication. Siri releasing the mic before AVAudioSession activation is undocumented, so a retry or backoff is prudent.

**Evidence:** Apple's openAppWhenRun doc: deprecated in iOS 26.0, 'Please provide supportedModes instead', with backward compatibility for in-app intents (https://developer.apple.com/documentation/appintents/appintent/openappwhenrun). IntentModes and supportedModes are introduced in iOS 26.0 with .background and .foreground(.immediate/.dynamic/.deferred) (https://developer.apple.com/documentation/appintents/appintent/supportedmodes). Apple DTS (Ed Ford, Apr 2025) says a foreground launch requires unlock because the app gets full access to lock-protected data, and that authenticationPolicy is for intents that run in the background (https://developer.apple.com/forums/thread/779977). The authenticationPolicy doc gives the default as alwaysAllowed (https://developer.apple.com/documentation/appintents/appintent/authenticationpolicy).

**Sources:** <https://developer.apple.com/documentation/appintents/appintent/openappwhenrun> · <https://developer.apple.com/documentation/appintents/intentmodes> · <https://developer.apple.com/documentation/appintents/intentmodes/foregroundmode> · <https://developer.apple.com/videos/play/wwdc2025/275/> · <https://developer.apple.com/documentation/appintents/appintent/authenticationpolicy> · <https://developer.apple.com/documentation/appintents/intentauthenticationpolicy> · <https://developer.apple.com/forums/thread/779977> · <https://developer.apple.com/forums/thread/732466>

### 🔧 Workaround — Triple-click side button (Accessibility Shortcut) launches Kairos
*Fact-check: corrected*

**What's possible:** The Accessibility Shortcut (Settings > Accessibility > Accessibility Shortcut) can only turn accessibility features on or off: VoiceOver, Zoom, AssistiveTouch, Voice Control, Guided Access, Assistive Access and so on. It cannot run a Shortcut or open an app directly. Two workarounds: (a) triple-click turns on AssistiveTouch, whose Custom Actions (Single-Tap, Double-Tap, Long Press) can be set to a Shortcut that runs 'Talk to Kairos'. I recall the AssistiveTouch action list includes your Shortcuts, but Apple's page does not say so explicitly (medium-low confidence). (b) Triple-click enters or exits Assistive Access, Apple's simplified mode for older or cognitively impaired users. Since iOS 26 an app can provide a tailored Assistive Access experience with Info.plist `UISupportsAssistiveAccess = YES` plus the SwiftUI `AssistiveAccess` scene, or with `UISupportsFullScreenInAssistiveAccess`. Kairos could then be a large tile in a simplified home screen.

**Correction:** Apple confirms the Accessibility Shortcut only turns chosen accessibility features on or off. It cannot run a Shortcut or open an app. Corrections and sharpenings: (1) UISupportsFullScreenInAssistiveAccess dates from iOS 17, not 26. Only UISupportsAssistiveAccess and the SwiftUI AssistiveAccess scene are new in iOS 26; UISupportsAssistiveAccess also lists the app as 'Optimized for Assistive Access' for the supporter. (2) Apple's pages checked here do not say that AssistiveTouch custom actions can run a user shortcut. Apple's Hot Corners text mentions 'use a shortcut', which hints at it, so this stays unverified until tested on the device. (3) If AssistiveTouch works for this, the triple-click is unnecessary. A permanently visible AssistiveTouch button with Single-Tap set to the Kairos shortcut is a one-tap on-screen launcher, though a floating button may confuse some older users. (4) Apple notes that inside Assistive Access the Accessibility Shortcut can only enter or exit Assistive Access, not toggle other features.

**How (for Kairos):** For the demo, (a) is quickest: build a Shortcuts-app shortcut containing the 'Talk to Kairos' App Shortcut action, then assign it in Settings > Accessibility > Touch > AssistiveTouch > Custom Actions. For the elderly-care product story, add `UISupportsAssistiveAccess` and an `AssistiveAccess { KairosBigButtonView() }` scene, and explain that a carer sets up Assistive Access with Kairos as the main app.

**Limits:** Carer/user setup only. Assistive Access is a whole-phone mode that needs the passcode to exit. Running a shortcut from AssistiveTouch is unverified, so test it on the 12 Pro Max.

**Evidence:** Apple Support (Quickly turn accessibility features on or off): triple-click the side button to turn accessibility features of your choice on or off. It notes Assistive Access and Guided Access must be set up first, and that inside Assistive Access the shortcut only enters and exits it (https://support.apple.com/en-gb/guide/iphone/iph3e2e31a5/ios). UISupportsAssistiveAccess is iOS 26.0+ and UISupportsFullScreenInAssistiveAccess is iOS 17.0+ (https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportsassistiveaccess , https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportsfullscreeninassistiveaccess). The AssistiveAccess scene is iOS 26.0+ (https://developer.apple.com/documentation/swiftui/assistiveaccess).

**Sources:** <https://support.apple.com/guide/iphone/accessibility-shortcuts-iph3e2e31a5/26/ios/26> · <https://support.apple.com/en-gb/111794> · <https://developer.apple.com/documentation/swiftui/assistiveaccess> · <https://developer.apple.com/videos/play/wwdc2025/238/>

### ✅ Yes — Back Tap (double or triple tap on the back of the iPhone) launches Kairos
*Fact-check: confirmed*

**What's possible:** Back Tap (Settings > Accessibility > Touch > Back Tap > Double Tap or Triple Tap) can run a shortcut. It works on iPhone 8 and later with iOS 14+, so it works on the 12 Pro Max. App Shortcuts from App Intents appear as actions in the Shortcuts app. Back Tap lists user shortcuts, so wrap the action in a one-step shortcut. Reports say Back Tap fires on the Lock Screen, but opening the app still needs an unlock.

**How (for Kairos):** Create a Shortcuts-app shortcut 'Kairos' containing the 'Talk to Kairos' action (or 'Open URLs kairos://talk' if the URL handler auto-starts). Assign it to Back Tap > Triple Tap; triple is less prone to accidental pocket taps than double. This is the best one-gesture launcher on an iPhone 12 Pro Max in the UK.

**Limits:** Per-device setup. Cases can affect reliability. A locked phone still needs an unlock before Kairos appears. Works on a free team (no app capability needed).

**Evidence:** Apple Support (Tap the back of iPhone): double- or triple-tap the back to perform actions such as running a shortcut, set in Settings > Accessibility > Touch > Back Tap (https://support.apple.com/en-gb/guide/iphone/iphaa57e7885/ios). The 12 Pro Max is iPhone 8 or later and supports iOS 14+. It has no Action button.

**Sources:** <https://support.apple.com/guide/iphone/back-tap-iphaa57e7885/26/ios/26> · <https://support.apple.com/en-gb/guide/iphone/iphe89d61d66/26/ios/26> · <https://maketecheasier.com/unlock-back-tap-actions-iphone>

### ✅ Yes — Control Center and Lock Screen controls (ControlWidget) and Lock Screen widgets that launch Kairos
*Fact-check: corrected*

**What's possible:** From iOS 18, WidgetKit controls can be placed in Control Center, as the two Lock Screen controls at the bottom (replacing flashlight or camera; on iOS 26 tap a control while customising the Lock Screen to swap it), and on the Action button (not on this phone). A `ControlWidgetButton(action:)` that uses an intent conforming to `OpenIntent` opens the app. Apple says that intent must have Target Membership in both the app and the widget extension. Controls can require device authentication and redact text when locked. Lock Screen accessory widgets can deep-link with `widgetURL(URL(string: "kairos://talk"))`. Any path that opens the app from the Lock Screen still needs an unlock. The only exception Apple provides is LockedCameraCapture, which is for camera apps only.

**Correction:** The verdict stands; the implementation detail is corrected. Apple's documented way for a control to open the app is an intent conforming to OpenIntent, with Target Membership in both the app and the widget extension. OpenIntent needs a `target` parameter; Apple's sample uses an AppEnum such as `@Parameter var target: LaunchAppEnum`. The researcher's snippet omits it, and 'an AppIntent with supportedModes = .foreground' is not Apple's documented path for controls. Apple notes openAppWhenRun errors if the intent runs in an extension. OpenURLIntent (iOS 18) is for universal links, which need Associated Domains, a paid-only capability, so it is no help on a free team. App Groups ARE available to free teams if the widget needs shared state. A widget extension adds an App ID but does not count as one of the 3 apps per device.

**How (for Kairos):** Add a Widget Extension (File > New > Target > Widget Extension, tick 'Include Control'). Create `struct KairosControl: ControlWidget { var body: some ControlWidgetConfiguration { StaticControlConfiguration(kind: "com.kairos.talk") { ControlWidgetButton(action: OpenKairosTalkIntent()) { Label("Kairos", systemImage: "waveform") } }.displayName("Talk to Kairos") } }`, where OpenKairosTalkIntent is an OpenIntent or an AppIntent with `supportedModes = .foreground`. Add it to the WidgetBundle. Put it on the Lock Screen bottom-left for one-tap access.

**Limits:** iOS 18+ (fine on 26.5). Opening the app from a Lock Screen control needs an unlock. Each new target uses one of the 10 App IDs per rolling 7 days. Rebuild and re-sign within 7 days.

**Evidence:** WidgetKit 'Creating controls…': controls can launch the app from Control Center, the Lock Screen or the Action button. To open the app, use an intent conforming to OpenIntent with Target Membership in both targets; the sample shows `struct LaunchAppIntent: OpenIntent { @Parameter(title: "Target") var target: LaunchAppEnum }`. Controls can require authentication and redact text when locked (https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system). The OpenURLIntent doc says it opens universal links (https://developer.apple.com/documentation/appintents/openurlintent). Apple's capability table lists App groups as available to free accounts and Associated domains as not (https://developer.apple.com/help/account/reference/supported-capabilities-ios). Free limits are 10 App IDs (expiring after 7 days), 3 apps per device and 7-day profiles (https://developer.apple.com/support/compare-memberships/).

**Sources:** <https://developer.apple.com/documentation/widgetkit/creating-controls-to-perform-actions-across-the-system> · <https://developer.apple.com/videos/play/wwdc2024/10157/> · <https://support.apple.com/en-gb/guide/iphone/iph4d0e6c351/26/ios/26> · <https://developer.apple.com/support/compare-memberships/>

### 🔧 Workaround — Hands-free trigger without 'Hey Siri' (say 'Kairos') via Vocal Shortcuts
*Fact-check: confirmed*

**What's possible:** Vocal Shortcuts (iOS 18+, Settings > Accessibility > Vocal Shortcuts > Set Up) let the user teach the iPhone a custom word or phrase. Saying it either sends a Siri request or runs an existing shortcut. Audio is processed on device, and a status-bar indicator shows the mic is listening. A user could teach 'Kairos' to run the 'Talk to Kairos' shortcut with no 'Hey Siri' at all. Third-party guides say it fires while the phone is locked, but foreground app launch still needs an unlock. Early reviewers reported uneven recognition, roughly 30% in one iOS 18 beta report.

**How (for Kairos):** During onboarding, have the carer set up a Vocal Shortcut whose phrase is 'Kairos' and whose action is the Kairos shortcut. As a fallback, add a Vocal Shortcut whose Siri Request is 'Talk to Kairos'. Demo it live only after testing it several times in the venue's noise.

**Limits:** Manual setup with phrase training. Behaviour in a noisy venue and alongside Kairos's own mic use is untested. A foreground launch still needs an unlock.

**Evidence:** Apple Support 'Use Vocal Shortcuts on iPhone' (iOS 26): Settings > Accessibility > Vocal Shortcuts, choose an action or a Siri Request, then repeat the phrase to train it. Audio is processed on device and a status-bar indicator shows while it listens (https://support.apple.com/en-gb/guide/iphone/iph7f242ea2c/26/ios/26). Gadget Hacks and GeekChamp say it works on any iOS 18+ iPhone (secondary).

**Sources:** <https://support.apple.com/en-gb/guide/iphone/iph7f242ea2c/26/ios/26> · <https://mcmw.abilitynet.org.uk/how-to-perform-actions-on-your-device-using-vocal-shortcuts-in-ios-26-on-your-iphone-or-ipad> · <https://iphonesoft.fr/2024/06/14/astuce-ios-18-raccourcis-vocaux-utiliser-iphone-verrouille> · <https://www.techradar.com/phones/this-new-ios-18-voice-control-feature-could-be-even-more-useful-than-the-new-siri>

### 🟡 Partly — Start a voice conversation from a locked phone without unlocking (AudioRecordingIntent + Live Activity), and keep talking after locking
*Fact-check: confirmed*

**What's possible:** `AudioRecordingIntent` (iOS 18+) is the documented way for an App Intent to start recording without app UI. You must start a Live Activity when recording begins and keep it running, 'If you don't start a Live Activity, the audio recording stops.' Developer forum reports from Feb and Jul 2026 on iOS 26 show third-party apps failing to start cold from the Lock Screen or background. `AVAudioSession.setActive(true)` fails with OSStatus 561015905, Live Activity start fails with 'Target is not foreground', and handing off to the app triggers Face ID. No Apple answer or sample addresses this. What does work: start the conversation in the foreground, then lock the phone. With `UIBackgroundModes = audio` and an active play-and-record session, the ElevenLabs/LiveKit call keeps going. A Live Activity with `LiveActivityIntent` buttons can then pause, mute or end it from the Lock Screen and Dynamic Island.

**How (for Kairos):** Demo flow: trigger (Siri, Back Tap or Lock Screen control), then a Face ID glance, then Kairos opens and listens; the user can then lock the phone and keep talking. Add an ActivityKit Live Activity ('Kairos is listening…', with Mute/End buttons as LiveActivityIntents, and `NSSupportsLiveActivities = YES` in Info.plist), started while in the foreground. Treat a true no-unlock cold start as an experiment: conform the talk intent to AudioRecordingIntent and test on the device.

**Limits:** The 12 Pro Max has no Dynamic Island, so the Live Activity shows on the Lock Screen and as banners only. A cold start from lock is likely blocked for third-party apps. Siri, incoming calls or other apps' audio will interrupt the session, so interruption handling is needed.

**Evidence:** Apple's AudioRecordingIntent doc (iOS 18+) says you must start a Live Activity when recording begins and keep it running, or the recording stops (https://developer.apple.com/documentation/appintents/audiorecordingintent). Forum 815725 (Feb 2026) shows 'Live Activity start failed … Target is not foreground'; a community reply says the recording must start in-app (https://developer.apple.com/forums/thread/815725). Forum 836958 (Jul 2026, iOS 26): setActive fails with 561015905 on the Lock Screen, and handing off to the app triggers Face ID (https://developer.apple.com/forums/thread/836958). The Info.plist has UIBackgroundModes=[audio]: /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/TempoApp/Info.plist.

**Sources:** <https://developer.apple.com/documentation/appintents/audiorecordingintent> · <https://developer.apple.com/forums/thread/836958> · <https://developer.apple.com/forums/thread/815725>

### ❌ No — Apple Intelligence or the new 'Siri AI' (iOS 26/27) integration for Kairos on iPhone 12 Pro Max, including third-party chatbot 'Extensions'
*Fact-check: confirmed*

**What's possible:** Siri AI, announced at WWDC 8 Jun 2026, and Apple Intelligence need iPhone 15 Pro/Pro Max or an iPhone 16 or later. The A14 iPhone 12 Pro Max is excluded. iOS 27 (scheduled release 14 Sep 2026) does support the 12 Pro Max, since Apple dropped no iPhones, but that phone keeps classic Siri. Classic Siri runs App Shortcuts phrases but has no on-screen awareness, no personal context and no App Toolbox orchestration. Apple's newsroom covers Siri AI working with third-party apps only through Spotlight and App Intents integration. It does not confirm user-selectable third-party assistant or chatbot 'Extensions', so treat those as unconfirmed rumours (Bloomberg/MacRumors pre-WWDC). Siri AI activation stays 'Hey Siri', the side button or a swipe down from the Dynamic Island.

**How (for Kairos):** Don't build on Apple Intelligence or Siri AI for this device. Kairos's own ElevenLabs plus Mac LLM pipeline is the assistant, and Siri is only the launcher. Still expose App Intents and App Entities (Spotlight indexing), so newer-device users get Siri AI integration later. Don't update the demo phone from iOS 26.5 to iOS 27 before tomorrow: Xcode 26.0.1 may not be able to deploy to iOS 27 without a newer Xcode (medium confidence), and it gains nothing on this hardware.

**Limits:** On an A14 phone, classic Siri only, on iOS 26.5 or 27. Do not update the demo phone before tomorrow. The risk that Xcode 26.0.1 cannot deploy to iOS 27 is plausible but unverified.

**Evidence:** Apple newsroom (Jun 2026): Siri AI and Apple Intelligence need iPhone 16 or later, iPhone 15 Pro/Pro Max or iPhone Air. Activation is 'Hey Siri', the side button or a swipe from the Dynamic Island (https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/). Apple newsroom 14 Sep 2026: rollout of iOS 27, Siri AI beta in English, more languages in October (https://www.apple.com/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/). iOS 27 compatibility includes the iPhone 12 Pro Max (https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/). Extensions not shown at WWDC (https://thenextweb.com/news/apple-siri-extensions-third-party-ai-missing-wwdc).

**Sources:** <https://www.apple.com/newsroom/2026/06/apple-introduces-siri-ai-a-profoundly-more-capable-and-personal-assistant/> · <https://www.apple.com/newsroom/2026/06/apple-unveils-next-generation-of-apple-intelligence-siri-ai-and-more/> · <https://appleinsider.com/articles/26/06/08/ios-27-keeps-iphone-11-and-newer-compatibility> · <https://www.iphoneincanada.ca/2026/09/09/apple-confirms-ios-27-release-date/> · <https://www.macrumors.com/2026/06/02/ios-27-siri-features/>

**Also important (added by the fact-checker):**

- FREE-TEAM 3-APPS-PER-DEVICE LIMIT IS ALMOST USED UP. The iCTRL README (/Users/gaddamshivateja/Oxford-hackathon-2026/phone-control/iCTRL/README.md) says the free-account limit is 3 sideloaded apps per device, counted by the device. SideStore counts as one, and so does iCTRLUITests-Runner. Kairos is then the third, which leaves no room for the iCTRL app or StikDebug. If Xcode-installed Kairos is a 4th app, install or launch fails. Check the device before the demo. A widget/control extension does not add an app, but each new bundle ID uses one of the 10 App IDs per rolling 7 days.
- FREE-TEAM CAPABILITY GAPS relevant to launching and engagement (Apple capability table). These are NOT available on a free account: Siri (SiriKit), Push notifications, Time Sensitive Notifications, Communication Notifications, Associated Domains (so no universal links or OpenURLIntent), Sign in with Apple, iCloud/CloudKit, App Attest, Access WiFi info, WeatherKit. These ARE available: App Groups, Background Modes, HealthKit, HomeKit, Keychain sharing, Data Protection. So Kairos-initiated TIME-themed check-ins cannot use Time Sensitive notifications to break through Focus until the paid account. https://developer.apple.com/help/account/reference/supported-capabilities-ios
- THE DEPLOYMENT TARGET IS iOS 17.0 (tempo-ios/project.yml and project.pbxproj). The researcher's iOS 26 APIs (supportedModes/IntentModes, continueInForeground, the AssistiveAccess scene, UISupportsAssistiveAccess) need @available gating or a raised target. The existing openAppWhenRun=true is deprecated but still works on iOS 26.5, so leave it for the demo.
- 'KAIROS' PRONUNCIATION RISK for Siri en-GB. Test all phrases with Xcode's App Shortcuts Preview (WWDC23 10102, Flexible Matching). Optionally add INAlternativeAppNames (max 3, with pronunciation hints); its effect on App Shortcuts is unverified. Drop the 'Hey \(.applicationName)' phrase, which sounds odd after 'Hey Siri'.
- English (UK) supports saying just 'Siri' (no 'Hey') since iOS 17, so 'Siri, talk to Kairos' is the simplest hands-free demo line. Set it under Settings > Siri on this non-Apple-Intelligence phone.
- EMERGENCY SOS CONFLICT FOR ELDERLY USERS. Pressing the side button 5 times, or holding the side button plus a volume button, starts Emergency SOS (countdown and siren, then a call to emergency services). Teaching older users to 'press the button several times' for Kairos is risky. Prefer Back Tap or a Lock Screen control, and review Settings > Emergency SOS with the carer.
- AUDIO-SESSION INTERRUPTIONS. Invoking Siri while Kairos is talking, incoming phone or FaceTime calls, and any app that iCTRL foregrounds and that grabs audio will interrupt the ElevenLabs/LiveKit session. 'Keeps talking while agents act' needs AVAudioSession interruption handling to resume, plus testing with iCTRL driving other apps while Kairos is in the background.
- PERSONAL AUTOMATIONS for the TIME theme. Shortcuts > Automation > Time of Day (Run Immediately) can run 'Talk to Kairos' on a schedule, for example a morning check-in or medication reminder. Opening the app still needs an unlock, so pair it with a local notification as the prompt.
- Developer Mode (Settings > Privacy & Security) must stay on, and the free-team developer certificate must be trusted under VPN & Device Management. Profiles expire 7 days after issue, so a build from tonight stops launching about 31 Oct 2026.
- AirPods or Made-for-iPhone hearing aids give a hands-free Siri trigger (Hey Siri, or press-and-hold on the AirPods stem) to say 'Talk to Kairos'. Still needs an unlock for the foreground launch. This fits older users with hearing aids.
- Spotlight is another zero-setup launcher: App Shortcuts appear in Spotlight results. A large Home Screen icon or an Assistive Access tile is the most reliable option for cognitively impaired users.

**Surprises:**

- A real side-button API exists: AppSchema.AssistantIntent `.assistant.activate` with the entitlement `com.apple.developer.side-button-access.allow` (iOS 26.2+). As of Oct 2026 it is hard-limited to Japan (Apple Account region set to Japan and the phone physically there). It needs Xcode 26.2 or newer, so the user's Xcode 26.0.1 does not have the capability, and a free Personal Team almost certainly cannot enable it.
- Even in Japan there is no 'Siri OR app' picker on long-press. The user swaps the single default side-button app in Settings, and 'Hey Siri' stays Siri's. Apple's licence clause §3.3.3(J)(iv) requires the app to open straight into voice and carry out actions; it names no region, but nothing has expanded beyond Japan.
- UK: the CMA's 2026 Apple measures are app-store and interoperability commitments (1 Apr 2026) plus Steering and NFC conduct-requirement consultations (NFC opened 20 Oct 2026). None covers voice assistants or the side button. The only lever is Apple's UK-only interoperability request channel, which needs a paid Developer Program team registered in the UK.
- In the iOS 26 SDK `openAppWhenRun` is deprecated in favour of `supportedModes: IntentModes` (`.foreground(.immediate/.dynamic/.deferred)`, `.background`) and `continueInForeground(alwaysConfirm:)`. Any intent that brings the app forward still needs an unlock on a locked phone, whatever the authenticationPolicy.
- The triple-click Accessibility Shortcut cannot run a Shortcut or open an app. Back Tap can, which makes Back Tap > Triple Tap > 'Kairos' shortcut the best one-gesture launcher on an iPhone 12 Pro Max in the UK. A Lock Screen ControlWidget, which replaces the flashlight or camera control, is the best one-tap launcher.
- iOS 27 shipped (scheduled 14 Sep 2026) and supports the iPhone 12 Pro Max, but Siri AI and Apple Intelligence need iPhone 15 Pro or later. Do not update the demo phone from 26.5 before tomorrow.
- Starting the mic cold from the Lock Screen via AudioRecordingIntent is reported failing for third-party apps on iOS 26 (setActive error 561015905, Live Activity 'Target is not foreground'). Start the conversation in the foreground and let UIBackgroundModes=audio keep it going after the user locks the phone.
- iOS 26 lets apps offer a tailored Assistive Access experience (Info.plist `UISupportsAssistiveAccess` plus the SwiftUI `AssistiveAccess` scene), and triple-click can enter that mode. This fits the elderly-user story well, but it is a carer-configured mode rather than a quick launcher.
- Free Personal Team profiles expire after 7 days, with a limit of 3 apps per device and 10 App IDs, and each widget extension uses an App ID. A build made tonight works for the demo but will stop launching within a week.

## Voice, background and call UI

### ✅ Yes — Keep a live two-way voice conversation running while Kairos is in the background, during app switching, and while the phone is locked
*Fact-check: corrected*

**What's possible:** 

**Correction:** The core claim holds. Several details about this SDK stack are wrong or out of date.
(1) elevenlabs-swift-sdk 3.4.0 already calls AudioManager.shared.setRecordingAlwaysPreparedMode(true) during setup. AudioPipelineConfiguration.recordingAlwaysPrepared defaults to true. So the session is .playAndRecord from the start, not '.playback until the mic track is published', and the extra call the researcher suggested is redundant.
(2) endConversation() never turns prepared mode off, and LiveKit documents that the mode 'persists across Room lifecycles and connections until disabled'. The mic engine (muted) and the audio session may therefore stay active after a conversation ends, including one that ends at max_duration. If so, the 'lost mic in background' trap is softer than described, but the orange dot stays on while idle. Test this on the device.
(3) LiveKit 2.18.0 (the resolved version) already defaults to isSpeakerOutputPreferred = true, which gives .playAndRecord + .videoChat + .defaultToSpeaker. The loudspeaker is already the default. You only need to force it when you turn off LiveKit's automatic configuration, for example under CallKit.
(4) soft_timeout_config does not keep Kairos talking. It plays one filler phrase per turn when the LLM is slow (timeout 0.5–8 s, default disabled). For continuous narration while agents work, see the missed items: non-blocking client tools, tool call sounds and updateContext.

**Limits:** Works on the free Personal Team, because Background Modes is in the free column of Apple's capabilities table. The app already has UIBackgroundModes [audio] and NSMicrophoneUsageDescription (project.yml). The session must start from a foreground trigger. Raise max_duration_seconds to 7200 before the demo. Keep the phone on a charger. The orange mic dot is always visible. Background audio used for non-audible purposes is an App Review 2.5.4 risk, which does not matter for the hackathon.

**Evidence:** DTS quote verified (Feb 2026): 'There's a privacy block in place that prevents recording sessions from activating in the background'. The exceptions are CallKit, LiveCommunicationKit and PushToTalk, which 'can't be used for any other purpose' (https://developer.apple.com/forums/thread/816408). ElevenLabs: max_duration_seconds defaults to 600 with a range of 60–7,200; soft_timeout_config.timeout_seconds defaults to -1, ranges 0.5–8.0, and the filler is spoken once per turn (https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow). Local SPM checkout: ElevenLabs/Internal/Conversation/ConversationAudioManager.swift:95 calls setRecordingAlwaysPreparedMode(true); AudioPipelineConfiguration.swift:47 has recordingAlwaysPrepared = true; LiveKit AudioSessionEngineObserver.swift:72 has isSpeakerOutputPreferred = true; AudioSessionConfiguration.swift defines playAndRecordSpeaker = .playAndRecord/.videoChat/+.defaultToSpeaker. LiveKit Room.appDidEnterBackground suspends only camera video tracks, so audio keeps running.

### 🟡 Partly — Survive interruptions from Siri, phone calls and alarms while Kairos talks in the background
*Fact-check: confirmed*

**What's possible:** 

**Limits:** iOS 26.5: use interruptionNotification. Ask the user to set Incoming Calls to Banner. What happens with Siri during a CallKit call is untested and needs a device test. Free account: local Live Activity updates and local notifications are fine, but there is no push.

**Evidence:** iOS 26.0 SDK header AVAudioSession.h: setPrefersNoInterruptionsFromSystemAlerts is iOS 14.5+. With the 'Banner' style, system audio is silenced and the session is interrupted only if the user accepts the call. 'With display style set as Full Screen, below property will have no effect'. Forum thread https://developer.apple.com/forums/thread/813278 (Jan 2026, 0 replies): setActive(true) fails with 560557684 '!int' after a call in the background, using .playAndRecord and UIBackgroundModes audio. Apple's 'Handling audio interruptions' doc: the lifecycle notifications are iOS 27+. The interruptionNotification doc metadata shows deprecatedAt 27.0 only for visionOS.

### ✅ Yes — Present a Kairos session as a phone call (CallKit outgoing call to 'Kairos')
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Free team OK: CallKit has no entitlement, and voip is a Background Modes value. Start the call from the foreground only. App Store acceptance for a non-communication assistant is doubtful. UK has no restriction; disable CallKit in China builds.

**Evidence:** iOS 26.0 SDK CXError.h: CXErrorCodeRequestTransactionErrorInvalidAction = 6. CXProviderConfiguration.h: includesCallsInRecents 'Default: YES'. Forum https://developer.apple.com/forums/thread/766125 (Oct 2024): App Intent with openAppWhenRun=false fails with com.apple.CallKit.error.requesttransaction code 6. DTS points to Speakerbox's NSUserActivity handoff. CallKit doc: 'For incoming and outgoing calls, CallKit displays the same interfaces as the Phone app'. It also has the Journaling Suggestions and SRResearchDataGeneration notes (https://developer.apple.com/documentation/callkit). DTS 'can't be used for any other purpose' (thread 816408). LiveKit README CallKit pattern verified (https://github.com/livekit/client-sdk-swift).

### 🔧 Workaround — Kairos 'calls' the user with an incoming call UI and wakes the app when it is not running
*Fact-check: confirmed*

**What's possible:** 

**Limits:** PushKit VoIP needs the paid $99 account. Without push, reportNewIncomingCall works only while the process is alive (kept alive by audio). AlarmKit, local notifications and scheduled Live Activities all work on the free team with iOS 26.5.

**Evidence:** Apple capabilities table (https://developer.apple.com/help/account/reference/supported-capabilities-ios/), parsed from the HTML: 'Push notifications' and 'Push to Talk' have no mark in the free 'Apple Developer' column. Xcode error quoted in https://developer.apple.com/forums/thread/718388: 'Personal development teams ... do not support the Push Notifications capability.' Apple's CallKit doc: an app reports an incoming call 'in response to an external notification, such as a VoIP push notification from PushKit'. AlarmKit doc (iOS 26.0+): an alarm 'overrides both a device's focus and silent mode'. It needs only the NSAlarmKitUsageDescription Info.plist key, plus a widget extension for countdowns (https://developer.apple.com/documentation/alarmkit).

### ✅ Yes — Show live agent progress via Live Activities on iPhone 12 Pro Max without push
*Fact-check: confirmed*

**What's possible:** 

**Limits:** iOS 16.1+. Free team OK because ActivityKit needs no capability, but the widget extension uses a second App ID and its profile also expires after 7 days. The 12 Pro Max has no Dynamic Island. The user can turn Live Activities off.

**Evidence:** Apple doc 'Displaying live data with Live Activities' (JSON): up to 8 h, then up to 4 more hours on the Lock Screen (12 h max). 4 KB combined limit. 'can't access the network or receive location updates'. 'may truncate ... if its height exceeds 160 points'. Non-Dynamic-Island devices show a banner for updates with an AlertConfiguration. StandBy shows it full screen. 'In general, your app needs to be in the foreground to start a Live Activity. You can update or end ... while it runs in the background', with the LiveActivityIntent exception. iOS 26.0 SDK ActivityKit swiftinterface: request(...alertConfiguration:start:) is @available(iOS 26.0). 9to5mac (https://9to5mac.com/2025/06/16/macos-26-live-activities-work-even-if-your-iphone-is-on-ios-18/): no developer changes needed, and clicking opens via iPhone Mirroring.

### 🔧 Workaround — Always-on wake word ('Hey Kairos')
*Fact-check: corrected*

**What's possible:** There is no third-party hotword API: 'Siri' / 'Hey Siri' and the side button belong to Siri (outside Japan). A third-party app can listen only while it holds an active, user-started audio session (orange dot always on). It cannot start the mic from the background, it loses listening on any interruption, and always-on background listening risks App Review 2.5.4 and drains the battery. iOS 26 SpeechAnalyzer has SpeechTranscriber, DictationTranscriber and SpeechDetector modules but no keyword-spotting module. A May 2026 forum question about wake-word detection during a user-started session on a locked phone has no Apple answer. Practical substitute: Vocal Shortcuts (iOS 18+, Settings > Accessibility > Vocal Shortcuts). The user says a custom phrase such as 'Hey Kairos' three times to train it, and it runs a Shortcut, including Kairos's 'Talk to Kairos' App Shortcut. Other options: 'Siri, talk to Kairos' (App Shortcut phrases); Back Tap (Settings > Accessibility > Touch > Back Tap, iPhone 8+), where a double or triple tap on the back runs the shortcut, which is very elder-friendly; and a Control Center / Lock Screen control (ControlWidget, iOS 18).

**Correction:** Verdict confirmed. Fixes to the 'how':
(1) For in-session keyword catching with SpeechTranscriber, use the .progressiveTranscription preset (volatile results). The .transcription preset delivers finalised results only.
(2) Feed it from the existing mic using conversation.inputTrack?.add(audioRenderer:) (LiveKit AudioRenderer) rather than a second engine.
(3) The iPhone 12 Pro Max has no Action button, which needs iPhone 15 Pro or later. The hardware options are Back Tap, Siri (long-press), and the triple-click Accessibility Shortcut, which is limited to accessibility features (not verified in this pass).
(4) The Vocal Shortcuts reliability and conflict claims come from community forums and were not re-verified.

**How (for Kairos):** Make the 'Talk to Kairos' intent open the app (openAppWhenRun = true or supportedModes .foreground), so the mic starts from the foreground. Add an onboarding screen (for the user or a carer) that walks through setting up the Vocal Shortcut and Back Tap. Optional, demo-only: while a Kairos session is already active, run on-device keyword spotting on the live mic (Porcupine, or SpeechTranscriber volatile results) to catch 'Kairos, stop' or 'Kairos, wait'.

**Limits:** No third-party hotword API. On a locked phone, opening Kairos still needs a Face ID or passcode unlock. Background listening is not App Store safe. Vocal Shortcuts and Back Tap are user-configured; Kairos cannot set them programmatically.

**Evidence:** iOS 26.0 SDK Speech swiftinterface: SpeechTranscriber, DictationTranscriber and SpeechDetector exist, with no keyword-spotting type. SpeechTranscriber presets are transcription, transcriptionWithAlternatives, progressiveTranscription and the timeIndexed variants. The wake-word forum thread https://developer.apple.com/forums/thread/826681 (May 2026) has 0 replies. AbilityNet (iOS 26): Settings > Accessibility > Vocal Shortcuts, say the phrase 3 times, and it can run shortcuts made in the Shortcuts app. Apple HT211781: Back Tap needs iPhone 8 or later and iOS 14 or later, at Settings > Accessibility > Touch > Back Tap.

**Sources:** <https://developer.apple.com/forums/thread/816408> · <https://developer.apple.com/forums/thread/826681> · <https://developer.apple.com/documentation/speech/speechanalyzer> · <https://mcmw.abilitynet.org.uk/how-to-perform-actions-on-your-device-using-vocal-shortcuts-in-ios-26-on-your-iphone-or-ipad> · <https://support.apple.com/guide/shortcuts/apd897693606/ios> · <https://support.apple.com/en-us/HT211781> · <https://developer.apple.com/forums/thread/772238> · <https://www.applevis.com/forum/ios-ipados/vocal-shortcuts>

### 🟡 Partly — Start Kairos instantly from a hardware button / Lock Screen / Control Center
*Fact-check: corrected*

**What's possible:** 

**Correction:** The Japan-only production claim is correct.
(1) Apple's doc says 'During development, install your provisioning profile on your iPhone test device to test the functionality'. The Japan account region and physical presence requirements are stated for production devices only. A development-signed demo in the UK might therefore work. That is untested, and it needs Xcode 26.2 or later: I confirmed that the installed Xcode 26.0.1 / iOS 26.0 SDK has no `.assistant` schema domain.
(2) 'Side Button Access' does not appear anywhere in Apple's capabilities table, so its availability on a free team is unknown, not confirmed absent.
(3) The CMA designated Apple with SMS on 22 Oct 2025, but its programme page mentions monitoring 'the emergence and adoption of AI' generally, not voice assistants specifically.
(4) The 'Target is not foreground' explanation in thread 815725 comes from a community reply, not DTS.
(5) A long-press giving a choice between Siri and Kairos is not possible in the UK.

**Limits:** UK: no third-party side-button assistant in production. The free team probably cannot use Side Button Access (unlisted). Upgrading Xcode on demo night is risky. Reliable UK entry points are Back Tap, Vocal Shortcut, 'Siri, talk to Kairos', a Control Center or Lock Screen control, and a kairos:// link. All must open the app (supportedModes .foreground on iOS 26, openAppWhenRun on iOS 17–25).

**Evidence:** Apple doc JSON (https://developer.apple.com/documentation/appintents/launching-your-voice-based-conversational-app-from-the-side-button-of-iphone): the activate schema 'is only available on iPhone in Japan and requires the com.apple.developer.side-button-access.allow entitlement'. The sample uses `@AppIntent(schema: .assistant.activate)` with `supportedModes: IntentModes = .foreground`. Entitlement doc: introducedAt iOS 26.2, Xcode name 'Side Button Access'. Local SDK grep: the AssistantSchemas domains in the iOS 26.0 SDK are books, browser, camera, files, journal, mail, photos, presentation, reader, spreadsheet, system, visualIntelligence, whiteboard and wordProcessor, with no assistant domain. AudioRecordingIntent doc: 'If you don't start a Live Activity, the audio recording stops.' gov.uk CMA page: SMS on 22 October 2025.

### ✅ Yes — Private on-device speech recognition fallback (SpeechAnalyzer/SpeechTranscriber)
*Fact-check: corrected*

**What's possible:** 

**Correction:** (1) `AnalyzerInputConverter` is not an SDK type. Only `AnalyzerInput` exists, so you convert buffers yourself with AVAudioConverter to bestAvailableAudioFormat(compatibleWith:) (Apple's sample uses its own helper).
(2) Use .progressiveTranscription for live, volatile results.
(3) You do not have to end the ElevenLabs session to run local STT. Tap the live mic through LiveKit's LocalAudioTrack.add(audioRenderer:) (ElevenLabs exposes conversation.inputTrack). Do not override AudioManager.shared.capturePostProcessingDelegate, because the ElevenLabs SDK uses it for software mute.
(4) The project's deployment target is iOS 17.0 (project.yml), so wrap the code in #available(iOS 26, *).
(5) iPhone 12 support comes from community reports only.

**Limits:** iOS 26+. The 12 Pro Max likely qualifies, but check isAvailable at runtime. Pre-download en-GB assets on Wi-Fi. Free team OK because Speech needs no capability.

**Evidence:** iOS 26.0 SDK Speech swiftinterface: AssetInventory.assetInstallationRequest(supporting:), downloadAndInstall(), SpeechTranscriber.isAvailable, supportedLocale(equivalentTo:), SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:), prepareToAnalyze(in:). There is no AnalyzerInputConverter. Forums https://developer.apple.com/forums/thread/806765 and thread/807739: isAvailable is false on iPhone 11/11 Pro/SE 2 and works on iPhone 12. LiveKit checkout: LocalAudioTrack.swift:175 add(audioRenderer:). ElevenLabs ConversationAudioManager.swift:147 sets capturePostProcessingDelegate.

### ✅ Yes — Elder-friendly speech output: Personal Voice, Live Speech, AVSpeechSynthesizer
*Fact-check: corrected*

**What's possible:** 

**Correction:** (1) Personal Voice in the UK: community reports (2024 and Nov 2025) say UK users can create one by choosing English (US), and the voice keeps their own accent. 'May not offer it on a UK phone' is too pessimistic; it is offered as English (US) only.
(2) The 'about 10 phrases / under a minute' iOS 26 claim reportedly applies to Apple Intelligence-capable iPhones. A non-AI phone such as the 12 Pro Max is reported to still need the full 150-phrase recording plus on-device processing time, so it cannot be set up during the demo. I could not confirm this from Apple; the web-search budget ran out.
(3) The rest is confirmed.

**Limits:** iPhone 12+ OK. The user must create the voice and opt in themselves in Settings. Use en-GB Enhanced or Premium AVSpeechSynthesisVoice for offline Kairos TTS. Keep usesApplicationAudioSession so speech shares the active session.

**Evidence:** Apple Support en-gb 104993: requires iOS 17+, iPhone 12 or later, and Face ID/Touch ID/passcode. 'Allow Apps to Request to Use' exists, and apps 'can't capture speech from Personal Voice'. apple.com/ios/feature-availability: Personal Voice lists only English (United States), Mandarin Chinese (China mainland) and Spanish (Mexico). AppleVis threads (applevis.com/comment/163897, /163910): UK and AU users report only the English (US) option, yet a working voice. iOS 26.0 SDK AVSpeechSynthesis.h: requestPersonalVoiceAuthorization is API_AVAILABLE(ios(17.0)).

### 🟡 Partly — Free Apple ID team vs $99 program for the voice/call stack
*Fact-check: corrected*

**What's possible:** 

**Correction:** The capability list matches Apple's table exactly. Corrections: (1) 'Focus-breaking reminders need the paid account' is no longer true on iOS 26. AlarmKit alarms override Focus and silent mode with no capability, which makes them free-team compatible. Local notifications also need no push capability. Only Time Sensitive and Communication Notifications are paid-only. (2) '3 apps per device' and '10 App IDs per 7 days' are developer observations that DTS did not confirm. DTS confirmed only the 7-day profile expiry. (3) Also not free: App Attest, Network extensions, NFC, WeatherKit, Sustained Execution and Increased Debugging Memory Limit. (4) Side Button Access is not listed in the table at all.

**Limits:** The build from 24 Oct expires about 31 Oct; re-run from Xcode after that. The paid account is needed for PushKit, APNs Live Activity updates, Time Sensitive and Communication notifications, Siri intents and TestFlight distribution.

**Evidence:** Parsed table at https://developer.apple.com/help/account/reference/supported-capabilities-ios/. FREE = yes only for App groups, Background modes, Data protection, HealthKit, HomeKit, Inter-App Audio, Keychain sharing, Maps and Wireless Accessory Configuration. Push notifications, Siri, Push to Talk, Time Sensitive Notifications, Communication Notifications, iCloud, Associated domains, Access WiFi information and Sign in with Apple have no free mark. https://developer.apple.com/forums/thread/724896 (Feb 2023): Quinn (DTS) confirms 7-day expiry as 'another limitation of free provisioning'. The 3-app and 10-ID figures are the poster's own observations. AlarmKit doc: needs only NSAlarmKitUsageDescription.

**Also important (added by the fact-checker):**

- AlarmKit (iOS 26.0+) is the free-team way to get Focus- and silent-mode-overriding alerts for medication or check-in prompts. It needs only NSAlarmKitUsageDescription, no capability. Stop and secondary LiveActivityIntent buttons can open Kairos so the mic starts from the foreground. It needs a widget extension if you use countdown presentations. Source: https://developer.apple.com/documentation/alarmkit
- Scheduled Live Activities (iOS 26): Activity.request(attributes:content:pushType:style:alertConfiguration:start:) starts a Live Activity at a future time with no push or paid account. Verified in the iOS 26.0 SDK swiftinterface.
- Making Kairos 'keep talking while agents act' needs more than soft_timeout, which gives one filler per turn. Use ElevenLabs non-blocking client tools ('Wait for response' off / expects_response false), Tool Call Sounds (Typing or Elevator Music during tool execution) and per-tool interruption_mode. Push agent progress back with the Swift SDK's public conversation.updateContext(_:) or sendMessage(_:) so the agent narrates results. Sources: elevenlabs.io/docs/eleven-agents/customization/tools/tool-configuration/tool-call-sounds and the tool-interruptions page.
- elevenlabs-swift-sdk 3.4.0 keeps LiveKit's recordingAlwaysPrepared mode on, by default and permanently: it is never disabled in endConversation. The mic engine stays initialised (muted) between conversations. This may let Kairos keep its audio session, stay alive and reconnect in the background after a conversation ends, which needs a device test. It also keeps the orange mic dot on, which can alarm older users or look like eavesdropping. Make this an explicit, user-visible choice. Set AudioPipelineConfiguration(recordingAlwaysPrepared:) deliberately.
- For voice verification or local STT, tap the existing WebRTC mic through conversation.inputTrack?.add(audioRenderer:) instead of starting a second AVAudioEngine. Do not replace AudioManager.shared.capturePostProcessingDelegate, which the ElevenLabs SDK uses for software mute. iOS has no public speaker-recognition or voiceprint API, so owner verification must be custom (for example on the Mac). LocalAuthentication (Face ID or passcode) is the robust on-phone fallback and works on the free team. This last point was not re-verified from sources in this pass.
- LiveKit's default speaker route uses .videoChat/.voiceChat modes, which iOS plays at a reduced, call-tuned speaker gain (noted in LiveKit's AudioSessionConfiguration.swift). Test loudness for older users. The hardware volume buttons control call volume in these modes.
- iPhone 12 Pro Max hardware limits for 'press a button' UX: there is no Action button (iPhone 15 Pro and later) and no Dynamic Island. A long-press offering a choice of Siri or Kairos cannot be built in the UK. Back Tap is the most elder-friendly physical trigger.
- The project's deployment target is iOS 17.0 (tempo-ios/project.yml). SpeechAnalyzer, IntentModes/supportedModes, AlarmKit, scheduled Live Activities and BGContinuedProcessingTaskRequest are iOS 26-only. Gate them with #available or raise the target to 26.0. openAppWhenRun is deprecated in favour of supportedModes on iOS 26.
- ElevenLabs 'Take turn after silence' (turn_timeout, 1–30 s): older users often need longer pauses, and Apple-independent ElevenLabs docs suggest 10–30 s when users need time to formulate responses. Tune this alongside max_duration_seconds.
- CallKit privacy for a privacy-first product: Apple says the call handle may surface in Journal or Journaling Suggestions. Calls appear in Recents (default YES), which can sync across the user's devices. Set includesCallsInRecents = false and consider SRResearchDataGeneration = NO.
- Verification gap: the web-search budget ran out mid-check, so the iOS 26 '10-phrase Personal Voice' claim, the Vocal Shortcuts reliability reports and the exact CallKit UI behaviour for unlocked outgoing calls remain unverified.

**Surprises:**

- iOS 27 is out as of Oct 2026 and still supports the iPhone 12 Pro Max, but do NOT update the demo phone tonight. Xcode 26.0.1 will likely be unable to deploy to iOS 27, and iOS 27 changes audio APIs: AVAudioSession lifecycle notifications didBecomeInactive/resumptionRecommendation replace interruptionNotification, which is deprecated for new code. Source: https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/
- Apple DTS (Feb 2026) states explicitly that only CallKit, LiveCommunicationKit and PushToTalk may activate recording in the background, and that they 'can't be used for any other purpose'. Running Kairos as a CallKit 'call' is technically the strongest design but an App Store review risk; fine for the hackathon.
- ElevenLabs agents end a conversation after 600 s by default (max_duration_seconds, adjustable 60–7200). If that happens while Kairos is backgrounded mid-demo, iOS will not let it restart the mic until the app is foregrounded. Raise the limit before 13:00.
- Third-party side-button voice assistants exist since iOS 26.2 (AssistantIntent.activate schema + com.apple.developer.side-button-access.allow), but only in Japan. In the UK, the realistic triggers are Back Tap, Vocal Shortcuts ('Hey Kairos' as a custom phrase running the App Shortcut), 'Siri, talk to Kairos', and a Control Center or Lock Screen control.
- The free Personal Team cannot use Push Notifications, Siri (SiriKit), Push to Talk or Time Sensitive Notifications. This rules out PushKit 'Kairos is calling you' wake-ups and Focus-breaking reminders until the $99 account. CallKit, ActivityKit, HealthKit and Background Modes do work on the free team.
- Live Activities from the iPhone appear automatically in the macOS 26 menu bar via iPhone Mirroring, so the MacBook on stage can show Kairos's agent progress with no extra code. The 12 Pro Max itself shows the Lock Screen view or banners (no Dynamic Island).
- SpeechTranscriber (iOS 26) reportedly works on iPhone 12 but not iPhone 11, so a fully on-device, private STT fallback is viable on this phone. Apple Intelligence and the Foundation Models on-device LLM are NOT available on the 12 Pro Max (iPhone 15 Pro and later), so the private LLM must stay on the Mac (Ollama). Source: https://developer.apple.com/forums/thread/796139
- Personal Voice is listed only for English (US), Mandarin (China mainland) and Spanish (Mexico) on Apple's feature-availability page. A UK-English phone may not be able to create or offer it, so verify before promising it in the pitch.
- Starting a CallKit call from a background App Intent fails (CallKit requesttransaction error 6), and AudioRecordingIntent cold-starts from the background fail ('Target is not foreground'). Every Kairos entry point must briefly open the app.
- iOS 26 adds BGContinuedProcessingTaskRequest, which keeps user-initiated work running after backgrounding with system progress UI. It must be submitted from the foreground in response to a user action. It is useful if Kairos does on-phone processing after the voice session ends. Source: https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtaskrequest
- iOS 27 brings ScreenCaptureKit to iPhone with a new 'screen-capture' background mode, and iOS 27.2 adds LiveCommunicationKit's LiveAssistanceExtension (third-party interpreter or captioning services joining FaceTime calls). Both are possible future routes for an assistant that watches the screen or helps older users on calls, but neither is usable on iOS 26.5 tonight. Sources: https://developer.apple.com/documentation/screencapturekit and https://developer.apple.com/documentation/livecommunicationkit/liveassistanceextension

## Personal data a native app can read

### ✅ Yes — Read Health data (steps, mobility, walking steadiness, sleep, medications) and get woken when new data arrives
*Fact-check: corrected*

**What's possible:** Apple's current capability table (checked 24 Oct 2026) shows HealthKit and HomeKit work with the free 'Apple Developer' membership. HealthKit Estimate Recalibration does not. Reading needs NSHealthShareUsageDescription; writing needs NSHealthUpdateUsageDescription. Without them the app crashes when it asks for permission. Use HKHealthStore.requestAuthorization(toShare:read:). The user grants or denies each data type, and the app can never tell whether read access was denied: denied data just looks empty.

What an iPhone alone records: stepCount, distanceWalkingRunning, flightsClimbed, walking speed and asymmetry, appleWalkingSteadiness, and sleep if a sleep schedule or tracker is set up. appleWalkingSteadiness is read-only, recorded about every 7 days, and needs the user's height set. Heart rate and numberOfTimesFallen need an Apple Watch.

New in iOS 26: the Medications API. HKUserAnnotatedMedication (read with HKUserAnnotatedMedicationQueryDescriptor) and HKMedicationDoseEvent (taken or skipped, scheduled dose) are READ-ONLY. Access is granted medicine by medicine (per-object authorization), and approving a medicine also grants its dose history. Anchored object queries work.

Background delivery: HKObserverQuery plus enableBackgroundDelivery(for:frequency:) needs the com.apple.developer.healthkit.background-delivery entitlement (iOS 15+), or it fails with errorAuthorizationDenied. stepCount is capped at hourly on iOS. Your completion handler must be called; after 3 misses HealthKit stops waking the app.

When the phone is locked, Apple encrypts the Health store. Reads may fail in the background while locked, but writes are cached and saved later.

**Correction:** The main claim holds. Five details were wrong or missing. (1) Medications use per-object authorization. You cannot request them with requestAuthorization(toShare:read:); Apple says that call 'fails with an HKError.Code.errorInvalidArgument error' for per-object types. Call requestPerObjectReadAuthorization(for: HKObjectType.userAnnotatedMedicationType(), predicate:) instead. (2) Because the API is read-only, Kairos cannot write 'I've taken my 8am tablets' into Health. An Apple DTS engineer confirmed you can't write a dose event, so Kairos has to keep its own log or send the user to the Health app. (3) Heart rate does not need an Apple Watch: AirPods Pro 3 write heart rate to Health. numberOfTimesFallen does need a Watch. (4) The background-delivery risk is lower than stated. Apple DTS says adding the HealthKit capability puts com.apple.developer.healthkit, .access and .background-delivery into the profile's allowed list, so if HealthKit signs on the Personal Team, background delivery very likely signs too (inferred; still test it). (5) Walking steadiness is only recorded when the phone is carried near the waist; Apple names a pocket as the example. An older user who carries the phone in a bag may get few or no samples.

**How (for Kairos):** In project.yml add an entitlements block (com.apple.developer.healthkit: true, com.apple.developer.healthkit.access: [], com.apple.developer.healthkit.background-delivery: true). Add NSHealthShareUsageDescription to info.properties. Set up observer queries in application(_:didFinishLaunchingWithOptions:). Read summaries whenever the phone is unlocked (scenePhase .active) and send them to the Mac hub, so the agent never needs live Health reads while the phone is locked. For the elderly demo: 'Did I take my 8am tablets?' comes from HKMedicationDoseEvent, and walking steadiness can be framed as fall risk.

**Limits:** Phone: iOS 26.0+ is needed for the Medications API (fine on 26.5). Free team: HealthKit is supported. The app needs an explicit App ID, so use a bundle ID unique to this Personal Team; a teammate collision gives 'Failed Registering Bundle Identifier' (https://developer.apple.com/forums/thread/834802). Health reads can fail while the phone is locked, so cache summaries to the Mac whenever the phone is unlocked. Medications only show if the user logs them in the Health app. Some Health-app conveniences, such as name suggestions while typing, are US-only, but UK users can still add medicines by hand. Keep raw Health values away from ElevenLabs' cloud.

**Evidence:** Supported-capabilities table (fetched and parsed today): HealthKit is ticked for the free 'Apple Developer' membership; HealthKit Estimate Recalibration is not (https://developer.apple.com/help/account/reference/supported-capabilities-ios). On locked devices, Apple says 'the device encrypts the HealthKit store when the user locks the device', reads may fail in the background, and writes are cached; it also bars sharing with third parties unless they provide a health or fitness service (https://developer.apple.com/documentation/healthkit/protecting-user-privacy). enableBackgroundDelivery doc: the entitlement is required on iOS 15+, stepCount is capped at hourly, and delivery stops after 3 missed completion handlers (https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)). Per-object authorization (https://developer.apple.com/documentation/healthkit/hkhealthstore/requestperobjectreadauthorization(for:predicate:completion:)). WWDC25 session 321: approving a medicine grants its doses too, and sample, anchored and observer queries work (https://developer.apple.com/videos/play/wwdc2025/321/). DTS: medication API is read-only (https://developer.apple.com/forums/thread/789821). Profile allowed-list contents (https://developer.apple.com/forums/thread/689228). Walking steadiness needs the phone near the waist and the user's height set, and is read-only (https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applewalkingsteadiness). AirPods Pro 3 heart rate (https://support.apple.com/en-gb/guide/airpods/dev1b40fb47d/1.0/web/1.0).

**Sources:** <https://developer.apple.com/help/account/reference/supported-capabilities-ios> · <https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)> · <https://developer.apple.com/documentation/healthkit/protecting-user-privacy> · <https://developer.apple.com/videos/play/wwdc2025/321/> · <https://developer.apple.com/documentation/healthkit/hkuserannotatedmedication> · <https://developer.apple.com/forums/thread/789821> · <https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applewalkingsteadiness>

### ✅ Yes — Read and write calendar events and reminders
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Add NSCalendarsFullAccessUsageDescription and NSRemindersFullAccessUsageDescription. Works on a free team; no capability needed. The Mac-side EventKit route only works if the calendars sync to the Mac (iCloud or the same accounts), and the reading process on the Mac needs its own macOS Calendar/Reminders permission.

**Evidence:** Apple says: 'Your app can't request read-only access to either events or reminders. To read events or reminders from the event store, your app needs full access.' With write-only access, the app sees 'a single virtual calendar' and 'Requests for events on the virtual calendar return no results.' On iOS 17+, if only NSCalendarsUsageDescription is present, 'iOS automatically denies any access request.' EventKit UI runs outside the app and needs no access (https://developer.apple.com/documentation/eventkit/accessing-the-event-store).

### ✅ Yes — Read contacts ("call my daughter", resolve names)
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Works on a free team; iOS 18+ for limited access. Acting on a contact: since iOS 10.3, opening a tel: URL from an app shows a system confirmation alert before dialing, so an older user must still tap Call, or the iCTRL agent must tap it (https://developer.apple.com/forums/thread/73406). sms: and MFMessageCompose also need a manual Send.

**Evidence:** CNAuthorizationStatus.limited is iOS 18.0+. Access can be widened with ContactAccessButton or .contactAccessPicker(isPresented:completionHandler:) (https://developer.apple.com/documentation/contacts/cnauthorizationstatus/limited). Fetching CNContactNoteKey without the com.apple.developer.contacts.notes entitlement returns unauthorizedKeys; Apple's page says permission is needed 'Before you submit an app with this entitlement to the App Store' (https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.contacts.notes).

### ✅ Yes — Location in the background, geofences, steps and activity (CoreLocation and CoreMotion)
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Works on a free team. If the user turns off Precise Location, geofences such as 'left home' stop working; detect reduced accuracy and ask for precise. Waking the app for geofences after it has been killed needs Always authorization, which takes a two-step prompt. Add NSMotionUsageDescription or CoreMotion crashes. There is no API for other people's Find My locations.

**Evidence:** Apple's background-location doc: create a CLServiceSession in the foreground and 'If your app terminates, you must recreate the CLServiceSession immediately upon launch in the background'; for Always authorization, 'inform the user that location updates arrive in the background' (https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background). CMFallDetectionManager is watchOS 7.2+ only and 'requires an entitlement from Apple' (https://developer.apple.com/documentation/coremotion/cmfalldetectionmanager). Apple's accuracyAuthorization doc: with reduced accuracy 'your app can't use region monitoring or beacon ranging' (https://developer.apple.com/documentation/corelocation/cllocationmanager/accuracyauthorization).

### 🟡 Partly — Photos, music library, HomeKit, files
*Fact-check: confirmed*

**What's possible:** Photos: PHPickerViewController needs no permission because it runs outside the app. Full PhotoKit access needs NSPhotoLibraryUsageDescription (NSPhotoLibraryAddUsageDescription to add only), and the user may grant only a limited set of photos.

HomeKit: supported on the free membership. Turn on the HomeKit capability (com.apple.developer.homekit) and add NSHomeKitUsageDescription; HMHomeManager shows the prompt.

Music: the local library and system player (MPMediaLibrary, MPMusicPlayerController.systemMusicPlayer) need NSAppleMusicUsageDescription. Apple Music catalog access through MusicKit needs the MusicKit App Service turned on for the App ID in Certificates, Identifiers & Profiles, which only paid members can use. So MusicKit catalog is effectively paid-only (inferred).

Files: UIDocumentPickerViewController with security-scoped URLs works. The iCloud Documents capability is NOT available on the free membership.

**How (for Kairos):** Demo: 'turn on the lounge lamp' via HomeKit, 'show me photos of the grandkids' via PHPicker or a limited library, 'play my music' via systemMusicPlayer. Skip MusicKit catalog search unless you upgrade to the paid account.

**Limits:** Free team: PHPicker, limited or full PhotoKit, HomeKit, and the local library through MPMediaLibrary or systemMusicPlayer (NSAppleMusicUsageDescription) all work. MusicKit catalog search and iCloud containers do not. The HomeKit demo needs a real Home with accessories already set up on the phone.

**Evidence:** Capability table (parsed today): HomeKit is ticked for the free 'Apple Developer' membership; iCloud: CloudKit, iCloud documents and key-value storage are paid-only (https://developer.apple.com/help/account/reference/supported-capabilities-ios). Enabling MusicKit is done in Certificates, Identifiers & Profiles > Identifiers > App Services > MusicKit (https://developer.apple.com/help/account/services/musickit), and that portal is paid-only (https://developer.apple.com/support/compare-memberships/). So 'MusicKit catalog is paid-only' is still an inference, but a well-supported one.

**Sources:** <https://developer.apple.com/help/account/reference/supported-capabilities-ios> · <https://developer.apple.com/documentation/homekit/enabling-homekit-in-your-app> · <https://developer.apple.com/documentation/photokit/delivering-an-enhanced-privacy-experience-in-your-photos-app> · <https://developer.apple.com/help/account/services/musickit> · <https://developer.apple.com/support/compare-memberships/>

### ❌ No — Read other apps' notifications, iMessage/SMS, WhatsApp, call history, Mail or other apps' data from inside the app
*Fact-check: confirmed*

**What's possible:** 

**Limits:** All iOS versions, UK included. Use the bridges instead: Shortcuts triggers, Messages chat.db on the Mac, notifications mirrored to the Mac, wacli for WhatsApp, or an ANCS receiver.

**Evidence:** CXCallObserver 'manages a list of active calls': it sees current calls only, not history (https://developer.apple.com/documentation/callkit/cxcallobserver). EU-only iOS 26.3 Notification Forwarding sends notifications to one third-party wearable at a time, not to apps (https://9to5mac.com/2025/12/15/ios-26-3-beta-notification-forwarding/). UK: the CMA consulted on Apple's commitments from 10 Feb 2026 and accepted them on 1 Apr 2026. They cover a fair process for requesting interoperability, not a notification-access feature (https://www.gov.uk/government/news/cma-secures-commitments-from-apple-and-google-to-improve-fairness-in-app-store-processes-and-enhance-ios-interoperability; https://digitalpolicyalert.org/event/38922-competition-and-markets-authority-accepted-apples-final-commitments-on-app-distribution-and-interoperable-access-to-functionality).

### ❌ No — Screen Time / app-usage data (FamilyControls, DeviceActivity)
*Fact-check: confirmed*

**What's possible:** Apple's capability table lists Family Controls (development) for paid program members only; it is NOT available on the free membership. Releasing the app also needs a separate distribution entitlement approved by Apple.

Even with that entitlement, the app cannot read the usage numbers. DeviceActivityReport shows the data through a report extension (com.apple.deviceactivityui.report-extension) that runs in a sandbox blocking network requests and blocking data from leaving the extension. The voice agent therefore cannot hear or speak 'you used WhatsApp 3 hours'. AuthorizationCenter.requestAuthorization(for: .individual) (iOS 16+) lets a person authorize the app for themselves with Face ID. ManagedSettings shields can block apps, but you only get opaque ApplicationTokens.

**How (for Kairos):** Skip this for the hackathon. If needed later on the paid account: show a DeviceActivityReport view on screen ('Here's your phone time today') and accept that Kairos can't speak the numbers.

**Limits:** Paid membership needed even for development, plus a distribution entitlement for release. Even then, the voice agent cannot read the numbers.

**Evidence:** Capability table: 'Family Controls (development) *' is ticked for ADP only, not ADEP or free (https://developer.apple.com/help/account/reference/supported-capabilities-ios). Forum report of the error 'Personal development teams do not support the Family Controls (Development) capability' (https://developer.apple.com/forums/thread/852204). DeviceActivityReport: the extension 'runs in a sandbox' that 'prevents your extension from making network requests or moving sensitive content outside the extension's address space' (https://developer.apple.com/documentation/deviceactivity/deviceactivityreport).

**Sources:** <https://developer.apple.com/help/account/reference/supported-capabilities-ios> · <https://developer.apple.com/documentation/deviceactivity/deviceactivityreport> · <https://developer.apple.com/documentation/familycontrols/authorizationcenter/requestauthorization(for:)> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.family-controls>

### 🔧 Workaround — Bridge: Shortcuts 'When I get a message' automation sends iMessage/SMS text to the Mac hub
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Works on iOS 26.5 with a free account; no app needed. It sees messages only as they arrive, not history. Covers the Messages app only (iMessage, SMS, RCS). Test the single-space filter on the demo phone. Automations are set up by hand on the phone and can't be exported.

**Evidence:** Apple's Shortcuts guide: the Message trigger offers Sender and Message Contains; the Email trigger offers Sender, Subject Contains, Account and Recipient; 'When you add multiple criteria to a communication trigger, all criteria must be met' (https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios). The 'single space catches all messages' trick comes from community sources only, not Apple.

### 🔧 Workaround — Bridge: Shortcuts actions read Health, Calendar and Location and POST them; Focus filters; the iOS 27 Notification trigger
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Do not update the phone to iOS 27 before the demo, because Xcode 26.0.1 on macOS 26.5 is the working toolchain. Health actions in Shortcuts follow the same 'Health store locked' rule. After the demo, iOS 27 plus Xcode 27 (Mac on macOS 26.6) would allow 'Notification from WhatsApp > POST to the hub'.

**Evidence:** URL format 'shortcuts://run-shortcut?name=[name]&input=[input]&text=[text]' (https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios). iOS 27 public release was Monday 14 Sep 2026 (https://www.macrumors.com/2026/06/05/ios-27-release-date-how-to-install-beta/; https://ioshacker.com/iphone/apple-officially-announces-ios-27-public-release-date). iOS 27 compatibility list includes the iPhone 12 Pro Max (https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/). Notification trigger with Title, Subtitle and Message filters; the beta 1 write-up says 'The automation will run even if the device is locked' and that filters were broken in that beta (https://www.derekseaman.com/2026/06/home-assistant-notifications-that-run-apple-shortcuts-yes-really.html). Xcode 27 requires macOS Tahoe 26.6+ on Apple silicon (https://blakecrosley.com/blog/xcode-27-release).

### 🔧 Workaround — Bridge: the Mac hub gets messages and phone notifications the iPhone app can't
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Runs on the Mac (macOS 26.5); available in the UK. Reading chat.db or the notification database needs Full Disk Access granted by hand. Test whether mirrored notifications land in the database before relying on it.

**Evidence:** Apple: Text Message Forwarding makes SMS, MMS and RCS appear on the Mac; Messages in iCloud has it built in (https://support.apple.com/102545). Apple on iPhone Mirroring: requires macOS 15+ on Apple silicon or T2, iOS 18+ with a passcode, the same Apple Account with two-factor authentication, and Wi-Fi and Bluetooth on. The Mac 'receives them whether or not you're using iPhone Mirroring or your iPhone is nearby, as long as your iPhone is turned on'. 'iPhone Mirroring is currently unavailable in the European Union' (https://support.apple.com/120421). Whether mirrored iPhone notifications are written to the Mac's usernoted database is still unverified; no source covers it.

### ❌ No — Apple Intelligence: Siri personal context or the on-device LLM for Kairos
*Fact-check: confirmed*

**What's possible:** The iPhone 12 Pro Max (A14) cannot run Apple Intelligence. Apple lists the iPhone 15 Pro and Pro Max, iPhone 16 or later, and iPhone Air (as of Oct 2026). The Foundation Models framework (SystemLanguageModel, LanguageModelSession, iOS 26+) requires an Apple Intelligence device, so it is unavailable on this phone. The Shortcuts 'Use Model' action is out too.

Siri's personal context, which was delayed past iOS 26.4 and moved into the iOS 27 Siri, is never exposed to third-party apps. It flows the other way: apps expose their content and actions to Siri through App Intents entities and App Schemas. Separately, WWDC26 reportedly gave formal notice that SiriKit is deprecated.

**How (for Kairos):** Keep the LLM on the Mac (Ollama qwen2.5:7b) as planned. Make Kairos's data visible to the system through App Intents (AppEntity, AppShortcutsProvider) for future devices. Do not plan any feature on Apple Intelligence for this phone.

**Limits:** A14 hardware limit, whatever the iOS version or region. Keep the LLM on the Mac.

**Evidence:** Apple's Apple Intelligence page (iOS 27) lists iPhone 16 models and later, iPhone 15 Pro and Pro Max, iPhone Air and 'iPhone Duo'. The iPhone 12 Pro Max is not listed (https://support.apple.com/en-us/121115). The Foundation Models framework is iOS 26.0+ and needs an Apple Intelligence device. The 'SiriKit deprecated at WWDC26' claim appears only in secondary blogs. Apple's own SiriKit and Intents doc metadata (fetched today) shows no deprecation marker, so treat it as unconfirmed; it doesn't change the plan either way.

**Sources:** <https://support.apple.com/en-us/121115> · <https://developer.apple.com/documentation/foundationmodels> · <https://developer.apple.com/videos/play/wwdc2026/240/> · <https://www.macworld.com/article/2813651/sorry-siri-fans-dont-expect-those-delayed-apple-intelligence-features-until-2026.html>

### 🟡 Partly — Free Apple ID limits that affect personal-data features (and replacements)
*Fact-check: corrected*

**What's possible:** NOT available on the free membership (per Apple's capability table): Push notifications, Time Sensitive Notifications, Communication Notifications, Siri (the SiriKit capability), iCloud (CloudKit, Documents, KVS), Family Controls, Journaling Suggestions, WeatherKit, Sign in with Apple, App Groups is AVAILABLE, Background modes AVAILABLE, Keychain sharing AVAILABLE, Data protection AVAILABLE, HealthKit AVAILABLE, HomeKit AVAILABLE, Maps AVAILABLE.

Personal Team limits: up to 10 App IDs and 3 devices, both expiring after 7 days; provisioning profiles expire after 7 days; at most 3 apps per device. Certificates, Identifiers & Profiles, TestFlight and App Store Connect are paid-only.

AlarmKit (iOS 26, NSAlarmKitUsageDescription, AlarmManager.requestAuthorization()) needs no capability, and its alarms 'override both a device's focus and silent mode'. It is the free replacement for Time Sensitive notifications (medication alarms).

App Intents / AppShortcutsProvider do NOT need the Siri capability. Local network calls from the app to the Mac need NSLocalNetworkUsageDescription (plus NSBonjourServices if using Bonjour).

**Correction:** The list was right but incomplete. The capability table gives the free 'Apple Developer' membership exactly nine iOS capabilities: App groups, Background modes, Data protection, HealthKit, HomeKit, Inter-App Audio, Keychain sharing, Maps, and Wireless Accessory Configuration. Maps comes with a note: free members 'can use the MapKit framework but you can't provide routing directions'. Everything else is paid-only. Beyond those already listed, that includes Access WiFi Information (so the app cannot read the Wi-Fi network name to tell it is home), Associated Domains, App Attest, NFC Tag Reading, Network Extensions, Personal VPN, Push to Talk, Increased Debugging Memory Limit, Sustained Execution and Wallet. Separately, App Transport Security on iOS 17+ blocks plain-http connections to raw IP addresses by default. If the app calls the Mac as http://192.168.x.x, add NSAllowsLocalNetworking=YES (or an exception for that IP); .local names are allowed.

**How (for Kairos):** Add NSLocalNetworkUsageDescription now. Use AlarmKit for 'time to take your tablets' alarms, with a secondary button that opens Kairos. Re-sign the app every 7 days. Count the iCTRL XCUITest runner app against the 3-app limit. Move to the $99 account for push notifications, Time Sensitive alerts and longer-lived builds after the hackathon.

**Limits:** Free Personal Team. Every extension (an AlarmKit countdown widget, a Live Activity widget) uses another of the 10 App IDs allowed per 7 days. With no push notifications, the Mac cannot wake the phone app; Kairos can only be reached while it is running, for example during an active audio session, or through Shortcuts automations. Re-sign within 7 days.

**Evidence:** Parsed capability table, last column 'Apple Developer' (https://developer.apple.com/help/account/reference/supported-capabilities-ios). Personal Team limits: 10 App IDs and 3 devices that expire after 7 days, 3 apps per device, profiles that expire after 7 days (https://developer.apple.com/support/compare-memberships/). AlarmKit: alarms override 'both a device's focus and silent mode'; without NSAlarmKitUsageDescription the app can't schedule alarms; a widget extension is expected if the app uses a countdown (https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit). ATS: 'In iOS 17... ATS no longer allows connections to IP addresses by default' (https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).

**Sources:** <https://developer.apple.com/help/account/reference/supported-capabilities-ios> · <https://developer.apple.com/support/compare-memberships/> · <https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit> · <https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy>

**Also important (added by the fact-checker):**

- Medications API: authorization must use requestPerObjectReadAuthorization(for: HKObjectType.userAnnotatedMedicationType(), predicate:). Putting it in requestAuthorization(toShare:read:) fails with errorInvalidArgument. The API is read-only, so Kairos can't record a voiced 'I've taken my tablets' in Health; it has to keep its own dose log on the Mac hub or open the Health app.
- Calling and safety: a tel: URL opened from an app always shows a system 'Call?' confirmation (iOS 10.3+). No API can trigger Emergency SOS or read Medical ID or emergency contacts. For an elderly 'call my daughter' flow, plan for that extra tap, or have the iCTRL agent press it.
- Owner-only gating: LocalAuthentication (Face ID, NSFaceIDUsageDescription) works on the free team and the iPhone 12 Pro Max has Face ID. Use it to unlock sensitive reads (Health, messages summary). iOS offers no speaker-verification API, so voice verification has to be custom-built, with Face ID or passcode as the fallback.
- Data protection while locked: besides Health, any app file or Keychain item using 'complete' protection is unreadable while the phone is locked. Store the Mac-hub token and any cached data as AfterFirstUnlock so a locked background voice session can still reach the hub.
- Reduced (approximate) location turns off region monitoring and geofences. Detect accuracyAuthorization == .reducedAccuracy and ask for precise location in plain language.
- ATS on iOS 17+ blocks plain-http calls to raw IP addresses by default. Add NSAllowsLocalNetworking=YES alongside NSLocalNetworkUsageDescription, or use the Mac's .local name.
- HealthKit needs an explicit App ID tied to this Personal Team. If the bundle ID was ever registered by another team, signing fails with 'Failed Registering Bundle Identifier'.
- Free team: Access WiFi Information is paid-only, so the app can't read the Wi-Fi network name to know it is 'at home'; use a CLMonitor geofence instead. WeatherKit is paid-only, so 'what's the weather?' should go through a free weather API called from the Mac.
- Data a family member shares with the user through Health Sharing is probably not readable by HealthKit apps (unverified). Assume Kairos sees only the phone owner's own Health data.
- wacli uses an unofficial WhatsApp Web client, so the WhatsApp account could be flagged or banned under WhatsApp's terms (inferred risk). Use a test account for the demo if possible.

**Surprises:**

- HealthKit and HomeKit DO work on the free Apple ID per Apple's current capability table (checked 24 Oct 2026), despite older forum posts saying otherwise. The table marks Push notifications, Time Sensitive notifications, Communication Notifications, Siri (the SiriKit capability), iCloud, Family Controls, Journaling Suggestions and WeatherKit as paid-only. App Intents shortcuts (your 'Talk to Kairos') need no Siri capability.
- iOS 27 shipped on 14 Sep 2026 and supports the iPhone 12 Pro Max. Its new Shortcuts Notification trigger ('When I receive a notification from [App]', filters on Title, Subtitle and Message) is the first official way to react to WhatsApp or other app notifications on the phone. But do NOT update the phone before tomorrow's demo: one source says deploying to iOS 27 needs Xcode 27, which needs macOS 26.6, and this Mac is on macOS 26.5 (Darwin 25.5).
- iOS 26 added a read-only HealthKit Medications API (HKUserAnnotatedMedication, HKMedicationDoseEvent, approved medicine by medicine). It fits the elderly 'did I take my tablets?' use case well, but only if the user logs medicines in the Health app.
- Apple encrypts the Health store while the phone is locked. A background Kairos session (audio mode) on a locked phone may fail to read Health data. Cache Health summaries to the Mac hub whenever the phone is unlocked.
- iPhone notifications mirrored to the Mac (iPhone Mirroring, macOS 15+, iOS 18+) are available in the UK but not the EU. Together with Messages in iCloud (chat.db, readable with Full Disk Access), the Mac hub can see messages and notifications that the iPhone app never can. Whether mirrored notifications land in the Mac's notification database is unverified; test it.
- AlarmKit (iOS 26) works on the free account with no capability and overrides Focus and silent mode. Use it instead of Time Sensitive notifications for medication and appointment alarms; it also fits the TIME theme.
- The free Personal Team allows 3 apps per device, 10 App IDs per 7 days, and profiles that expire after 7 days. The iCTRL XCUITest runner is installed as an app, so it likely uses one of the 3 slots, and the demo build must be re-signed within 7 days.
- Apple's HealthKit rules forbid passing HealthKit data to third parties except health or fitness services the user has agreed to. Sending raw Health values through ElevenLabs' cloud LLM or TTS would conflict with this and with the privacy-first pitch. Keep Health reasoning on the Mac's Ollama and only voice minimal summaries.
- Calling the Mac over the local network from the app (and from Shortcuts) triggers iOS's Local Network permission prompt; add NSLocalNetworkUsageDescription or the hub calls fail silently once denied.
- SiriKit got a formal deprecation notice at WWDC26 (one secondary source). App Intents / App Schemas is the path forward for Siri integration, which matches the current Kairos design.

## Acting inside other apps and on-device AI

### ❌ No — Kairos (a normal sandboxed iOS app) reads or drives other apps' UI directly, like an Accessibility or agent API
*Fact-check: corrected*

**What's possible:** iOS has no public cross-app Accessibility API for third parties. There is no AXUIElement-style API on iOS. UIAccessibility only describes your own app's views to VoiceOver and other assistive tech. App Review Guideline 2.5.1 says apps 'may only use public APIs', and 2.5.2 says apps 'may not read or write data outside the designated container area'. There is also no public API to launch an arbitrary app by bundle ID. In thread 740707, Apple DTS says there is 'no supported way' to control app opening from App Intents, and the closest option, ForegroundContinuableIntent, still leaves the decision to the user. A forum question about iOS 27 (thread 850613) has no Apple answer, so nothing has changed. Apple's own cross-app agent (Siri AI in iOS 27) works through App Intents and schemas that each app chooses to adopt, not through UI scraping.

**Correction:** The verdict holds, but two supporting details are off. (1) Apple's DTS reply in thread 740707 dates from 2024 and names ForegroundContinuableIntent, which Apple's docs now mark deprecated as of iOS 26.0 ('include .foreground(.dynamic) in the supportedModes of your app intent instead'). The modern equivalent, supportedModes, still only covers Kairos's own app and can't open other apps. (2) Thread 749494 is about macOS sandboxed apps and AXUIElement, not iOS. It is relevant to the Mac hub instead: a sandboxed Mac app can't use the AX API, so the Mac agent must run unsandboxed with Accessibility permission. Thread 850613 (an iOS 27 / Xcode 27 question asking whether there is an API to open an app by bundle ID) has 0 replies, as reported.

**How (for Kairos):** Treat on-phone 'acting' as three separate channels: (a) deterministic URL schemes and universal links (tel:, sms:, wa.me, maps), (b) Shortcuts the user has installed, run by URL (see the Shortcuts finding), (c) the developer-only XCUITest runner (iCTRL) for demos. For anything the agent must reliably do, do it on the Mac hub (WhatsApp through wacli, Messages on the Mac, calendar or contacts through the Mac's APIs) instead of on the phone's UI.

**Limits:** Applies to all iOS versions, including 26.5 on the iPhone 12 Pro Max, in the UK, and with either a free or a paid account. Use URL schemes, user-installed Shortcuts, iCTRL for the demo only, or Mac-side execution.

**Evidence:** App Review Guidelines: 2.5.1 says apps 'may only use public APIs'; 2.5.2 says they 'may not read or write data outside the designated container area' (https://developer.apple.com/app-store/review/guidelines/). DTS, thread 740707: 'There's no supported way…' (https://developer.apple.com/forums/thread/740707). Doc JSON for ForegroundContinuableIntent shows deprecatedAt iOS 26.0 (https://developer.apple.com/documentation/appintents/foregroundcontinuableintent). Thread 749494, Apple staff: 'It is not possible to use the accessibility API from a sandboxed app' (that thread is about macOS).

**Sources:** <https://developer.apple.com/app-store/review/guidelines/> · <https://developer.apple.com/forums/thread/740707> · <https://developer.apple.com/forums/thread/850613> · <https://developer.apple.com/forums/thread/749494>

### 🔧 Workaround — Seeing what is on screen in other apps, as pixels for OCR or a vision model on the Mac (ReplayKit Broadcast Upload Extension)
*Fact-check: corrected*

**What's possible:** 

**Correction:** It works on iOS 26.5, but on iOS 27 more is deprecated than the researcher said. Not only RPSystemBroadcastPickerView but also RPBroadcastSampleHandler itself (the class the Broadcast Upload Extension subclasses) is marked deprecated at iOS 27.0, with the message 'No longer supported'. The picker's message reads 'Use ScreenCaptureKit SCContentSharingPicker instead', and SCContentSharingPicker is iOS 27.0+, so it can't be used on iOS 26.5 or with the Xcode 26 SDK. The ~50 MB extension memory cap comes from community and vendor reports (Zego, Twilio, forum 651367), not Apple documentation. The App Group needed to share frames between the extension and the app is available to free accounts according to Apple's capabilities table.

**Limits:** iOS 26.5 on the iPhone 12 Pro Max: works. The user starts every session, the red indicator shows, and it is watch-only. Keep memory around 50 MB (reported, not documented) by downscaling the 1284x2778 frames. It breaks if the phone updates to iOS 27. Works with a free account.

**Evidence:** Doc JSON: RPSystemBroadcastPickerView is iOS 12.0, deprecated 27.0 ('Use ScreenCaptureKit SCContentSharingPicker instead'); RPBroadcastSampleHandler is iOS 10.0, deprecated 27.0 ('No longer supported'); SCContentSharingPicker is iOS 27.0+ (developer.apple.com/documentation/replaykit/...). Apple engineer, thread 831465: 'ScreenCaptureKit will be used for screen sharing starting in iOS 27.' Supported capabilities table: App groups = yes for the free 'Apple Developer' tier (https://developer.apple.com/help/account/reference/supported-capabilities-ios). Guideline 2.5.14 requires explicit consent and a clear visual or audible indication when recording.

### 🟡 Partly — Kairos runs the user's Shortcuts (and so other apps' App Intents) programmatically and gets the result back
*Fact-check: corrected*

**What's possible:** There is no in-process API that lets one app run another app's App Intent, or run a user's shortcut, silently. App Intents run only through Siri, Shortcuts, Spotlight, widgets, Focus filters, or automations. The supported bridge is the Shortcuts URL scheme. Plain run: shortcuts://run-shortcut?name=[name]&input=text&text=[text] (input can also be clipboard). Run with a callback: shortcuts://x-callback-url/run-shortcut?name=...&input=text&text=...&x-success=kairos://done&x-cancel=...&x-error=.... On success, Shortcuts appends a `result` parameter with the shortcut's textual output only. x-error appends `errorMessage`, and x-cancel returns nothing. Opening the URL brings the Shortcuts app to the foreground, then x-success reopens Kairos. Kairos's audio session should survive in the background because it has UIBackgroundModes=audio and an active WebRTC session; this is not verified for every case, so test it. The first time a shortcut accesses data or opens another app, Shortcuts may show a privacy prompt with an 'Always Allow' option.

**Correction:** The URL formats and callbacks are confirmed. The key limit the researcher left out is that this only works while Kairos is in the foreground. Quinn (DTS) says that when 'your app is in the foreground and opens a URL', the target app comes to the front, and that there is 'no direct way' for a background app to bring itself forward other than a notification the user taps. A community answer says calling openURL from the background 'won't do anything'. So the 'Kairos keeps talking in the background while it fires shortcuts' pattern fails. Each shortcut run needs Kairos in front, and x-success brings it back. The simulator bug is narrower than reported: in a community thread with no Apple reply, simulators on 26.3.1 work, 26.4.1 works partly, and 26.5 and 27 fail ('couldn't find the AppShortcutsProvider'). Physical devices aren't affected.

**How (for Kairos):** Ship a small set of 'Kairos tool' shortcuts and install them once on the phone, for example 'Kairos Call' (Phone 'Call' action), 'Kairos Text' (Messages 'Send Message' with Show When Run off), 'Kairos WhatsApp' (WhatsApp's 'Send Message' action), and 'Kairos Health' (Find Health Samples). Each one ends with 'Get Contents of URL' that POSTs to the Mac, or returns text through x-success to kairos://callback. Call them with UIApplication.shared.open(url). Have the agent say 'one moment' because of the visible app switch. Use open(_:options:completionHandler:), which needs no LSApplicationQueriesSchemes entry.

**Limits:** Kairos must be in the foreground to trigger shortcuts. The visible switch to Shortcuts and back stays. Results come back as text only. The user installs and approves the shortcuts once. iOS 26.5 on the iPhone 12 Pro Max with a free account: OK. Test on the device, not the 26.5 simulator.

**Evidence:** Apple Shortcuts guide: x-success appends 'result', which 'contains the textual output of the shortcut'; x-error appends errorMessage; x-cancel returns no output (https://support.apple.com/en-gb/guide/shortcuts/apdcd7f20a6f/ios). Run-from-URL format shortcuts://run-shortcut?name=[name]&input=[input]&text=[text], where input can be clipboard (https://support.apple.com/en-gb/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/9.0/ios/26). DTS: https://developer.apple.com/forums/thread/700598. Community: https://developer.apple.com/forums/thread/7307. Doc: open(_:options:) isn't constrained by LSApplicationQueriesSchemes (canOpenURL doc).

**Sources:** <https://support.apple.com/en-gb/guide/shortcuts/apdcd7f20a6f/ios> · <https://support.apple.com/en-gb/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/9.0/ios/26> · <https://developer.apple.com/forums/thread/740707> · <https://developer.apple.com/forums/thread/835888> · <https://developer.apple.com/documentation/uikit/uiapplication/canopenurl(_:)>

### ✅ Yes — The reverse direction: the system (Siri, Shortcuts automations) calls into Kairos, including feeding incoming iMessages and SMS to the agent
*Fact-check: corrected*

**What's possible:** Kairos's AppIntent and AppShortcutsProvider already make it callable from Siri ('Hey Siri, talk to Kairos'), Spotlight, the Action button on newer phones, and Shortcuts, on any iOS 16+ device including the iPhone 12 Pro Max. This works with classic Siri and doesn't need Apple Intelligence. Shortcuts personal automations add event triggers. The Message trigger has 'Sender' and 'Message Contains' options (all criteria must match). There are also Email (Sender, Subject Contains, Account, Recipient), App 'Is Opened' and 'Is Closed', Time of Day, Arrive and Leave, Wi-Fi, and others. Turning off 'Ask Before Running' (or choosing 'Run Immediately') makes an automation run without a prompt. This is the only Apple-sanctioned way to get the contents of incoming iMessages or SMS into Kairos on the phone. No public API reads the Messages database on iOS.

**Correction:** Siri, Shortcuts and Spotlight calling into Kairos is solid: App Shortcuts don't need the Siri entitlement, which the free tier doesn't get anyway. Corrections: (1) The iPhone 12 Pro Max has no Action button. (2) authenticationPolicy defaults to running without authentication 'including when the device is locked', so the existing 'Talk to Kairos' intent currently works from the lock screen. Set .requiresAuthentication on anything that reveals data. (3) Apple's page confirms only the trigger options (Message: Sender and Message Contains; all criteria must match). Community guides show Shortcut Input used as the reply recipient, meaning it carries the sender, but no source confirms that the message body comes through. tinyapps notes a catch-all can match sender or content but not both. (4) The Message trigger covers Messages only. No supported API captures incoming WhatsApp on the phone.

**How (for Kairos):** Create an automation: Message trigger (Sender = family contacts) → Run Immediately → 'Get Contents of URL' POST {sender, message} to the Mac hub, or run a Kairos App Intent with a String parameter. Expose Kairos intents with return values (for example 'Ask Kairos' returning a String, with ProvidesDialog) so the user's own shortcuts can chain Kairos into other apps' actions. Set static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication on sensitive intents so they can't run from the lock screen.

**Limits:** Each automation has to be created by hand on the phone. Verify on the device whether the message body arrives in Shortcut Input (for example with Get Details of Messages → Content). iOS 26.5, UK, free account: OK.

**Evidence:** Apple: Message trigger options are Sender and Message Contains (https://support.apple.com/guide/shortcuts/apdd711f9dff/ios). authenticationPolicy doc: the default 'allows the intent to run without authentication, including when the device is locked' (https://developer.apple.com/documentation/appintents/appintent/authenticationpolicy). Siri entitlement doc: needed only for Intents extensions handling Siri requests 'other than shortcut requests'. tinyapps (2026-04-17) uses Shortcut Input as the recipient (https://tinyapps.org/blog/ios-autoreply-text.html).

**Sources:** <https://support.apple.com/guide/shortcuts/apdd711f9dff/ios> · <https://support.apple.com/guide/shortcuts/intro-to-personal-automation-apd690170742/ios> · <https://developer.apple.com/videos/play/wwdc2022/10032/> · <https://developer.apple.com/videos/play/wwdc2026/347/> · <https://tinyapps.org/blog/ios-autoreply-text.html>

### 🟡 Partly — Placing phone calls from Kairos
*Fact-check: confirmed*

**What's possible:** Apple's Phone Links reference says: 'When a user opens a URL with the tel scheme in a native app, iOS 10.3 and later displays an alert and requires user confirmation before dialing.' The same applies to facetime and facetime-audio URLs. If a tel: URL contains * or #, the Phone app does not dial it. CallKit (CXStartCallAction) and LiveCommunicationKit only handle your own app's VoIP calls; they can't place cellular calls. Other routes: a Shortcuts 'Call' action inside a shortcut the user installed (community reports say it dials from an automation), or iCTRL tapping the 'Call' confirmation button (developer-only).

**How (for Kairos):** For the elderly UX, treat the system prompt as a safety feature. Kairos says 'I'm calling Sarah, tap the green Call button', then calls UIApplication.shared.open(URL(string: "tel:+447...")!). Use E.164 numbers from Contacts (CNContactStore) and percent-escape them. If calls must be hands-free for the demo, use the 'Kairos Call' shortcut through x-callback, and only after a spoken owner confirmation plus a PIN.

**Limits:** No App Store app can suppress the alert. Same on iOS 26.5 and 27, in the UK, with free or paid accounts. Hands-free dialing works only through a user-installed Shortcut or iCTRL.

**Evidence:** Phone Links: 'iOS 10.3 and later displays an alert and requires user confirmation before dialing'; URLs containing * or # are not dialed (https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/PhoneLinks/PhoneLinks.html). Thread 73406 asks why openURL with tel: requires user confirmation in iOS 10.3. A July 2026 user on iOS 26 reports 'I can establish call using Shortcut/Automation' (https://discussions.apple.com/thread/256323230).

**Sources:** <https://developer.apple.com/library/ios/featuredarticles/iphoneurlscheme_reference/phonelinks/phonelinks.html> · <https://developer.apple.com/forums/thread/73406> · <https://discussions.apple.com/thread/256323230>

### 🟡 Partly — Sending SMS, iMessage and WhatsApp messages from Kairos
*Fact-check: confirmed*

**What's possible:** SMS and iMessage: MFMessageComposeViewController lets you prefill recipients, body and attachments. Apple's docs say it presents the message 'for a person's approval': the person can edit it, then taps Send or Cancel. Check canSendText() first. The sms: URL scheme also only opens Messages with a prefilled message. There is no public API for silent sending, and none for reading Messages on iOS. WhatsApp: the official universal link https://wa.me/<international number, no + or 0 or dashes>?text=<urlencoded> opens the chat with the text prefilled, and the user taps Send. whatsapp://send?text=... is documented without a recipient (it opens a picker). Silent send is only possible through (a) a Shortcuts 'Send Message' or WhatsApp 'Send Message' action with Show When Run off (community-reported), (b) the Mac: Messages on macOS with Messages in iCloud or Text Message Forwarding can send iMessage and SMS (scriptable through the Messages AppleScript dictionary) and read ~/Library/Messages/chat.db with Full Disk Access, and wacli for WhatsApp, or (c) iCTRL tapping Send.

**How (for Kairos):** On the phone, default to prefill-and-confirm: 'I've written: "Running 10 minutes late". Tap the blue arrow to send.' For agent-initiated sends, route through the Mac hub (wacli for WhatsApp, Messages.app for iMessage and SMS once Text Message Forwarding is on), with owner voice verification or a PIN plus a spoken read-back of the recipient and text. Add 'whatsapp' to LSApplicationQueriesSchemes only if you need canOpenURL; open() doesn't need it.

**Limits:** The user must tap Send on the phone. Silent sends happen only through user-built Shortcuts (community-reported), the Mac (Messages.app with Text Message Forwarding, or wacli), or iCTRL. Same on iOS 26.5 and 27, in the UK.

**Evidence:** MFMessageComposeViewController doc: it 'only lets you construct the initial message and present it for a person's approval'; check canSendText first (https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller). Automators forum thread on WhatsApp Shortcut action errors (talk.automators.fm/t/whatsapp-message-via-automation-error/17194).

**Sources:** <https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller> · <https://faq.whatsapp.com/5913398998672934> · <https://whatsapp.com/faq/iphone/23559013> · <https://support.apple.com/en-us/102545> · <https://talk.automators.fm/t/what-is-something-clever-youve-made-in-shortcuts-recently/17257>

### 🔧 Workaround — iCTRL / WebDriverAgent-style XCUITest runner driving any app on the iPhone
*Fact-check: confirmed*

**What's possible:** 

**Limits:** Demo only and not distributable. Remount the DDI after any reboot. Free certificates expire after 7 days. Developer Mode lowers device security. Keep remote access LAN-only. iOS 26.5 on the iPhone 12 Pro Max is supported (iOS 16+).

**Evidence:** iCTRL README: DDI 'does not survive a reboot'; JSON-RPC on port 8200, 127.0.0.1-only by default, with a 'Remote Access' toggle for LAN; iOS 16+; unlock can't enter a passcode; Auto-Lock Never recommended; 'not App Store safe' (private XCTest and LSApplicationWorkspace APIs); free accounts get 7-day certs and 3 apps, with SideStore counting as one (https://raw.githubusercontent.com/OpenMinis/iCTRL/HEAD/README.md). Apple: Developer Mode 'reduces the security of your device', and enabling it means restarting, tapping Enable and entering the passcode (https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device). Thread 740785 reports the Enable UI Automation passcode prompt returning after hours or days (iOS 15).

### 🔧 Workaround — Supported alternative 'hands' with no Developer Mode: the Mac controls the iPhone through iPhone Mirroring
*Fact-check: corrected*

**What's possible:** iPhone Mirroring is Apple's supported way to see and control the whole iPhone UI from a Mac. Requirements: macOS Sequoia 15+ on Apple silicon or a T2 Mac (the M3 MacBook Pro qualifies), iOS 18+ with a passcode, the same Apple Account with two-factor authentication on both, Bluetooth and Wi-Fi on, and the iPhone locked and nearby (it can be charging or in StandBy). The Mac can't be sharing its internet connection or using AirPlay or Sidecar. It's available in the UK; Apple says it 'is currently unavailable in the European Union'. While mirroring, the iPhone stays locked and shows that it's in use. Unlocking the iPhone ends the session, and the connection pauses after inactivity. A Mac agent can drive the iPhone Mirroring window with screenshots plus synthetic clicks and typing (CGEvent), given macOS Screen Recording and Accessibility permissions. The window is a video surface, so expect to work from pixels (vision or OCR) rather than an accessibility tree. That last point is an inference, not documented.

**Correction:** The requirements and UK availability are confirmed. The open question about audio is now answered, and the answer hurts the plan. Apple says the iPhone's camera and microphone aren't available in iPhone Mirroring (including for phone calls), and iPhone audio plays through the Mac unless headphones are connected to the iPhone. So Kairos's on-phone voice loop can't use the phone mic while mirroring; the voice side has to run on the Mac. Driving the window with CGEvent plus Vision OCR is supported by third-party tools such as mirroir-mcp, which uses the CGEvent API, Vision OCR, and Screen Recording plus Accessibility permissions. It is not Apple-documented, and Mirroring exposes only a single pointer touch.

**How (for Kairos):** Use it as a fallback demo of the 'laptop agent acting on the phone' without iCTRL's Developer Mode, DDI and 7-day cert overhead, for example 'Kairos, open my pharmacy app and reorder'. The phone sits locked on the table while the Mac performs the task on screen. It suits a story where Kairos's voice continues on the Mac or AirPods while the phone is used remotely.

**Limits:** The phone must stay locked and the phone mic is unavailable. Voice runs on the Mac, or on AirPods paired to the Mac. Needs the same Apple Account on both devices. UK OK, not the EU. iOS 26.5 on the iPhone 12 Pro Max qualifies.

**Evidence:** Apple: 'iPhone Mirroring is currently unavailable in the European Union'. Requirements are macOS 15+, Apple silicon or T2, iOS 18+ with a passcode, the iPhone locked and nearby, the same Apple Account with 2FA, and the Mac not sharing its internet or using AirPlay or Sidecar. Unlocking the iPhone ends mirroring (https://support.apple.com/en-gb/120421). Search summary of Apple's iPhone Mirroring pages: camera and mic not available, and iPhone audio plays through the Mac. mirroir-mcp README (https://github.com/jfarcand/mirroir-mcp).

**Sources:** <https://support.apple.com/en-gb/120421>

### ❌ No — On-device AI on the iPhone 12 Pro Max: Apple Foundation Models framework and the Shortcuts 'Use Model' action
*Fact-check: corrected*

**What's possible:** SystemLanguageModel (FoundationModels, iOS 26.0+) is 'the on-device text foundation model that powers Apple Intelligence', and its availability 'depends on whether the device and region supports Apple Intelligence'. On an iPhone 12 Pro Max (A14), SystemLanguageModel.default.availability returns .unavailable(.deviceNotEligible). Apple Intelligence iPhones are: iPhone 15 Pro and 15 Pro Max, all iPhone 16 and later, iPhone Air, and iPhone Duo. The model has had three versions: 26.0-26.3, 26.4, and 27.0. The Shortcuts 'Use Model' action (On-Device, Private Cloud Compute or Cloud, and ChatGPT extension) likewise needs an Apple Intelligence device, and Apple's iOS 27 page lists the same iPhones. The Mac M3 is eligible: Apple Intelligence runs on M1 or later, and some features have English (UK) support. So the Mac hub can call SystemLanguageModel on macOS 26 (around 4K context on device, 8192 shown for the iOS 27 model). On macOS 27 there is also the `fm` CLI, the Python SDK, and PrivateCloudComputeLanguageModel (32K context, reasoning levels). PCC needs an entitlement and is free for Small Business Program developers with fewer than 2M first-time downloads, with daily user limits. iOS 27 adds a LanguageModel protocol, so LanguageModelSession can be backed by Claude or Gemini Swift packages, MLX or Core AI local models, or a Chat Completions-compatible endpoint (which could point at Ollama on the Mac). Whether that works on non-Apple-Intelligence iPhones is not documented.

**Correction:** The 'no' for Apple's models on the A14 is confirmed. Smaller fixes: (1) Mac model storage is 'up to 14 GB' on Macs with at least 12 GB of unified memory, otherwise up to 8 GB. (2) Apple's PCC terms are 'no cloud API costs to developers who have less than 2 million first time downloads' plus an entitlement; the session doesn't tie it to the Small Business Program. (3) For the Claude and Gemini Swift packages, Apple said Anthropic and Google 'will soon' ship them; their release isn't verified. The Chat Completions model is in the open-source FM utilities package. (4) LanguageModel is iOS 27.0+, so none of this is usable on iOS 26.5 or with Xcode 26. (5) The 'no' covers only Apple's LLM. Other on-device AI does run on the A14 (see missed items).

**How (for Kairos):** For tomorrow, keep LLM reasoning on the Mac (Ollama qwen2.5:7b) and ElevenLabs. Optionally add a Mac-side FoundationModels Swift tool, or a Mac Shortcut using 'Use Model' run via `shortcuts run` on the Mac, as a second private, on-device model for summarising or classifying personal data. In the iPhone app, always check SystemLanguageModel.default.availability and fall back to the Mac. Don't plan iOS 27 FoundationModels features for this demo: they need the Xcode 27 SDK, and the setup has Xcode 26.0.1.

**Limits:** The iPhone 12 Pro Max is excluded on every iOS version. The Mac M3 is eligible. Keep the LLM on the Mac (Ollama) for the demo.

**Evidence:** SystemLanguageModel doc: availability 'depends on whether the device and region supports Apple Intelligence'; three model versions (26.0–26.3, 26.4, 27.0). Apple Intelligence iPhones: 'iPhone Duo, iPhone 16 models or later, iPhone 15 Pro, iPhone 15 Pro Max, iPhone Air'; Macs: M1 or later (https://support.apple.com/en-gb/121115). Use Model on iOS 27 needs 'an Apple Intelligence-enabled iPhone 15 Pro… or iPhone 16 model or later' (https://support.apple.com/guide/shortcuts/tpg3vrvwmclv). WWDC26 session 241 shows contextSize 8192, the fm CLI, the Python SDK, PCC with 32K context, and the 2M-downloads terms. Session 339: Claude and Gemini packages 'will soon' ship. LanguageModel doc JSON: iOS 27.0+.

**Sources:** <https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel> · <https://support.apple.com/en-gb/121115> · <https://support.apple.com/guide/shortcuts/tpg3vrvwmclv> · <https://support.apple.com/en-mo/guide/shortcuts/tpg3vrvwmclv/ios> · <https://developer.apple.com/videos/play/wwdc2026/241/> · <https://developer.apple.com/videos/play/wwdc2026/339/> · <https://developer.apple.com/ios/whats-new/> · <https://www.macstories.net/notes/i-have-many-questions-about-apples-updated-foundation-models-and-the-great-use-model-action-in-shortcuts/>

### ❌ No — Using Apple's Siri AI (on-screen awareness, App Intents, App Schemas) as the agent that acts across apps
*Fact-check: confirmed*

**What's possible:** Siri AI shipped with iOS 27 on 14 September 2026. It is described as built on next-generation Apple Foundation Models 'custom-built in collaboration with Google and its Gemini models'. It's an English beta with more languages in October, it isn't initially available in the EU on iOS, and it has daily limits. It can act inside apps (Apple's example is texting in WhatsApp), answer questions about what's on screen, and chain content between apps. Third-party apps take part by exposing their own content and actions, using: @AppEntity(schema: .messages.message) and intent schemas (for example sendMessage and draftMessage) grouped into domains; IndexedEntity plus CSSearchableIndex.indexAppEntities for the semantic index; IntentValueQuery for structured search; the View Annotations API (.appEntityIdentifier, AppEntityAnnotatable, UICollectionViewAppIntentsDataSource) for on-screen awareness; Transferable with IntentValueRepresentation for handing data between apps; and IntentDonationManager for donations. The system orchestrates the cross-app steps; a third-party app can't call another app's intents itself. Siri AI only runs on Apple Intelligence devices, and the iPhone 12 Pro Max is excluded even though iOS 27 still supports it. The iOS 26.5 on the user's phone has only classic Siri.

**How (for Kairos):** Don't depend on it for the demo phone. Still adopt App Intents in Kairos (already done: 'Talk to Kairos'), and later add schema-conforming entities and intents (reminders, messages to family, medication logs) so that on newer iPhones Siri AI can hand tasks to Kairos and Kairos content becomes Siri-searchable. If a 15 Pro or newer phone running iOS 27 is available, Siri AI could act as an alternative executor, for example 'text Mary on WhatsApp'.

**Limits:** Needs an Apple Intelligence iPhone on iOS 27, English. Not in the EU or China initially. Apple doesn't spell out UK English. Daily limits apply. Not possible on the demo phone.

**Evidence:** Apple Newsroom, 14 Sep 2026: 'rolling out today in beta in English'; models 'custom-built in collaboration with Google and its Gemini models'; 'will not be available initially in the EU on iOS'; daily usage limits; texting a friend in WhatsApp given as an example (https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/). 9to5Mac: iOS 27 supports iPhone 12 Pro Max (https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/).

**Sources:** <https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/> · <https://www.apple.com/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/> · <https://developer.apple.com/videos/play/wwdc2026/240/> · <https://developer.apple.com/videos/play/wwdc2026/343/> · <https://developer.apple.com/ios/whats-new/> · <https://9to5mac.com/2026/06/08/ios-27-here-are-all-the-compatible-iphone-models/>

### ✅ Yes — Making sure agent actions happen only on the owner's command, and are safe against prompt injection
*Fact-check: confirmed*

**What's possible:** 

**Limits:** authenticationPolicy is iOS 16+, so it is usable now on 26.5. The FM lifecycle modifiers are iOS and macOS 27 only. Pair voice verification with a PIN or LAContext.

**Evidence:** Session 347: the 'Lethal Trifecta' framing (private data, untrusted content, external communication or side effects); focus on 'deterministic mitigations as a baseline'; spotlighting 'is a probabilistic mitigation'; if an .onToolCall callback throws, 'the tool is never executed'; a weaker policy on a schema intent gives 'a build error' (https://developer.apple.com/videos/play/wwdc2026/347/). Guideline 5.1.2(i): 'clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission'. Session 343 covers OwnershipProvidingEntity (.shared, .public, .unknown).

**Also important (added by the fact-checker):**

- Opening URLs from the background doesn't work. Only a foreground app can open tel:, sms:, wa.me or shortcuts:// and bring another app forward; DTS says there's 'no direct way' for a background app to come forward, other than a notification the user taps. So while Kairos keeps talking in the background, phone-side actions can't fire. Either keep Kairos in front with its big button, or run actions on the Mac hub (https://developer.apple.com/forums/thread/700598).
- Free versus paid account, per Apple's capabilities table. The free 'Apple Developer' tier gets App Groups, Background Modes, HealthKit, HomeKit, Keychain sharing and Maps (no routing). It does NOT get Push Notifications, Associated Domains (no universal links for Kairos), Siri (SiriKit; App Shortcuts don't need it), Time Sensitive or Communication Notifications, iCloud/CloudKit, Network Extensions/Personal VPN, Access WiFi Information, Extended Virtual Addressing, Increased Debugging Memory Limit, or Sustained Execution. So the Mac hub can't push-wake Kairos or update a Live Activity remotely without the $99 account (https://developer.apple.com/help/account/reference/supported-capabilities-ios).
- ForegroundContinuableIntent and the old openAppWhenRun pattern are deprecated in iOS 26. Use supportedModes (.background, .foreground(.immediate/.dynamic/.deferred)). Kairos intents marked .background can return values to the user's Shortcuts without an app switch, which is the cleanest Shortcuts → Kairos → Mac pipeline.
- authenticationPolicy defaults to running when the phone is locked, so 'Hey Siri, talk to Kairos' currently works from the lock screen for anyone. Give Kairos a restricted lock-screen mode and set .requiresAuthentication on intents that reveal health, contacts or messages, or that act.
- On-device AI that does run on the A14 (6 GB RAM) without Apple Intelligence: Vision OCR, Core ML, on-device SFSpeechRecognizer, SpeechAnalyzer/SpeechTranscriber (one developer reports it works on iPhone 12; no official device list; DictationTranscriber is the fallback), and small local LLMs through MLX Swift or llama.cpp (about 0.5–1.5B parameters at 4-bit). These give an offline fallback when the Mac is unreachable.
- Assistive Access fits elderly users well. iOS 26 adds a SwiftUI AssistiveAccess scene and the UISupportsAssistiveAccess Info.plist key, so Kairos can show as 'Optimized for Assistive Access' in the carer-configured simplified home screen. The iPhone 12 Pro Max supports it.
- Voice Control (Settings > Accessibility > Voice Control, with 'Show numbers' and 'Tap 5') is Apple's built-in, system-wide way to operate any app's UI by voice. It works on the iPhone 12 Pro Max in English without Developer Mode, but Kairos can't drive it programmatically, and both compete for the microphone.
- The iPhone 12 Pro Max has no Action button, and side-button reassignment is Japan-only (iOS 26.2+, Side Button Access entitlement, Apple Account region Japan and physically in Japan, per Apple's doc). Back Tap (Accessibility > Touch > Back Tap → run a 'Talk to Kairos' shortcut) is the closest hardware-like trigger available in the UK.
- Audio session interruptions: cellular calls (including ones Kairos starts), Siri and other apps' audio interrupt Kairos's AVAudioSession and the ElevenLabs/LiveKit WebRTC session. Handle AVAudioSession.interruptionNotification and reconnect, or the 'keeps talking' promise breaks during a call.
- Incoming WhatsApp messages can't be captured on the iPhone at all. The Shortcuts Message trigger covers Messages only, and no API reads other apps' notifications, so WhatsApp ingest has to stay on the Mac through wacli.
- The iOS 27 auto-update risk is confirmed. Apple's Xcode table lists device support for Xcode 26.0.1 as 'iOS 15–26', so iOS 27 needs Xcode 27. RPBroadcastSampleHandler is also marked deprecated and 'No longer supported' at iOS 27.0. Turn off automatic updates before the demo.
- BGContinuedProcessingTask (iOS 26) lets a task the user starts keep running after they leave the app, with system-shown progress the user can cancel. It is an option for long background agent jobs when Kairos isn't holding an audio session.
- The web search budget ran out during verification, so the 'about 10 App IDs per 7 days' free-account limit and the claim that WhatsApp's 'Send Message' action sends silently were not re-checked against fresh sources.

**Surprises:**

- iOS 27 shipped on 14 September 2026 and still supports the iPhone 12 Pro Max, but Siri AI and Apple Intelligence don't run on it. The phone is on iOS 26.5. Turn off Settings > General > Software Update > Automatic Updates before the demo: an overnight update to iOS 27 could break deploys from Xcode 26.0.1 and the iCTRL DDI mount. That compatibility risk is likely but not confirmed.
- Replacing Siri on the side button with a third-party assistant exists only in Japan (iOS 26.2, under Japan's Mobile Software Competition Act, for Japanese Apple Accounts located in Japan). It isn't available in the UK or EU, so a long-press of the side button can't offer Kairos on a UK phone. Use 'Hey Siri, talk to Kairos', Back Tap running a Kairos shortcut, or the Lock Screen and Control Center controls instead. Source: https://www.macrumors.com/2025/11/17/ios-26-2-iphone-users-eu-siri-replacement/
- Siri AI in iOS 27 can already act in WhatsApp and other apps through App Intents and App Schemas, using Google Gemini-backed Apple Foundation Models. It's an English beta with daily limits, not available in the EU on iOS, and only on Apple Intelligence iPhones (15 Pro or later). A third-party app still can't call other apps' intents itself.
- In iOS 27, Foundation Models opened up: a LanguageModel protocol lets LanguageModelSession run Claude or Gemini (official Swift packages), MLX or Core AI local models, or any Chat Completions endpoint. PrivateCloudComputeLanguageModel (32K context) is free for Small Business Program developers with an entitlement, and there's an `fm` CLI and Python SDK on macOS 27. The Mac M3 qualifies, but the iPhone 12 Pro Max can't use Apple's own models.
- canOpenURL(_:) is deprecated as of iOS 27, and apps linked against the iOS 27 SDK may list only 25 LSApplicationQueriesSchemes entries, down from 50. Call open(_:options:completionHandler:) directly and handle a false result.
- ReplayKit's system broadcast picker is listed as available only through iOS 27.0. An Apple engineer says ScreenCaptureKit (SCContentSharingPicker) replaces broadcast extensions for screen sharing on iOS starting in iOS 27.
- iPhone Mirroring is available in the UK (not the EU). It lets the Mac see and control the entire iPhone UI with no Developer Mode, DDI or 7-day cert, which makes it a supported fallback for the 'agent on the laptop acts on the phone' demo. The catch is that the iPhone must stay locked during mirroring.
- Shortcuts' Message trigger (Sender / Message Contains), set to run immediately, is the only Apple-sanctioned way to pipe incoming iMessage and SMS content to the Mac hub from the phone.
- Apple's own WWDC26 security session describes Kairos's exact risk profile (private data + untrusted messages + calls and sends) as the 'lethal trifecta'. Cite it in the demo pitch for why WhatsApp text is never treated as instructions and why calls and sends need owner confirmation.
- Per a developer forum thread, Shortcuts and App Intents don't work on simulators from iOS 26.4. Test the AppIntent and AppShortcutsProvider flow only on the physical phone.

## Distribution, accounts and App Store rules

### 🟡 Partly — Keep Kairos installed and working on an older person's iPhone using only the free Apple ID (Personal Team)
*Fact-check: corrected*

**What's possible:** Apple's published Personal Team limits, as of Oct 2026: up to 10 App IDs, which expire after 7 days; up to 3 registered devices, which also expire after 7 days; up to 3 apps installed per device. Provisioning profiles expire 7 days after issue, so you have to rebuild and reinstall from Xcode. Any development-signed app (free or paid team) also needs Settings > Privacy & Security > Developer Mode, which shows a warning that it lowers device security. TestFlight and App Store installs don't need Developer Mode. Free signing is fine for tomorrow's demo but not for a real older user: after 7 days the app stops launching and they can't fix it themselves. The iCTRL XCUITest runner is a separately signed bundle (its own *.xctrunner App ID). It most likely uses one of the 3 app slots and one of the 10 weekly App IDs. That last point is my inference and I haven't verified it.

**Correction:** The Apple limits are right. The slot maths is wrong. The local iCTRL project (phone-control/iCTRL/project.yml) builds two dev-signed apps, the iCTRL host app (<prefix>.ictrl) and iCTRLUITests-Runner.app (<prefix>.ictrl.uitests). Its README says the runner counts as one of the 3 free-account apps, and that SideStore counts too if used. So Kairos + runner + iCTRL app (or SideStore) is 3 of 3, not 'Kairos plus runner, 2 or fewer'. Missing step: Personal Team apps also need Settings > General > VPN & Device Management > trust the developer, and that verification needs internet. The older person's phone also has to be one of the 3 registered devices and reconnected to the Mac at least every 7 days.

**How (for Kairos):** For the demo, rebuild from Xcode within 7 days of the demo time (you built tonight, so you're covered). Don't change bundle IDs again: the project's uk.oxhack.tempo.$(DEVELOPMENT_TEAM_LOWER) scheme already uses App IDs. Keep Kairos plus the iCTRL runner to 2 or fewer of the 3 slots. For real users, move to the paid program (see the paid-program finding).

**Limits:** Free Personal Team on iOS 26.5, iPhone 12 Pro Max. 7-day expiry for app, profile and device registration. 3 dev-signed apps per device (Kairos + iCTRL runner + iCTRL app or SideStore = full). 10 App IDs per 7 days; any widget or Control extension needs its own App ID. Needs Developer Mode plus a trusted developer cert. Fine for the demo, not viable for an unattended older user.

**Evidence:** developer.apple.com/support/compare-memberships: 'up to 10 App IDs, which expire after 7 days', 'up to 3 devices, which expire after 7 days', 'up to 3 apps per device… Provisioning profiles… expire 7 days from issuance'. Developer Mode doc (developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device): needed for Xcode-run or Configurator-installed development builds, not for App Store or TestFlight. iCTRL README (local, /Users/gaddamshivateja/Oxford-hackathon-2026/phone-control/iCTRL/README.md): 'at most 3 sideloaded apps… SideStore itself counts as one… With the runner that leaves room for one more'.

**Sources:** <https://developer.apple.com/support/compare-memberships/> · <https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device>

### 🟡 Partly — Which capabilities and entitlements Kairos can use on a free account
*Fact-check: confirmed*

**What's possible:** From Apple's 'Supported capabilities (iOS)' matrix, the 'Apple Developer' (free) column. Available free: App Groups, Background Modes (so UIBackgroundModes=audio works), Data Protection, HealthKit, HomeKit, Inter-App Audio, Keychain Sharing, Maps, Wireless Accessory Configuration. Not available free (paid ADP needed): Push Notifications (so no APNs and no PushKit VoIP push), Siri (the SiriKit com.apple.developer.siri entitlement), iCloud (CloudKit, iCloud Documents, key-value storage), Associated Domains (universal links), Communication Notifications, Time Sensitive Notifications, Sign in with Apple, App Attest, Access WiFi Information, Network Extensions/Personal VPN, Push to Talk, WeatherKit, Family Controls. Two entitlements are request-only even on paid accounts: com.apple.developer.usernotifications.critical-alerts (alarms that bypass mute/Do Not Disturb, useful for medication reminders) and com.apple.developer.networking.multicast (raw multicast/broadcast and arbitrary Bonjour types). CallKit itself needs no entitlement, but waking the app for calls needs PushKit and therefore paid Push.

**How (for Kairos):** On the free account the Mac cannot wake the phone with APNs. Have the app keep a live connection (WebSocket or LiveKit) while the audio session is active, and use local notifications (UNUserNotificationCenter, no entitlement) for reminders. Reach the Mac over unicast HTTP/WebSocket and add NSLocalNetworkUsageDescription. If you browse with Bonjour, declare the service in NSBonjourServices rather than relying on multicast. HealthKit works on the free account: add the HealthKit capability plus NSHealthShareUsageDescription and NSHealthUpdateUsageDescription. Plan for APNs, Time Sensitive and Critical Alerts only after you pay; Critical Alerts also needs an application to Apple.

**Limits:** Free team: no APNs, PushKit, Time Sensitive, iCloud or Siri entitlement. HealthKit and background audio are OK. Critical Alerts and multicast need Apple approval even on paid. AlarmKit and AssistiveAccess are available in the iOS 26.0 SDK that ships with Xcode 26.0.1.

**Evidence:** Parsed table at developer.apple.com/help/account/reference/supported-capabilities-ios. 'Apple Developer' (free) column ticks only: App groups, Background modes, Data protection, HealthKit, HomeKit, Inter-App Audio, Keychain sharing, Maps, Wireless Accessory Configuration. Push notifications, Siri, iCloud x3, Associated domains, Communication and Time Sensitive Notifications, Sign in with Apple, App Attest, Access WiFi info, Network extensions, Personal VPN, Push to Talk, WeatherKit and Family Controls are ADP-only. The multicast doc says it 'requires permission from Apple'. AlarmKit sample doc: alarms override 'focus and silent mode'; requires NSAlarmKitUsageDescription.

**Sources:** <https://developer.apple.com/help/account/reference/supported-capabilities-ios> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast> · <https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription>

### ✅ Yes — "Hey Siri, talk to Kairos" (App Intent plus AppShortcutsProvider) without the Siri entitlement
*Fact-check: confirmed*

**What's possible:** Apple's reference for com.apple.developer.siri says the App Store requires that entitlement only for apps containing Intents app extensions that handle Siri requests other than shortcut requests (legacy SiriKit domains). App Intents and App Shortcuts don't need it, so they work on the free team. Your tempo-ios project has no .entitlements file and the App Shortcut already works, which confirms this. App Review 2.5.11 applies: only register intents the app can handle itself. Resolve the request directly with no ads or marketing in between. Shortcut phrases and aliases must relate to your app's name, not generic terms or third-party names.

**How (for Kairos):** Keep AppShortcutsProvider phrases containing \(.applicationName) ("Talk to Kairos"). Set openAppWhenRun/ForegroundContinuableIntent (or the iOS 26 equivalent) so perform() brings up the conversation and starts AVAudioSession at once. Don't add SiriKit INIntents. Siri can be enabled inside Assistive Access, so this is also the most accessible trigger there.

**Limits:** Works on the free team, iOS 16+. No .entitlements file is needed; I confirmed tempo-ios has none. Phrases must include the app name. No new Siri AI features on the A14.

**Evidence:** Siri entitlement doc (JSON): 'The App Store requires the presence of this entitlement for iOS or watchOS apps containing Intents app extensions that handle any Siri requests other than shortcut requests.' Guideline 2.5.11(i)-(iii) confirmed verbatim (current, 16 Oct 2026). supportedModes doc: 'Specify the immediate foreground mode to bring the app to the foreground before the action runs.' Apple newsroom, June 2026: Siri AI requires 'iPhone 16 models or later, iPhone 15 Pro, iPhone 15 Pro Max'. AppleInsider, 8 Jun 2026: iOS 27 keeps iPhone 11 and newer.

**Sources:** <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.siri> · <https://developer.apple.com/app-store/review/guidelines/#sirikit> · <https://developer.apple.com/documentation/appintents/app-shortcuts>

### ✅ Yes — Distribute to real users: paid Apple Developer Program, TestFlight, Ad Hoc, App Store
*Fact-check: confirmed*

**What's possible:** The paid ADP costs USD 99 a year, shown in local currency at enrolment. It unlocks App Store Connect, TestFlight and all the capabilities above. TestFlight allows up to 100 internal testers and 10,000 external testers, plus public links. The first build going to an external group must pass Beta App Review. Each build is testable for 90 days, and installs need no Developer Mode. Ad Hoc/development builds can go to registered UDIDs only: 100 devices per product family per membership year, and disabling a device does not free its slot. You can enrol as an individual (seller name is your legal name) or an organisation (needs a D-U-N-S number, a legal entity rather than a DBA, and a website). Guideline 5.1.1(ix): apps offering healthcare services or needing sensitive user information 'should be submitted by a legal entity that provides the services, and not by an individual developer'. A health-data plus messages agent could be pushed towards organisation enrolment. Since 28 April 2026, uploads must be built with the iOS 26 SDK or later; Xcode 26.0.1 meets this.

**How (for Kairos):** After the hackathon, enrol (an organisation if you can, given 5.1.1(ix)) and ship to older-user pilots via TestFlight with a public link and a carer-led install. Don't count on enrolment finishing before tomorrow's demo; approval isn't instant.

**Limits:** Paid ADP needed; organisation enrolment needs a D-U-N-S number. External TestFlight needs Beta App Review. Builds expire after 90 days. Ad Hoc is capped at 100 iPhones a year. Enrolment may not finish before 13:00 tomorrow.

**Evidence:** developer.apple.com/testflight: 'up to 100 members… internal', 'up to 10,000 external testers', the first build must be approved by App Review before external testing. devices-overview: '100… per product family, per membership year'; disabling 'won't increase your number of available devices'. News ueeok6yw (3 Feb 2026): from 28 Apr 2026, uploads must use the iOS 26 SDK or later. This Mac has Xcode 26.0.1 with iPhoneOS26.0.sdk. Guidelines text for 5.1.1(ix) confirmed verbatim.

**Sources:** <https://developer.apple.com/testflight/> · <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview> · <https://developer.apple.com/programs/enroll/> · <https://developer.apple.com/help/account/register-devices/devices-overview> · <https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage> · <https://developer.apple.com/news/?id=ueeok6yw>

### ✅ Yes — App Store privacy and AI rules for a voice agent that uses health, contacts, location and messages and sends audio to ElevenLabs
*Fact-check: confirmed*

**What's possible:** The current guidelines (last updated 16 Oct 2026) require the following. 5.1.2(i), added 13 Nov 2025: you must 'clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so'. ElevenLabs and any cloud LLM count; a privacy-policy paragraph alone is not enough. 5.1.1(i)-(iv): privacy policy in-app and in App Store Connect, consent with an easy way to withdraw it, data minimisation (prefer out-of-process pickers over full Contacts/Photos access), and no forced consent. 5.1.2(v): contact people from Contacts only on the user's explicit, individual initiative, with no 'select all', and show what the message will say and who it appears from before sending. That fits an 'agent sends a message' flow if it confirms first. 2.5.14: explicit consent plus a clear visual and/or audible indicator when recording the mic or user activity, which matters because Kairos auto-starts listening. 5.1.3: health data can't be used for ads or data mining, you must disclose the specific health data collected, and you can't store personal health information in iCloud. 2.5.18: no ads targeted using HealthKit data. 5.1.2(vi): HealthKit and HomeKit data can't be used for marketing.

**How (for Kairos):** Add a first-run consent screen naming ElevenLabs (and any cloud model) and listing the data types sent: voice audio, transcripts, health or contact snippets. Add per-category toggles plus a 'local only (Mac/Ollama)' mode. Keep HealthKit data out of CloudKit and iCloud. Have the agent read back the recipient and text and ask for a spoken 'yes' before sending any message. Keep a persistent on-screen 'Listening' state. Request permissions just in time, with a fallback when the user says no (5.1.1(iv)).

**Limits:** App Store and TestFlight review. UK GDPR treats health data as special-category data. Consent UI is needed before any audio or data goes to ElevenLabs or a cloud LLM.

**Evidence:** Guidelines (Last Updated 16 Oct 2026). 5.1.2(i): 'clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so'. News ey6d8onl (13 Nov 2025) confirms that addition. The 2.5.14, 5.1.1(i)-(iv), 5.1.2(v)-(vi), 5.1.3(i)-(ii) ('may not store personal health information in iCloud') and 2.5.18 wording all matches the live text.

**Sources:** <https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing> · <https://developer.apple.com/news/?id=ey6d8onl> · <https://developer.apple.com/app-store/review/guidelines/#health-and-health-research> · <https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai>

### 🟡 Partly — Agents that operate the phone's other apps (iCTRL/XCUITest) and an App Store build that depends on the Mac hub
*Fact-check: corrected*

**What's possible:** As of the 16 Oct 2026 revision there is no agent-specific App Store guideline; press reports of an agent framework are unconfirmed. Existing rules decide it. 2.5.1: public APIs only, used for their intended purpose (HealthKit for health). 2.5.2: no downloading or executing code that changes the app's or other apps' functionality. 2.5.19 (new, Oct 2026): no hidden, dormant or undocumented features. 4.7.2: software not embedded in the binary (chatbots, plug-ins) may not get native platform APIs without Apple's permission. 2.5.4: background modes only for their intended purpose. 2.5.8: no alternate home-screen environments. 2.5.9: don't alter hardware switches or buttons. 4.2.3(i): the app must work without another app installed. 2.1: the backend must be live, or a demo mode must be provided. 5.2.2: you must be permitted under a third-party service's terms, which WhatsApp ingest via the unofficial WhatsApp Web protocol (wacli) would likely fail. XCUITest-based control is development tooling: it needs a development-signed runner, Developer Mode and a paired Mac, so it can't ship on the App Store or TestFlight to users.

**Correction:** (1) 2.5.19 isn't new policy. Apple says it 'clarifies long-standing policy… formerly covered in Guideline 2.3.1'. (2) 'Needs a paired Mac' is imprecise. Per its README, iCTRL can run without a Mac via SideStore, LocalDevVPN and an on-device DDI mount (iCTRL app or StikDebug). It still needs Developer Mode and a dev-signed runner, so it can't ship via the App Store or TestFlight. (3) The iCTRL runner compiles against private XCTest headers (XCTestPrivate-Bridging-Header.h), which 2.5.1 would reject in any store build. (4) Add 4.7.3 (per-instance consent) to the 4.7.2 risk for LLM tool-calling into native APIs. Both are interpretations, not explicit agent rules. (5) The sideloading toolchain (SideStore, LocalDevVPN) conflicts with the 'safe for older users' goal.

**How (for Kairos):** Present phone automation in the demo as a developer or companion-Mac feature. For a shippable app, act through sanctioned surfaces: App Intents and Shortcuts, system compose sheets (MFMessageComposeViewController, CNContactPicker), EventKit, HealthKit, CoreLocation, CallKit or tel: links. Keep a cloud or hosted backend plus a reviewer demo mode so the app works without the user's Mac. Document every agent capability in the review notes and the app description (2.5.19). Keep the audio background mode for real, active conversations, not silent keep-alive audio.

**Limits:** Demo-only. iCTRL needs Developer Mode, a dev-signed runner, a mounted DDI and pairing, and private XCTest APIs. A shippable app must act through App Intents, compose sheets, EventKit, HealthKit or CoreLocation and have a reviewer demo mode.

**Evidence:** News 92th7e5i (16 Oct 2026): '2.5.19: New guideline clarifies long-standing policy on hidden, dormant, or undocumented features, formerly covered in Guideline 2.3.1.' Live text confirmed for 2.5.1, 2.5.2, 2.5.4, 2.5.9, 4.2.3(i), 4.7.2, 4.7.3, 5.2.2 and 2.1(a). Local iCTRL project.yml: SWIFT_OBJC_BRIDGING_HEADER: iCTRLUITests/XCTestPrivate-Bridging-Header.h. README: 'No Mac required… Install with a free Apple ID through SideStore'.

**Sources:** <https://developer.apple.com/app-store/review/guidelines/#software-requirements> · <https://developer.apple.com/news/?id=92th7e5i> · <https://developer.apple.com/app-store/review/guidelines/#minimum-functionality> · <https://developer.apple.com/app-store/review/guidelines/#third-party-sites/services> · <https://apple.gadgethacks.com/news/apple-app-store-agentic-ai-whats-allowed-and-whats-not/>

### ✅ Yes — Health and medical positioning, age rating and AI-assistant declarations
*Fact-check: confirmed*

**What's possible:** Since 26 March 2026, apps distributed in the EEA, UK or US must declare a 'regulated medical device' status in App Store Connect if either is true: the primary or secondary category is Health & Fitness or Medical, or the age rating says 'frequent' Medical or Treatment Information. Apps that only read health data for non-medical features select 'No'. Existing apps must declare by early 2027 or lose the ability to submit updates. The age-rating questionnaire, overhauled in July 2025 with new 13+, 16+ and 18+ ratings and mandatory since 31 Jan 2026, asks about capabilities and tells developers to account for AI assistant and chatbot functionality. 1.4.1: medical claims face more scrutiny, and apps should remind users to consult a doctor. 5.1.5: don't use Location Services to provide emergency services.

**How (for Kairos):** Position Kairos as a companion or assistant, not a diagnostic tool. Answer 'No' to regulated medical device unless you make clinical claims. Add 'check with your doctor' wording around health answers. Don't market it as a fall or emergency service. Point to Apple's own Emergency SOS and Fall Detection instead.

**Limits:** App Store in the UK, EEA and US. Needs a paid account (Account Holder or Admin).

**Evidence:** News nyqbfz1y (26 Mar 2026): applies in the EEA, UK and US to apps meeting either criterion; existing apps must declare 'by early 2027' or 'you'll no longer be able to submit app updates'. Guideline 1.4.1: 'Apps should remind users to check with a doctor…'. 5.1.5: Location shouldn't be used 'to provide emergency services'. Age rating overhaul in Jul 2025 (13+/16+/18+), with a 31 Jan 2026 deadline (9to5Mac).

**Sources:** <https://developer.apple.com/news/?id=nyqbfz1y> · <https://developer.apple.com/help/app-store-connect/manage-app-information/declare-regulated-medical-device-status> · <https://9to5mac.com/2025/07/24/apple-notifies-developers-of-new-app-store-age-rating-system/> · <https://developer.apple.com/app-store/review/guidelines/#physical-harm>

### ❌ No — Long-press the side button to choose Kairos instead of Siri (third-party assistant on the side button)
*Fact-check: confirmed*

**What's possible:** Apple offers this only in Japan, under the MSCA. You need an App Intent conforming to the AssistantIntent 'activate' schema plus the com.apple.developer.side-button-access.allow entitlement ('Side Button Access' capability), on iOS 26.2 or later. In production, the Apple Account region must be Japan and the user must physically be in Japan. Apple's doc says 'During development, install your provisioning profile on your iPhone test device to test the functionality'. Whether that works on a UK device is unconfirmed. Developers reported the capability only appeared in Xcode 26.2, so your Xcode 26.0.1 won't offer it. The free-team matrix doesn't list it, so availability on the free account is unknown. No EU or UK equivalent exists as of Oct 2026, and the EU default-apps list has no voice-assistant category. The iPhone 12 Pro Max has no Action button.

**How (for Kairos):** For the UK demo, use these triggers instead. (1) "Hey Siri, talk to Kairos" (App Shortcut). (2) Back Tap: Settings > Accessibility > Touch > Back Tap > Double/Triple Tap, set to the 'Talk to Kairos' shortcut. (3) A Lock Screen or Control Center control (ControlWidget) that runs the App Intent. (4) A Home Screen icon or the kairos:// URL. Optionally update to Xcode 26.2+ and test the activate schema with a development profile as an experiment; low odds outside Japan.

**Limits:** Japan only in production; iOS and Xcode 26.2+. UK alternatives: an App Shortcut via Siri, Back Tap running a Shortcut, Vocal Shortcuts, a ControlWidget, or the Home Screen icon. The iPhone 12 Pro Max has no Action button.

**Evidence:** Doc JSON 'launching-your-voice-based-conversational-app-from-the-side-button-of-iphone': 'only available on iPhone in Japan and requires the com.apple.developer.side-button-access.allow entitlement… For a production device, the country or region of your Apple Account must be set to Japan, and you must physically be located in Japan.' The entitlement and activate schema metadata say introducedAt iOS 26.2. Forum thread 808549: the capability appeared in Xcode 26.2. developer.apple.com/support/apps-in-the-eu has the default-apps list.

**Sources:** <https://developer.apple.com/documentation/appintents/launching-your-voice-based-conversational-app-from-the-side-button-of-iphone> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.side-button-access.allow> · <https://developer.apple.com/forums/thread/808549> · <https://www.macrumors.com/2025/11/17/ios-26-2-iphone-users-eu-siri-replacement/> · <https://developer.apple.com/support/apps-in-the-eu/>

### ❌ No — Distribute outside the App Store (EU DMA, Japan MSCA, Brazil, UK)
*Fact-check: confirmed*

**What's possible:** EU, as of 1 Oct 2026: alternative app marketplaces and Web Distribution are available for notarised apps. Eligibility was widened. A developer now needs any one of: a moderate D&B financial-stability score, being publicly traded, venture funding, a financial audit, an approved nonprofit or education fee waiver, a USD 1M stand-by letter of credit, or 1M first annual installs. An EU legal entity is no longer required. A 5% Core Technology Commission replaces the Core Technology Fee. Notarisation still checks for no downloaded executable code and no hidden sensitive-data collection. It serves EU users only; installs while travelling for up to 90 days arrive with iOS 27.2. Japan: alternative marketplaces since iOS 26.2 (Dec 2025). Brazil: since iOS 26.5 (June 2026). UK: no sideloading, alternative marketplaces or web distribution as of Oct 2026. A UK user can only get Kairos via the App Store, TestFlight, Ad Hoc or Xcode builds.

**How (for Kairos):** Ignore alternative distribution for the UK. The best route for a UK pilot is TestFlight with a public link, then the App Store. Mention EU web distribution only as a future route for an EU rollout.

**Limits:** EU, Japan and Brazil only, with paid ADP plus notarisation. UK users get the App Store, TestFlight, Ad Hoc or Xcode only.

**Evidence:** apps-in-the-eu: 'no longer required to have a legal entity or be established in the EU'; eligibility via D&B, publicly traded, VC, audit, government/edu/nonprofit waiver, USD 1M LoC, or 1M first annual installs; '90 days when traveling outside the EU' 'with iOS and iPadOS 27.2'. News gmws0jgp (18 Aug 2026): CTF replaced by 'a simple 5% commission'. News 074b3wzz: Japan from iOS 26.2. News dhwadr2x: Brazil from iOS 26.5. The gov.uk CMA case page has no sideloading measure.

**Sources:** <https://developer.apple.com/support/apps-in-the-eu/> · <https://developer.apple.com/news/?id=gmws0jgp> · <https://developer.apple.com/news/?id=074b3wzz> · <https://developer.apple.com/news/?id=dhwadr2x>

### 🔧 Workaround — Use the UK CMA regime to get side-button or default-assistant access for Kairos
*Fact-check: confirmed*

**What's possible:** The CMA gave Apple Strategic Market Status on 22 Oct 2025, covering iOS, iPadOS, the App Store and Safari. Apple's commitments took effect on 1 April 2026: fair, transparent App Review with reasons, timeframes and appeals, plus annual UK review metrics. They also created a dedicated interoperability request channel, a web questionnaire open only to ADP members in good standing 'whose account membership ... is registered in the UK'. Apple will try to give a status update within 4 weeks, scores requests on uptake, platform priorities, cost and impact on security, privacy and accessibility, and has no obligation to build anything. Other CMA work: a steering conduct requirement proposed 30 Jun 2026 (consultation closed, responses published 14 Aug 2026, not final) and an NFC-access conduct requirement out for consultation since 20 Oct 2026. No CMA measure yet covers voice assistants, default assistants, alternative app stores or sideloading.

**How (for Kairos):** Once you have a UK-registered paid membership, file an interoperability request for 'equivalent side-button / default voice-assistant access as Siri (as already provided in Japan)'. Citing the Japan precedent and the accessibility benefit for older users addresses Apple's published criteria. Use it as a pitch line at the demo, not as something you can rely on.

**Limits:** Needs a paid ADP membership registered in the UK. Apple has full discretion and gives no timeline. Treat it as a pitch line, not a plan.

**Evidence:** Apple commitments PDF (30 Mar 2026, 'shall take effect from 1 April 2026'): channel open to members 'whose account membership with the Developer Program is registered in the UK'; 'endeavour to provide… an update… within four weeks'; criteria are uptake, platform priorities, cost, UX/security/privacy/accessibility and IP; 'will not create any obligation'. gov.uk CMA case: SMS 22 Oct 2025; steering consultation 30 Jun 2026; responses 14 Aug 2026; NFC CR consultation 20 Oct 2026.

**Sources:** <https://www.gov.uk/cma-cases/apples-mobile-platform> · <https://www.apple.com/legal/dmcca/dmcca-commitments.pdf> · <https://competitionandmarkets.blog.gov.uk/2026/02/10/improving-the-way-apple-and-google-deliver-app-store-services-and-enhancing-ios-interoperability-in-the-uk/>

### ✅ Yes — Optimise Kairos for Assistive Access (simplified iPhone mode for older or cognitively impaired users)
*Fact-check: confirmed*

**What's possible:** There are two Info.plist routes. (1) UISupportsFullScreenInAssistiveAccess = YES (iOS 17+): the standard UI fills the space above the Back button. (2) UISupportsAssistiveAccess = YES (iOS 26+) plus a SwiftUI AssistiveAccess { } scene next to WindowGroup: native controls take the large Assistive Access style, and Back follows the navigation stack. UIKit apps use UIHostingSceneDelegate with the .windowAssistiveAccessApplication session role. Either key lists the app as 'Optimized for Assistive Access' in Settings. Related APIs: @Environment(\.accessibilityAssistiveAccessEnabled), AccessibilitySettings.isAssistiveAccessEnabled, .assistiveAccessNavigationIcon(systemImage:) and #Preview(traits: .assistiveAccess). Apple's design guidance: one or two features at the root, controls always visible, no timed or auto-dismissing UI, icons with labels, and double confirmation for destructive actions. These are plain Info.plist keys and SwiftUI APIs with no entitlement, so they work on the free team.

**How (for Kairos):** Add INFOPLIST_KEY_UISupportsAssistiveAccess: YES in project.yml. Add AssistiveAccess { KairosBigButtonView() } to TempoApp. Give the scene one huge talk button, a clear 'Listening / Kairos is speaking / Working on your phone' state with text and an icon, and a 'Stop' button.

**Limits:** iOS 26+ for the scene and key; the full-screen key works from iOS 17. Plain Info.plist and SwiftUI, no entitlement, so it works on the free team and with Xcode 26.0.1 (iOS 26.0 SDK).

**Evidence:** Doc JSON: UISupportsAssistiveAccess is introducedAt iOS 26.0, 'allows your app's UI to match the prominent style of Assistive Access controls… lists your app as Optimized for Assistive Access'. SwiftUI AssistiveAccess scene is iOS 26.0. UISupportsFullScreenInAssistiveAccess is iOS 17.0, 'expand into all the available space above the Back button'. 'optimizing-your-app-for-assistive-access' describes both routes.

**Sources:** <https://developer.apple.com/documentation/accessibility/optimizing-your-app-for-assistive-access> · <https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportsassistiveaccess> · <https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportsfullscreeninassistiveaccess> · <https://developer.apple.com/documentation/swiftui/assistiveaccess> · <https://developer.apple.com/videos/play/wwdc2025/238/>

### 🟡 Partly — Set up an older person's iPhone with only Kairos, Calls and Messages (Assistive Access) and how that interacts with triggers and permissions
*Fact-check: confirmed*

**What's possible:** Setup path: Settings > Accessibility > Assistive Access > Set Up Assistive Access. Confirm the Apple Account, add apps (Calls and Messages are Apple's optimised apps; most other apps, including Kairos, can be added), choose Rows or Grid, confirm the device passcode or Face ID, set an Assistive Access passcode plus an optional recovery Apple Account, then Start. Settings available while it's off: Siri ('Allow the use of Siri in Assistive Access'), notification badges, Accessibility Shortcut, Unlock with One Tap, and Hide Back Button for unoptimised apps. Important limits: (a) triple-clicking the side button is reserved for exiting (with the passcode) and making emergency calls, so 'triple press for Kairos' conflicts. (b) Apps 'won't ask for permission' inside Assistive Access, so permissions must be granted beforehand. (c) There's no App Store, Settings or update notices inside. (d) Some status and privacy icons are hidden. (e) Calls and Messages can be limited to allowed contacts. With free signing, Kairos would stop launching after 7 days and the user couldn't recover it.

**How (for Kairos):** Carer setup order: (1) Install Kairos via TestFlight or the App Store. (2) Outside Assistive Access, run Kairos once and grant Microphone, Contacts, HealthKit, Location and Notifications. (3) Turn on 'Allow Siri' in the Assistive Access settings so "Hey Siri, talk to Kairos" works. (4) Add Calls (allowed contacts), Messages and Kairos. Use Grid layout and Unlock with One Tap. (5) Draw Kairos's own big on-screen listening indicator, since some system indicators are hidden. Use Siri or a big Home tile as the trigger, not triple-click.

**Limits:** iOS 17+ (the optimised scene needs 26+). The carer needs the AA passcode. Free 7-day signing isn't viable unattended. Back Tap, Vocal Shortcuts and background audio inside Assistive Access are still untested.

**Evidence:** support.apple.com Assistive Access guide pages. 'Triple-click the side button… tap Exit Assistive Access'; 'You also triple-click… to make an emergency call'; 'apps won't ask for permission to access information such as location, photos, and contacts'; settings include 'Allow the use of Siri in Assistive Access' and 'Turn on Accessibility Shortcut… by triple-clicking the side button'; there's no App Store in Assistive Access; status and location icons are hidden.

**Sources:** <https://support.apple.com/guide/assistive-access-iphone/set-up-assistive-access-devcd5016d31/ios> · <https://support.apple.com/guide/assistive-access-iphone/change-settings-dev073880b40/ios> · <https://support.apple.com/guide/assistive-access-iphone/enter-and-exit-assistive-access-devdedddc678/ios> · <https://support.apple.com/guide/assistive-access-iphone/understand-differences-assistive-access-dev473e94873/ios> · <https://support.apple.com/guide/assistive-access-iphone/add-remove-and-customize-apps-devd7d3e3b512/ios>

**Also important (added by the fact-checker):**

- The iCTRL toolchain alone fills the free account. It installs two dev-signed apps (the iCTRL host app and iCTRLUITests-Runner), and Kairos makes three, which is the free-team limit. SideStore also counts if it's used. Nothing else dev-signed (a test app or a second helper) fits on the demo phone.
- AlarmKit (iOS 26+) is the free-team way to do loud medication or appointment reminders. Alarms override Focus and silent mode, and only NSAlarmKitUsageDescription is needed, with no Critical Alerts entitlement. Local Live Activities (ActivityKit, no push) can show 'Kairos is working on your phone' on the Lock Screen while agents run.
- Guideline 4.7 names 'chatbots'. 4.7.3 requires explicit consent 'in each instance' before sharing data or privacy permissions with software not embedded in the binary. That could apply to passing HealthKit or Contacts data to the ElevenLabs or cloud agent, so design per-request confirmation for sensitive data.
- App Store submission also needs App Privacy nutrition labels and a PrivacyInfo.xcprivacy privacy manifest declaring required-reason APIs such as UserDefaults. ITSAppUsesNonExemptEncryption should be set (standard HTTPS/WebRTC is usually exempt) to avoid an export-compliance prompt on every TestFlight upload.
- Don't embed the ElevenLabs API key in the shipped binary. Use a public agent ID, or have a backend mint conversation tokens or signed URLs. This is a data-leak and App Review issue, and the hub on the Mac is not reachable by reviewers.
- openAppWhenRun is deprecated in iOS 26; use AppIntent.supportedModes (IntentModes, e.g. .foreground(.immediate)) for 'Talk to Kairos'.
- iOS 27's new Siri AI (app schemas, system orchestrator, the reported third-party chatbot 'Extensions') needs Apple Intelligence hardware (iPhone 15 Pro or later). It isn't on the A14 iPhone 12 Pro Max and isn't initially in the EU on iOS. iOS 27 still installs on the 12 Pro Max, and classic App Shortcuts keep working.
- Vocal Shortcuts (Settings > Accessibility > Vocal Shortcuts, iOS 18+) let the user train a custom spoken phrase that runs an App Shortcut or Shortcut without saying 'Hey Siri'. It's a possible UK-legal 'say Kairos' trigger. Support on the iPhone 12 Pro Max and inside Assistive Access is unverified, so test it tonight.
- Free-team installs also need Settings > General > VPN & Device Management > Trust developer, which needs internet to verify. Developer Mode's 'reduces security' warning undercuts the safety pitch for older users, so present free signing as demo-only.
- The Japan side-button doc says development profiles can test the feature 'during development'. Nobody has confirmed it works on a UK device, and it would need Xcode 26.2+ (the iOS 26.2 SDK) plus probably a paid team. Treat it as an optional experiment only.
- The regulated-medical-device declaration can be avoided by not choosing the Health & Fitness or Medical category (e.g. Lifestyle or Productivity) and not rating 'frequent' medical info. Also check that the 'Kairos' name is free in App Store Connect and doesn't use another developer's brand (Guideline 4.1(c), Nov 2025).

**Surprises:**

- The App Review Guidelines were revised again on 16 Oct 2026, eight days ago. New 2.5.19 bans hidden, dormant or undocumented features and threatens account termination, so every agent capability Kairos has (phone and laptop control) must be documented to App Review and users.
- Guideline 5.1.2(i) (since 13 Nov 2025) names 'third-party AI' explicitly. Sending voice, health or contact data to ElevenLabs or a cloud LLM needs a clear disclosure plus explicit opt-in, not just a privacy policy.
- On the free Personal Team, HealthKit, App Groups, Background Modes, HomeKit and Keychain Sharing are available. Push Notifications (and so PushKit), the Siri entitlement, iCloud, Associated Domains, Time Sensitive and Communication Notifications are not. App Intents and App Shortcuts don't need the Siri entitlement, so the current 'Talk to Kairos' setup is the right one.
- Replacing Siri on the side button is Japan-only (AssistantIntent 'activate' plus com.apple.developer.side-button-access.allow, iOS 26.2+). The capability only appears in Xcode 26.2+, so this team's Xcode 26.0.1 can't add it. No EU or UK equivalent exists as of Oct 2026.
- Inside Assistive Access, triple-click is reserved for exit and emergency calls, and apps don't show permission prompts. Grant all Kairos permissions before entering, and use Siri (enable 'Allow Siri' in Assistive Access settings) or a big tile as the trigger.
- iOS 26 added a real SwiftUI AssistiveAccess scene and the UISupportsAssistiveAccess key (beyond iOS 17's UISupportsFullScreenInAssistiveAccess), so Kairos can ship a purpose-built, large-control older-user UI that's listed as 'Optimized' in Settings.
- There is still no sideloading or alternative marketplace in the UK. Since 1 April 2026, though, Apple runs a UK interoperability request channel for developers with UK-registered paid memberships. Kairos could formally request Japan-style side-button or default-assistant access, which makes a good pitch line.
- Since 26 March 2026, apps in the Health & Fitness or Medical category, or rated 'frequent' medical information, must declare regulated-medical-device status (UK, EEA, US). Guideline 5.1.1(ix) also says sensitive-data or healthcare apps should come from a legal entity, which may push Kairos to an organisation (D-U-N-S) enrolment.
- Free signing expires after 7 days and allows only 3 apps per device. The iCTRL XCUITest runner most likely uses one of those slots and an App ID (my inference). XCUITest-style control needs Developer Mode and a Mac, so it's demo-only and can't ship to users.
- iOS 27 is now current and still supports the iPhone 12 Pro Max. The A14 doesn't support Apple Intelligence, so Apple's on-device Foundation Models framework isn't an option on this demo phone.
