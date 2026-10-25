# Kairos: the exact path to run AI agents locally on an iPhone, and plug them into Siri

> Written Sun 25 Oct 2026 (about 02:30 UK, submission 12:00). Devices: iPhone 12 Pro Max (iPhone13,4, A14, 6 GB, iOS 26.5, free Personal Team 6Q9WSFP48T), Apple Intelligence iPhones (15 Pro and later), and iOS 27 (shipped 14 Sep 2026, still supports the 12 Pro Max). Toolchain: M3 Pro Mac, macOS 26.5.2, Xcode 26.0.1 (Swift 6.2, iOS 26.0 SDK), no Metal Toolchain.
> Built from six research dimensions, each re-checked by an adversarial verifier, plus three hands-on spikes on this Mac. Every research dimension came back; none is missing. Verdicts: ✅ Yes / ❌ No / 🟡 Partly / 🔧 Workaround. "Est." means my estimate, not a measurement. Nothing here has run on the phone yet. Section 9 lists what to test there.

## 1. The answer

**You can run a real tool-calling AI agent fully on the iPhone 12 Pro Max today.** The engine is llama.cpp's official prebuilt `llama.xcframework` with a GGUF model, running on the A14 GPU (Metal). It builds with Xcode 26.0.1 and needs no Metal Toolchain, because the shader source is embedded in the binary and compiled on the device at runtime. We proved that it builds for iOS and that the same Swift code calls tools correctly on the Mac. The agent loop, tools and safety gate are ordinary Swift in the main app process. Siri reaches Kairos through App Intents and App Shortcuts, which need no paid account. Apple's own on-device model (Foundation Models) never runs on the A14. It is the free, zero-download brain on iPhone 15 Pro and later. On iOS 27, Apple's `LanguageModel` protocol lets one session API cover Apple's model, Core AI, MLX and llama.cpp. Gemini and the Mac hub sit behind the same interface as a fallback. There are three hard limits:

- An iPhone app gets no GPU while it is in the background. Think in the foreground, or on the CPU.
- A Siri intent gets about 30 s, and Siri's own voice path has been seen failing at about 10 s.
- Small models choose tools badly. Code, not the model, decides what is actually executed.

```
 ENTRY ─ "Siri, talk to Kairos" (App Shortcut, .foreground) · Back Tap · Lock Screen control
       ─ "Siri, ask Kairos" → AskKairos (String asked by Siri; .background → .foreground(.dynamic))
       ─ Shortcuts automations (time, leave home, Message trigger; iOS 27 Notification trigger) → ReportToKairos
       ─ iOS 27 + Apple Intelligence: Siri AI → schema intents (.reminders / .notes / .calendar / .system.search)
        │
 VOICE ─ SpeechAnalyzer / SFSpeechRecognizer (on device)  ⇄  AVSpeechSynthesizer / Personal Voice
        │
 AGENT LOOP (Swift, main app process, foreground-first)
   words → TimeNormaliser (half twelve, parso, NSDataDetector) → PreRouter (3–5 tools)
   → model call (grammar-constrained, one tool call) → SafetyGate → execute → reply from ActionLog
        │
 KairosBrain: one LanguageModel-shaped interface; BrainRouter picks the backend at runtime
   Tier 1 │ SystemLanguageModel (Foundation Models)   15 Pro+, iOS 26+; free, no download, 4K ctx
   Tier 0 │ llama.cpp xcframework + GGUF              any 6 GB iPhone, iOS 16.4+; GPU fg / CPU bg
   Tier 2 │ iOS 27: LanguageModel protocol            CoreAILanguageModel · MLXLanguageModel · own llama
          │         PCC (AI devices, paid + entitlement) · LongRunningIntent · Siri AI schemas
   Cloud  │ Mac hub Ollama qwen3.5:4b (LAN) → Gemini  opt-in, consent screen (Guideline 5.1.2(i))
        │
 TOOLS (compiled into the app) ─ EventKit · AlarmKit · Contacts · MessageUI · tel: · MapKit
       HealthKit (read) · Vision OCR · Translation · HomeKit · run user Shortcuts (x-callback-url)
        │
 SAFETY GATE ─ contact/shortcut allow-list · must be grounded in the user's own words · time cue + future check
       confirmation card + Face ID before call / send / shortcut · pasted or scanned text is data, never a command
```

## 2. Which runtime (decision table)

| Runtime | Works on 12 Pro Max today? | Builds with Xcode 26.0.1, no Metal Toolchain? | Tool calling | Licence | Verdict |
|---|---|---|---|---|---|
| **llama.cpp official xcframework** (b11669 proven; b11869 newest, 24 Oct) | ✅ A14 = Apple7 GPU family, full Metal kernels per source. Not yet run on the phone. | ✅ **Proven**: iOS app BUILD SUCCEEDED, 12 MB. No simulator slice. | 🔧 Our code: GBNF grammar + prompt + parser (spike, proven on Mac) | MIT | ✅ **Tier 0 engine** |
| **AnyLanguageModel 0.14.2** (`traits: ["Llama"]`, over llama.swift b10549) | ✅ iOS 17+ | ✅ Verifier built it with Xcode 26.0.1 (needs `-skipMacroValidation` or Trust & Enable). 1.x needs Swift 6.3. | ✅ FoundationModels-shaped `Tool`/`@Generable`; detects Qwen XML, Hermes and Gemma formats | Apache-2.0 | 🟡 Best API layer to try next; GPU/CPU control is unverified |
| LocalLLMClient 0.5.0 (`LocalLLMClientLlama`) | ✅ probably | 🟡 `from: "0.5.0"` likely fails (unsafeFlags); pin `revision: edc39ef…`. Macros live in another product. No GPU-layer option on device. | 🟡 experimental `@Tool` | MIT | 🟡 Skip; wrapping the xcframework directly is simpler and newer |
| Apple **Foundation Models** `SystemLanguageModel` | ❌ `.unavailable(.deviceNotEligible)` on A14, any iOS | ✅ (spike: iOS app built, 716 KB) | ✅ native `Tool`, `@Generable`, streaming | OS API, free | ✅ **Tier 1** on 15 Pro+ |
| MLX Swift / mlx-swift-lm | 🟡 A14 is MLX's oldest tested GPU; weights count as dirty memory (about 3× llama.cpp) | ❌ **Proven failing**: needs the Metal Toolchain, and current versions need Swift 6.3. Workable only with toolchain download plus pins 0.31.4 / 3.31.x. | ✅ ToolCallFormat for 10+ formats | MIT | 🔧 Later, as the speed path on A17 Pro+ / 8 GB |
| Google LiteRT-LM 0.18.1 Swift | 🟡 A14 GPU unverified; community says "iPhone 13 Pro or later" | 🟡 prebuilt, so probably yes; not built here. Git LFS smudge error on this Mac: set `GIT_LFS_SKIP_SMUDGE=1` | ✅ `Tool` + `@ToolParam`, constrained decoding | Apache-2.0 | 🟡 Second engine for Gemma 4 E2B (0.6 GB CPU peak measured on 17 Pro) |
| Core ML (your own stateful LLM) | ✅ iOS 18 MLState + int4 | ✅ but export is a Python pipeline | ❌ write your own | BSD (coremltools) | 🟡 Not for now; slow and ANE context-limited |
| Core AI + `CoreAILanguageModel` (apple/coreai-models 1.0.0) | ❌ iOS 27 only; A14 unverified, with no AOT compile (A17 Pro+/M1+ only) | ❌ Xcode 27 (macOS 26.6+; Apple's article also says macOS 27) + Metal Toolchain; device only | ✅ via `LanguageModel`; capabilities depend on the export | BSD-3 | 🔧 **Tier 2**: test Qwen3-0.6B/1.7B on an iOS 27 phone |
| MLXFoundationModels / LiteRTLMFoundationModels (iOS 27 bridges) | ❌ iOS 27 only | ❌ needs the 27 SDK (compiles to an empty module on 26) | ✅ | MIT / Apache | 🔧 Tier 2 |
| PrivateCloudComputeLanguageModel | ❌ AI devices only | ❌ iOS 27 SDK + managed entitlement + Small Business Program (paid) | ✅ 32K context | Apple terms | ❌ for Kairos now |
| Shortcuts "Use Model" | ❌ AI devices only (iOS 26+) | n/a | ❌ text only, via x-callback-url | Apple | ❌ |
| ExecuTorch / MLC-LLM | 🟡 CPU XNNPACK should work | 🟡 / ❌ heavy export pipelines | ❌ none built in | BSD / Apache | ❌ for us |
| Cactus | ? | ? | ✅ | ❌ not OSI (revenue/funding caps) | ❌ licence |

**Pick:** the llama.cpp xcframework behind our own `KairosModel` protocol tonight (the spike's `KairosLLM` package). Try AnyLanguageModel 0.14.2 as the FoundationModels-shaped API layer this week. Move to Apple's `LanguageModel` protocol once on Xcode 27.

## 3. Which model, per RAM tier

**What a 6 GB iPhone gives an app.** A 6 GB iPhone 13 Pro measured 3,125 MB available at launch. With the increased-memory-limit and Extended Virtual Addressing (EVA) entitlements together it measured 4,200 MB ([PocketPal PR #651](https://github.com/a-ghorbani/pocketpal-ai/pull/651)). A free team can't get EVA, so the figure with the memory entitlement alone is unmeasured. llama.cpp memory-maps GGUF weights, and those clean pages barely count toward the limit iOS enforces (jetsam). The spike measured a peak footprint of 339 MB for 1B Q8_0 and 512 MB for 3B Q4_K_M on Metal. MLX copies weights into anonymous (dirty) memory, which does count: Gemma 4 E2B took 3,010 MB under MLX against 497 MB under LiteRT-LM on a 17 Pro. Vision projectors (mmproj) are **not** memory-mapped, so load them only for "read this letter".

| Tier (phones) | Brain | File | Est. A14-class speed | Notes |
|---|---|---|---|---|
| 4 GB (12, 12 mini, 13, 13 mini; about 2.1 GB app limit reported) | Qwen3.5-0.8B or Llama-3.2-1B, router-only | 0.53 / 0.81 GB | 20–35 tok/s | Not a decider. Use deterministic skills plus the hub. |
| **6 GB** (12 Pro/Pro Max, 13 Pro, 14 family, 15/15 Plus) | **Qwen3.5-2B Q4_K_M** (default) · **Qwen3.5-4B IQ4_XS/Q4_K_M** ("careful" mode) | 1.28 GB · 2.48/2.74 GB | 2B: 10–16 tok/s, prefill 75–150 tok/s (est.) · 4B: 4–9 tok/s, prefill 35–50 (est.) | Apache-2.0, Indic languages, vision via mmproj. A cold 1,400-token tool prompt costs 10–19 s on 2B and 30–40 s on 4B, so snapshot the prefix state. |
| 6 GB fallback, already on this Mac | Llama-3.2-3B Q4_K_M (Ollama blob) · 1B Q4_K_M (spike) | 2.02 GB · 0.81 GB | 3B: 12–15 · 1B: 20–35 (est.) | Demo only. 1B is not viable as the decider (see the eval). |
| 8 GB AI phones (15 Pro/Pro Max, 16 family, 17) | **SystemLanguageModel** (3B, 4K context) for supported locales; Qwen3.5-4B for Hindi/Telugu/Tamil | 0 / 2.7 GB | Apple: about 30 tok/s, 0.6 ms per prompt token (2024 model on 15 Pro) | Apple's model and OCR have **no** Hindi, Telugu or Tamil (measured on this Mac: 23 locales, 30 OCR languages). |
| 12 GB (17 Pro/Pro Max, Air, Duo) | SystemLanguageModel (Core Advanced on iOS 27; Apple shows 8192 context "on newer devices") + Qwen3.5-4B (MLX) | 3 GB | Qwen3-4B MLX 28 tok/s measured (17 Pro) | The app ceiling stays about 6 GB even with the entitlement (one forum report). |

**Tool-calling eval (spike 3)**, run with Ollama on the Mac, temperature 0, 8 tools, accuracy only (Mac speed is not phone speed). "PASS" means the whole case was right: tool choice, arguments, abstaining, and resisting injection.

| Model (Ollama build) | Main PASS (38) | Tool choice | Args right | Abstain/clarify | Injection | PASS + validator | Held-out (14) | All 52 |
|---|---|---|---|---|---|---|---|---|
| llama3.2:1b (Q8_0) | 36.8% | 55.2% | 31.0% | 57.1% | 50% | 42.1% | 21.4% | 32.7% |
| llama3.2:3b (Q4_K_M) | 63.2% | 96.6% | 72.4% | 28.6% | 50% | 78.9% | 35.7% | 55.8% |
| **qwen3.5:4b** (nvfp4) | **89.5%** | 100% | 86.2% | 100% | 100% | 89.5% | **85.7%** | **88.5%** |
| qwen2.5:7b (current hub model) | 73.7% | 89.7% | 72.4% | 85.7% | 50% (ran "Send Contacts") | 78.9% | 78.6% | 75.0% |
| qwen3.5:4b + date table + normaliser | 100% (overfit) | 100% | 100% | 100% | 100% | 100% | 85.7% | 96.2% |

Routers on the 1B didn't help. Router v1 dropped PASS to 13.2%. Router v2 stayed at 36.8% but took injection resistance to 100% and cut stage-1 latency from 0.84 s to 0.23 s. Thinking mode on qwen3.5:4b went 11/15 → 13/15 but took 4× the latency (3.2 s → 13.5 s) and produced duplicate calls. **Qwen3.5-2B was not tested** because it isn't on disk. That is the most important missing number.

**The minimum agent brain that can decide on its own is about 4B (Qwen3.5-4B class) or Apple's 3B Foundation Model.** On the 6 GB phone that is slow, so run it like this:
1. A deterministic PreRouter picks 3–5 tools from keywords or embeddings, which keeps the prompt near 500 tokens.
2. Qwen3.5-2B (fast) proposes **one** call under a grammar.
3. The SafetyGate validates the call, and code asks the user to fill any missing slots.
4. Escalate to Qwen3.5-4B, the Mac hub or Gemini when validation fails twice, or for multi-step plans.

Guardrails proven in the spikes:
- **Grammar-constrained output.** Without the grammar the 1B wrote `"minutes": "10"` and `"date": "tonight"`.
- **Check dates in code.** Use a date table, a phrase normaliser (British clock idioms; Hindi/Telugu words such as parso and ellundi), an NSDataDetector cross-check, and an absolute-date read-back. It fixed "tonight" → "tomorrow".
- **Never let the model narrate an outcome.** Both Llama models said "I sent the message" when the tool had returned `needs_confirmation`, and Apple's 3B claimed "I've added a reminder" with no call in 2 of 15 turns. Build confirmations from the ActionLog.
- **Validator.** It blocked 0 of 241 correct calls and most harmful ones.
- **Pasted or scanned text can never trigger a tool.**
- **Thinking off, dedupe identical calls, at most 2–3 rounds.**

## 4. Siri integration plan

Both directions, both Siri generations. All the intents live in the **main app target**: extensions have far lower memory limits (30 MB was quoted for SiriKit Intents extensions). Gate them with `@available(iOS 26, *)` because the deployment target is 17.0.

**Classic Siri, iOS 26.5, 12 Pro Max (free team, no Siri entitlement):**

| Intent | Mode | What it does |
|---|---|---|
| `TalkToKairosIntent` (no params, `.requiresAuthentication`) | `.foreground(.immediate)` | "Siri, talk to Kairos" opens Kairos and starts the voice loop. GPU model available. Needs an unlock. |
| `AskKairosIntent` (`@Parameter(requestValueDialog: "What do you need?") var question: String`) | `[.background, .foreground(.dynamic)]` | "Siri, ask Kairos" → Siri asks → answer spoken via `.result(value:dialog:view:)`. In the background there's **no GPU**: use a deterministic skill parse, then the hub or Gemini if online, else `continueInForeground`. Budget about 20 s, and test against Siri's ~10 s voice timeout. |
| `KairosSkillIntent(skill: KairosSkill)` (AppEnum: myDay, readLetter, medicines, callFamily) | foreground for readLetter, background otherwise | One phrase per skill: "Kairos my day". The enum is the only parameter allowed in a phrase. |
| `ReportToKairosIntent(text:, source:)` | `.background` | Sink for automations (Time of Day, Leave Home, Message from family) and tool shortcuts. Text is tagged **untrusted**. |
| `LogDoseIntent` (LiveActivityIntent) | background | AlarmKit `secondaryIntent` "Taken" button, for the medicine log. |
| SnippetIntent + `requestConfirmation` / `requestChoice` | n/a | Big-text answer card and spoken "Send 'running late' to Sarah?" confirmation. |

`AppShortcutsProvider` limits:
- At most 10 App Shortcuts, and every phrase must contain `\(.applicationName)` (or an app-name synonym).
- At most one parameter per phrase, and it must be an AppEnum or AppEntity. An open-ended String is never allowed in a phrase.
- Test "Kairos" recognition in en-GB with the App Shortcuts Preview tool.
- Known risk: on iOS 18, Siri answered a dictated *question* itself instead of passing it to `requestValueDialog`. Test this on the phone.

**Kairos → Siri / other apps, classic:**
- There is no API to drive Siri or call another app's intents (Apple confirmed this at WWDC26 group lab 8011).
- Kairos can run the **user's own Shortcuts** through `shortcuts://x-callback-url/run-shortcut?...&x-success=kairos://done`. This only works from the foreground, and the switch to Shortcuts is visible. The text output comes back as `result`. Pause any GPU generation before opening the URL, because Kairos goes to the background.
- Donations (`IntentDonationManager`) and `IndexedEntity` feed Spotlight and Siri Suggestions.

**Siri AI, iOS 27, Apple Intelligence phones (English beta, not EU, opt-in waitlist; "Siri Classic" stays selectable):**
- Add schema intents and entities: `.reminders.createReminder/updateReminder/deleteReminders` for medicines, appointments and bills; `.notes.createNote/appendText` for letter summaries and carer notes; `.calendar.*` only if Kairos owns appointments; `.system.searchInApp` / `.system.open`. Domains with use-case groups must be adopted together.
- Add `IndexedEntity` + `@Property(indexingKey:)`, View Annotations (`.appEntityIdentifier`) on the letter and medicine screens, `Transferable` with `IntentValueRepresentation`, `OwnershipProvidingEntity`, and entity identifiers on Kairos notifications.
- Use `LongRunningIntent` + `CancellableIntent` with `allowedExecutionTargets = .main` for jobs over 30 s. It shows a Live Activity automatically.
- There is **no** chatbot "Extensions" API, no MCP in App Intents, and no finance, health or chat schema domain. Siri AI therefore cannot hand open-ended chat to Kairos. "Siri, ask Kairos" stays an App Shortcut.
- One Sep 2026 forum report says App Shortcut phrases broke once Siri AI was enabled. Regression-test with Siri AI on and off, using the AppIntentsTesting framework.

**iOS 27 on the 12 Pro Max:** still classic Siri. It gains `LongRunningIntent` (no device limit documented; unverified), the Shortcuts **Notification trigger** (WhatsApp or bank notification text → `ReportToKairos`; inferred to work without Apple Intelligence), and `RunSystemShortcutIntent` widget buttons. Schema intents compile but nothing uses them. Background Neural Engine use now needs the new `continued-processing.inference` entitlement (free-team status unknown).

## 5. What the agent can automate, and what it can't

| Use case (time saved) | Tool | 12 Pro Max, free team | Tap needed? |
|---|---|---|---|
| "Remind me to take my pills at 8 every night" | AlarmKit `.weekly` (sounds through silent mode and Focus) + `LogDoseIntent` | ✅ | One-time permission |
| "Did I take my tablets?" | Own dose log; HealthKit `HKMedicationDoseEvent` (read-only, iOS 26) | 🟡 | No |
| "What's on tomorrow?" / "Put the dentist in Tuesday 3pm" | EventKit full access | ✅ | No |
| "Read this letter and tell me what to do" | VisionKit scan → Vision `RecognizeDocumentsRequest` → LLM (foreground) → EKReminder | ✅ | Capture tap |
| "Is this text a scam?" | Share sheet / paste → rules + LLM; Message Filter extension for unknown SMS (rules only) | ✅ | No |
| "Translate this" | VisionKit DataScanner (A12+) → Translation (on device) → speech | ✅ | First-time download |
| "What did the doctor say?" | Record (audio mode) → SpeechTranscriber/DictationTranscriber → summary → reminders | ✅ | Record tap |
| "Timer for the oven, 40 minutes" / "alarm for my bus" | AlarmKit; MapKit `calculateETA` (transit is ETA only) | ✅ / 🟡 | No |
| "Turn on the lounge lamp" | HomeKit (free capability) | ✅ | No |
| "Call my daughter" | Kairos-learned relationship (iOS has no Me card) → `tel:` | 🟡 | System "Call" alert |
| "Text Sarah I'm late" / "WhatsApp John" | MFMessageComposeViewController / `wa.me` link | 🟡 | User taps Send |
| "Play some Elvis" | Local music library only (MusicKit catalog is effectively paid) | 🟡 | No |
| "Morning briefing" | Time-of-Day automation → background intent (30 s, CPU, templates); or overnight `BGProcessingTask` on charger (CPU monitor off) | 🟡 | No |
| "Call 999" | `tel:999` + prefilled SMS to an emergency contact | 🟡 | System alert |
| "Book me a GP appointment" | 🔧 07:58 alarm + one-tap call, or the practice website in Kairos's own WKWebView (user logs in; Face ID before submit) | 🔧 | Yes |
| "Will it rain?" | 🔧 Open-Meteo HTTP (WeatherKit is paid) | 🔧 | No |
| "Read my WhatsApps" | ❌ No API. Bridges: Message trigger (iMessage/SMS), iOS 27 Notification trigger, Mac hub `wacli` | ❌ | — |
| "Make the writing bigger" / "turn on Wi-Fi" | ❌ Apps can't change settings; guide step by step with pictures | ❌ | — |

Also not possible: reading or driving other apps' UI (iCTRL and iPhone Mirroring stay demo-only), silent sending, push wake-ups and Time Sensitive notifications on the free team, and any background GPU on iPhone.

## 6. Step-by-step build path for TODAY (this Mac, this phone)

**0. Pre-flight (5 min).**
- On the phone, turn **off** Settings > General > Software Update > Automatic Updates. Deploying from 26.0.1 to iOS 27 is untested.
- Check that Developer Mode is on.
- Two of the three free app slots are used (Kairos and the iCTRL runner). Add the engine **to the existing Kairos target**, so no new app slot or App ID is spent.
- The team's Ollama on :11434 hangs on any model that isn't already loaded. Restart it before the demo and switch the hub to `qwen3.5:4b`, since qwen2.5:7b followed an injected command.

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun devicectl list devices                                  # phone = 41B1B15C-AAB1-5D64-914E-534DF7FADB59
xcrun devicectl device info apps --device 41B1B15C-AAB1-5D64-914E-534DF7FADB59 | grep -i 6q9wsfp48t
```

**1. Engine: copy the proven package into the app (5 min).** The package contains the `llama.xcframework` b11669 (sha256 `937891f2…608e7c`), `LlamaEngine.swift` and `KairosAgent.swift`.

```bash
SP=/private/tmp/claude-501/-Users-gaddamshivateja-Oxford-hackathon-2026/7655e89d-5e03-4645-a85e-9d84479a1b5b/scratchpad/spikes
mkdir -p /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/Packages
rsync -a --exclude .build $SP/open-runtime/KairosLocal/ /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/Packages/KairosLocal/
# Newer engine (optional): llama-b11869-xcframework.zip, 67,508,355 B, sha256 1bd572b9ccf0829fd67e1d04e6ab8cafb7baca5459dc17cbfe6fcb2cce509d28
```

**2. `tempo-ios/project.yml` additions.** Packages, entitlement and Info.plist keys:

```yaml
packages:
  KairosLocal: { path: Packages/KairosLocal }          # alongside ElevenLabs / LiveKit
targets:
  Tempo:
    dependencies:
      - package: KairosLocal
        product: KairosLLM                              # llama.framework is embedded and signed automatically
    entitlements:
      path: TempoApp/Kairos.entitlements
      properties:
        com.apple.developer.kernel.increased-memory-limit: true   # Xcode's own capability cache lists XCODE_FREE_PROGRAM
    info:
      properties:
        UIFileSharingEnabled: true                      # lets Finder drop a .gguf into Documents/
        LSSupportsOpeningDocumentsInPlace: true
        NSRemindersFullAccessUsageDescription: "Kairos adds the reminders you ask for."
        NSCalendarsFullAccessUsageDescription: "Kairos reads and adds your appointments when you ask."
        NSContactsUsageDescription: "Kairos finds the person you want to call or text."
        NSAlarmKitUsageDescription: "Kairos sets alarms for your medicines and timers."
        NSSpeechRecognitionUsageDescription: "Kairos turns what you say into text on your phone."
```

If provisioning rejects the memory entitlement, delete it and stay at 2B or smaller. Don't add Extended Virtual Addressing; it is paid-only.

**3. Build and install.** This is the team's existing command with a device destination:

```bash
/opt/homebrew/bin/xcodegen generate --spec /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/project.yml --project /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios
xcodebuild build -project /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/Tempo.xcodeproj -scheme Tempo -configuration Debug \
  -destination id=41B1B15C-AAB1-5D64-914E-534DF7FADB59 -clonedSourcePackagesDirPath /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/.build/spm \
  -derivedDataPath /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/build -allowProvisioningUpdates -skipPackagePluginValidation
xcrun devicectl device install app --device 41B1B15C-AAB1-5D64-914E-534DF7FADB59 /Users/gaddamshivateja/Oxford-hackathon-2026/tempo-ios/build/Build/Products/Debug-iphoneos/Tempo.app
```

There is no iOS Simulator slice, so test on the device. If you add AnyLanguageModel later, append `-skipMacroValidation`.

**4. Model delivery (dev builds).** Copy the GGUF into the app container. Don't bundle it, because every reinstall would push it again.

```bash
xcrun devicectl device copy to --device 41B1B15C-AAB1-5D64-914E-534DF7FADB59 --domain-type appDataContainer \
  --domain-identifier uk.oxhack.tempo.6q9wsfp48t \
  --source $SP/open-runtime/models/llama-3.2-1b-instruct-Q4_K_M-from-Q8_0.gguf --destination Documents/kairos-1b.gguf
# Better tool use, already on disk: Ollama llama3.2:3b blob ~/.ollama/models/blobs/sha256-dde5aa3f…ccdff (2.02 GB, Q4_K_M)
# Recommended (needs your OK to download, 1,280,835,840 B): https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf
#   sha256 aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223
```

Ollama's `qwen3.5:*` models are stored as per-tensor blobs, which llama.cpp can't load. Only llama3.2 1b/3b and qwen2.5:7b are single GGUF files.

**5. Memory and speed settings (start values):**
- `n_ctx` 2048, `n_ubatch` 256 (the Metal compute buffer is 268 MB at 512), `use_mmap` on, mmproj off.
- Log `os_proc_available_memory()` at launch and after load, and pick 2B or 4B from that number.
- First launch compiles all Metal shaders: 5.65 s on the M3 Pro, longer on the A14. Show "Getting ready…" and prewarm.
- Snapshot the system+tools prefix once with `llama_state_seq_get_data`, and restore it with `llama_state_seq_set_data` before each turn. Qwen3.5's hybrid layers can't partially truncate (`llama_memory_seq_rm` fails).

**6. Background behaviour (all iPhones):**
- On `scenePhase == .inactive`, cancel generation, keep the tokens and finish the scheduled GPU work. Metal command buffers fail with `.notPermitted` or `accessRevoked` once the app is backgrounded.
- After an error, free and recreate the context. Discard the step that was in flight (llama.cpp PR #20306).
- While generating, set `isIdleTimerDisabled = true`.
- A CPU path for the background needs a **second** model load with `n_gpu_layers = 0`, `op_offload = false` and `use_extra_bufts = false`. Without these, prefill still goes to Metal, and the CPU path repacks weights into dirty memory: 1.6 GB footprint for 1B on the Mac. Throttle to 1–2 threads, because the CPU monitor kills apps running at 60–80% CPU. For the hackathon, keep LLM turns in the foreground.

**7. The 2–3 hour MVP slice (demo by 12:00):**
1. (30 min) Add `KairosLLM` to Tempo, and add a "Local brain" debug screen that loads `Documents/*.gguf` and shows tok/s, `phys_footprint` and `os_proc_available_memory`.
2. (45 min) Replace the spike's mock tools with real ones: `create_reminder` with EKReminder, `set_timer` with AlarmKit, and `send_message` with MFMessageCompose (the user taps Send). Keep the GBNF grammar, the NSDataDetector guard and the templated confirmations.
3. (30 min) `TalkToKairosIntent` already exists. Add a local-brain path when the hub is unreachable, and an `AskKairosIntent` that runs **deterministic** reminder and timer parsing in the background.
4. (30 min) Run 10 of the 52 eval prompts on the phone in airplane mode. Record correctness and A14 tok/s, and put the numbers on the demo slide.
5. Demo line: airplane mode on → "Siri, talk to Kairos" → "Remind me to take my pills at 8 tonight" → the card shows **Sun 25 Oct, 20:00** → the reminder appears in Reminders.

**This week (production path):**
- Install Xcode 26.6. It runs on macOS 26.5.2 and brings Swift 6.3, the iOS 26.5 SDK, `contextSize`/`tokenCount` and `CancellableIntent`, and lets you use AnyLanguageModel 1.x.
- Then update macOS to 26.6+ and install Xcode 27.1, plus `xcodebuild -downloadComponent MetalToolchain` (about 700 MB; get approval first). That unlocks iOS 27 `LanguageModel`, Core AI and MLX.
- Test on a **second** phone running iOS 27 before moving the demo phone.

## 7. Spike results (what we proved on this Mac)

**Spike A: Apple Foundation Models agent** (`spikes/foundation-models`). ✅ Works with the real on-device ~3B model on the M3 Pro, with no entitlement, from a plain command-line binary.
- **Latency:** cold first call 0.95–1.96 s. Medians per turn (v4.1): reminder 2.32 s, calendar 2.29 s, message 1.94 s, chit-chat 2.02 s, two tool calls 3.45 s. `@Generable` letter summary 1.2–1.7 s.
- **Correctness (from tool-side logs):** reminder 63/64, calendar 24/24, message 24/24, chit-chat with no tool 24/24. Multi-intent 13/15; the other 2 claimed a reminder it never created. Ambiguous "remind me about the doctor": code-side slot filling went 10/10.
- **Guardrail false positives:** guardrailViolation fired on an energy bill (1/3) and on scam SMS as structured output (5/6). Asked as a String, the scam SMS got 0/6 violations and correct advice.
- **iOS build:** the same code type-checks under Swift 6 and builds an iOS app (arm64, 716 KB). In the iOS 26.0.1 simulator every call failed with ModelManagerError 1026. The simulator runs the model on the host Mac and needs matching versions; this one was on a 26.5.2 host.

**Spike B: open runtime** (`spikes/open-runtime`).
- ✅ The llama.cpp b11669 xcframework (65.9 MB zip; ios-arm64 dynamic framework 11.9 MB, minimum iOS 16.4) reports `EMBED_LIBRARY = 1`, so it needs no Metal Toolchain. `swift build` took 3.4 s.
- **Mac Metal numbers, 1B Q8_0:** 430-token prompt in 243 ms (1,772 tok/s); generation 79 tok/s; first tool call 0.93 s; cached follow-ups 0.34–0.71 s; peak footprint 339 MB (maxRSS 1,566 MB counts the mmap). 3B Q4_K_M: generation 44–48 tok/s, peak 512 MB, all 3 tool calls right.
- ✅ iOS app (generic device) BUILD SUCCEEDED in about 10 s: 12 MB `.app`, 3.4 MB zipped. ❌ The simulator build fails because there is no slice.
- ❌ MLX: mlx-swift-lm 3.32.3 won't resolve (tools 6.3). The pinned 3.31.3 + 0.31.4 resolve, then fail at `CompileMetalFile` with "missing Metal Toolchain".

**Spike C: tool-calling eval** (`spikes/toolcall-eval`). The tables are in section 3. **Headline: qwen3.5:4b scored 88.5% over 52 cases and never made an unrequested call, message or shortcut. Llama 1B scored 32.7%: it rang a contact in reply to "thank you" and invented a phone number.** "Quarter to seven" failed for every model without the normaliser, and Hindi "parso" failed for every model.

**Not proven anywhere yet:** a single token generated on the iPhone 12 Pro Max.

## 8. Risks, limits, unknowns, and what to test on the phone

**Test first on the 12 Pro Max, in this order.** None of these is measured yet.
1. `os_proc_available_memory()` with and without increased-memory-limit, and whether free signing accepts that entitlement. Xcode's capability cache lists `XCODE_FREE_PROGRAM`, but one community report says it fails.
2. llama.cpp on the A14: GPU family line (expect Apple7, simdgroup mm), first-launch shader compile time, decode and prefill tok/s for 1B, 3B, Qwen3.5-2B and 4B (`llama-bench`-style), and footprint (aim for under 1–1.5 GB).
3. Whether Qwen3.5's Gated DeltaNet ops run correctly on A14 Metal, and that the prefix-state snapshot and restore works.
4. Tool accuracy of Qwen3.5-2B (both on our 52-case suite and on the phone). Qwen3.5 was trained on an XML tool format, so a JSON grammar may cost accuracy; measure both.
5. Siri: whether `requestValueDialog` swallows questions, how long classic Siri waits for `perform()`, and en-GB recognition of "Kairos".
6. Background: CPU-only decode speed with 2 threads, CPU monitor kills, and memory with a second CPU model loaded.
7. `SpeechTranscriber.isAvailable` (en-GB), `MKDirections` on a Personal Team, AlarmKit on the free team.

**Known limits and risks:**
- No background GPU on any iPhone. DTS says background GPU is "not available" on iPhone, and iOS 27's `requiresGPU` applies to "supported devices", so far M3+ iPads. On iOS 27, background Neural Engine use also needs the new entitlement.
- A cold prompt takes seconds on the A14, so prefix caching is mandatory. Watch thermals: the 12 Pro Max may drop to roughly 60% of burst speed when hot.
- Small-model failure modes:
  - Schema echo (writing the schema back as arguments).
  - Calls printed as text instead of made.
  - Hallucinated outcomes.
  - Wrong dates on the BST→GMT day (today).
  - Apple's guardrail false positives on bills and scams.
  - Undocumented `GenerationError -1` (4 in about 200 turns; retry once).
- Free team: 7-day profiles (tonight's build stops about 31 Oct), 3 apps per device, 10 App IDs per 7 days, no push or Time Sensitive notifications, no TestFlight or Background Assets.
- iOS 27 path:
  - Xcode 27 needs macOS 26.6+, and Apple's Core AI article says macOS 27.
  - The CoreAILM SPM package floors the app at iOS 27, so a single binary needs two targets or a weak-linked xcframework (coreai-models #224).
  - Core AI caches are invalidated by every OS update, and on the A14 that means a full on-device specialization each time.
  - Known bugs: corrupt output with KV bound at seq ≥ 2048 (#124), ANE wrong results (#279).
- App Review:
  - Downloaded weights pass in practice (PocketPal, Locally AI, Private LLM, Enclave, Noema, Google AI Edge Gallery).
  - Guidelines 4.7.2/4.7.3 (exposing native APIs to software not in the binary) are an interpretation risk. Keep tools compiled in, confirm each action, use a curated model list, and add review notes with a demo script.
- Unverified: whether the iOS 27 `LanguageModel` protocol runs custom models on the A14. Apple documents the intent ("support a range of devices that might not support Apple Intelligence"), but there is no A14 report.

**Corrections to the prior research** (Kairos-iPhone-Capabilities.md and Kairos-OnPhone-Agents-Components.md):
1. "Keep the LLM on the Mac (Ollama qwen2.5:7b)" (lines 451, 621, 623) is outdated. A local llama.cpp agent builds with this exact toolchain. Also, qwen2.5:7b followed an injected command, and qwen3.5:4b beats it (88.5% vs 75.0%). Switch the hub.
2. "0.5–1.5B at 4-bit" (line 657) has two problems. Memory allows 2–4B with mmap, but a 1B model fails as an agent. Replace the ceiling with an on-device measurement.
3. "contextSize 8192 for the iOS 27 model" (line 617): Apple's docs still say 4,096. Apple's WWDC code shows 8192 "on 27.0 (newer devices)", without saying which. Read it at runtime and budget 4,096.
4. The fact-checker's note that PCC is "not tied to the Small Business Program" is wrong. Apple's PCC page requires SBP enrolment, fewer than 2 million first-time downloads, and the entitlement.
5. Claude/Gemini packages "will soon" ship: they now exist. `anthropics/ClaudeForFoundationModels` is at 0.2.3, and Firebase's `GeminiLanguageModel` is in SDK 12.19.0 (preview). Both are iOS 27 and cloud.
6. "Not documented" whether `LanguageModel` works on non-AI iPhones: Apple's Core AI article states that intent. It is still untested on the A14.
7. "Xcode 26.0.1 device support iOS 15–26" (line 663) is the Deployment Targets column; Device Support reads "iOS 15 or later". Deploying to iOS 27 is untested, so keep "don't update the demo phone".
8. BGContinuedProcessingTask "for long background agent jobs" (line 664): CPU only on iPhone, it must start from a tap, and it shows a cancellable progress UI.
9. LocalLLMClient as "llama.cpp + MLX" (Components lines 16, 68): the MLX half is blocked here, the version pin fails because of unsafeFlags, and it has no GPU-layer control on the device. "Qwen3-1.7B" is superseded by Qwen3.5. WhisperKit on this phone is limited to tiny, base and small.
10. "WhatsApp can't be captured on the iPhone at all" (line 662) holds only up to iOS 26. The iOS 27 Notification trigger can pass notification text.
11. The free-team lists omit **Increased Memory Limit**. Xcode's capability cache allows it for free teams; EVA is paid.
12. Within this run: spike C's "free team cannot add increased-memory-limit" and spike A's "AnyLanguageModel needs Xcode 26.4+" are both wrong. 0.14.2 built with Xcode 26.0.1.
13. Also: the Foundation Models adapter toolkit is discontinued (26.0.0 was the last release and doesn't work on OS 27). `tokenCount(for:)` is iOS 26.4+ and is not back-deployed. Shortcuts "Use Model" shipped in iOS 26 on Apple Intelligence devices. Open Minis is on the App Store (cloud models only).

## 9. Open-source plan

- **Licence:** Apache-2.0 for Kairos, with `NOTICE`, `THIRD_PARTY_LICENSES.md` generated from `Package.resolved`, `MODEL_LICENSES.md`, `TRADEMARKS.md`, and a DCO for contributions. Never link GPL or AGPL code: OpenMinis/iSH, PRoot, SideStore, AltStore. The App Store terms conflict with the GPL, as when VLC was pulled in 2011. Also avoid source-available Cactus.
- **Reuse:**
  - llama.cpp (MIT) and llama.swift (MIT).
  - AnyLanguageModel (Apache-2.0).
  - PocketPal's `AskPalIntent`, a background Siri intent running a CPU llama.cpp model (MIT, Swift files).
  - mlx-swift-lm (MIT), LiteRT-LM (Apache), apple/coreai-models (BSD-3), apple/foundation-models-utilities (Apache, `ChatCompletionsLanguageModel` → Ollama).
  - WhisperKit (MIT), Bouncer (MIT, Message Filter example).
  - google/mobile-actions (CC-BY-4.0) to fine-tune an iOS-actions model later.
  - Read Open Minis for ideas only; it is GPL.
- **Gap we fill:** no project combines all of these: a permissive licence, a local model that works on non-AI phones, native iOS tools with a confirmation for each action, Siri both ways, and an elder-first voice UX with scam protection. PocketPal has local inference and Siri, but no device tools. Open Minis has tools, but it is GPL and cloud-only. Google's Gallery has on-device Mobile Actions, but its iOS source is closed.
- **Model licences:** default to Apache-2.0 models (Qwen3.5 0.8B/2B/4B, Gemma 4 E2B/E4B, both ungated).
  - Llama 3.2: ship the licence and a Notice, and show "Built with Llama".
  - Gemma 3 and FunctionGemma: Gemma Terms, whose use restrictions pass on to users.
  - Avoid LFM2.5 (licence only below $10M revenue) and xLAM, Hammer and Arch-Agent (non-commercial).
  - Show a licence card before each model download.
- **Model delivery in production:**
  - App Store and TestFlight: Apple-hosted Background Assets (iOS 26+, `onDemand` pack, up to 200 GB per app; paid account).
  - Everything else: `URLSession` background download from a **pinned Hugging Face commit**, verified against `X-Linked-ETag` (SHA-256) and the `GGUF` magic bytes. Store it in Application Support with `isExcludedFromBackup`, Wi-Fi only by default.
  - Keep a signed catalog: `{id, repo, commit, file, size, sha256, minRAM, licence}`.
- **How non-technical users get it:**
  - App Store, or a TestFlight public link for carer-led pilots (builds expire after 90 days). Both need the $99/year program, or the fee waiver for a nonprofit or education partner. The waiver does not cover individuals.
  - A carer sets it up once: Back Tap → Kairos, a Lock Screen control, an Assistive Access tile, and automations.
  - Free-account sideloading (7-day expiry) is **for demos only**. Never give one to an older person.

## 10. Architecture hand-off (design these next)

| Component | Job | Interface sketch |
|---|---|---|
| **KairosModel** (LanguageModel-style adapter) | One shape for every backend. It maps 1:1 onto `FoundationModels.LanguageModel` / `LanguageModelExecutor` on iOS 27. | `availability() async -> Availability` (available / deviceNotEligible / notDownloaded / lowMemory / hot) · `capabilities` (.toolCalling, .grammar, .vision, .backgroundSafe) · `prewarm(prefix:)` · `respond(ModelRequest) async throws -> ModelResponse` (messages, tool subset, grammar/schema, maxTokens, deadline, compute: .gpu/.cpu) |
| Backends | `SystemFMModel` (Tier 1), `LlamaLocalModel` (Tier 0; GPU and CPU contexts), `HubModel` (Ollama OpenAI-compatible), `GeminiModel` (opt-in); iOS 27: `CoreAIModel`, `MLXModel`, `FMBridge` | Each is a KairosModel |
| **BrainRouter** | Chooses the backend per turn | Inputs: availability, `os_proc_available_memory`, `thermalState`, Low Power Mode, scene phase (fg/bg), task class (route/fill/plan/summarise), locale (Indic → open model), network, consent |
| **ToolRegistry** + PreRouter | Tools compiled into the app; pick 3–5 per turn | `protocol KairosTool { static var name: String; var summary: String; var argsSchema: JSONSchema; var risk: Risk /* .read .localWrite .reachesPerson .money */; func validate(_:, ctx:) throws -> ValidatedCall; func execute(_:) async throws -> ToolResult }`. Adapters generate FM `Tool` conformances and GBNF from `argsSchema`. |
| **SafetyGate** | Deterministic veto between the model and the tools | `check(ProposedCall, TurnContext) -> .allow / .confirm(Card) / .clarify(String) / .block(Reason)`. `TurnContext` separates **userWords** (trusted) from **documents** (untrusted, tagged). Requires LAContext for .reachesPerson; no .money tools. |
| TimeNormaliser + SlotFiller | Date maths and missing slots out of the model | British idioms, Hindi/Telugu lexicon, NSDataDetector cross-check, 10-day table, BST/GMT offsets, absolute read-back. Dialogue state in a Swift state machine; each model call is single-turn. |
| **ActionLog** | Source of truth for what happened | Every executed or blocked call, with arguments. Confirmations and spoken replies are rendered from it, not from model prose. |
| **IntentBridge** | App Intents ↔ agent | `AgentEntry.handle(utterance, source: .siriForeground/.siriBackground/.automation/.ui, deadline:) -> AgentOutcome (dialog, snippet, needsForeground)`. Hosts TalkToKairos, AskKairos, KairosSkill, ReportToKairos and the iOS 27 schema intents. |
| LifecycleGuard | Keeps GPU work safe across app states | scenePhase → cancel, await, mark context dirty, recreate on .active; CPU context for background; `isIdleTimerDisabled` |
| ModelStore + Catalog | Download, verify, choose, delete models | Pinned commit + SHA-256, RAM tier, licence card, Background Assets on store builds |
| PromptCache | Fast turns on the A14 | Per-model snapshot of the system+tools prefix (`llama_state_seq_get/set_data`, saved to disk). Invalidated when the tool set or model changes. |
| EvalHarness | Stops regressions | The 52-case suite (EN/HI/TE, injection, chit-chat) runs on the device. It gates model swaps and prompt changes on exact-match tool and arguments. |

What runs where: route and slot-fill run locally. Read-and-act on device data runs locally. Long plans and summaries of more than about 4 pages go to the foreground 4B, the hub or Gemini, with consent. Anything in a background or Siri path is deterministic, or a CPU 1B/2B, or the hub.

## 11. Sources

**Spikes (this Mac, 25 Oct 2026):** `/private/tmp/claude-501/-Users-gaddamshivateja-Oxford-hackathon-2026/7655e89d-5e03-4645-a85e-9d84479a1b5b/scratchpad/spikes/` (`foundation-models/`, `open-runtime/` incl. `KairosLocal/` and `deploy-to-iphone.sh`, `toolcall-eval/results/score-main.txt`). Xcode capability cache: `/Applications/Xcode.app/Contents/SharedFrameworks/DVTPortal.framework/Versions/A/Resources/DVTPortalCachedPortalCapabilities.json` (Increased Memory Limit includes XCODE_FREE_PROGRAM, checked today).

**Apple, Foundation Models and Core AI:**
- <https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel> · <https://developer.apple.com/documentation/foundationmodels/tool/call(arguments:)> · <https://developer.apple.com/documentation/foundationmodels/managing-the-context-window> · <https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize> · <https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/tokencount(for:)>
- <https://developer.apple.com/documentation/foundationmodels/languagemodel> · <https://developer.apple.com/documentation/foundationmodels/running-a-core-ai-model-in-a-foundation-models-session> · <https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute> · <https://developer.apple.com/private-cloud-compute/> · <https://developer.apple.com/foundation-models-framework/>
- <https://developer.apple.com/documentation/coreai> · <https://developer.apple.com/documentation/coreai/compiling-core-ai-models-ahead-of-time> · <https://developer.apple.com/documentation/coreai/managing-model-specialization-and-caching> · <https://github.com/apple/coreai-models> (1.0.0; issues #49, #124, #224, #279) · <https://github.com/apple/foundation-models-utilities> · <https://developer.apple.com/apple-intelligence/foundation-models-adapter/>
- WWDC26: <https://developer.apple.com/videos/play/wwdc2026/241/> · /319/ · /324/ · /339/ · /345/ · /347/ · /8011/ · <https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models> · <https://machinelearning.apple.com/research/introducing-apple-foundation-models> · <https://developer.apple.com/forums/thread/807145> (simulator version mismatch)

**Background, memory, toolchain:**
- <https://developer.apple.com/documentation/metal/preparing-your-metal-app-to-run-in-the-background> · <https://developer.apple.com/forums/thread/807957> · <https://developer.apple.com/forums/thread/797538> · <https://developer.apple.com/forums/thread/816774> · <https://developer.apple.com/documentation/appintents/longrunningtaskoptions/requiresgpu> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.background-tasks.continued-processing.inference> · <https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes>
- <https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados> · <https://developer.apple.com/videos/play/wwdc2025/227/> · <https://developer.apple.com/videos/play/wwdc19/707/> · <https://developer.apple.com/forums/thread/758387> · <https://developer.apple.com/documentation/xcode/identifying-high-memory-use-with-jetsam-event-reports>
- <https://developer.apple.com/documentation/os/os_proc_available_memory> · <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit> · <https://developer.apple.com/help/account/reference/supported-capabilities-ios> · <https://github.com/a-ghorbani/pocketpal-ai/pull/651> · <https://github.com/SideStore/SideStore/issues/1616> · <https://github.com/c22dev/muguet/pull/13> · <https://developer.apple.com/forums/thread/834805>
- <https://developer.apple.com/xcode/system-requirements/> · <https://developer.apple.com/forums/thread/805547>

**Runtimes:**
- <https://github.com/ggml-org/llama.cpp/releases> (b11669, b11869) · <https://github.com/ggml-org/llama.cpp/blob/master/build-xcframework.sh> · <https://github.com/ggml-org/llama.cpp/blob/master/.github/workflows/release.yml> · <https://github.com/ggml-org/llama.cpp/pull/20306> · <https://github.com/ggml-org/llama.cpp/discussions/4508> (A14 numbers) · <https://github.com/ggml-org/llama.cpp/issues/20225> · <https://github.com/ggml-org/whisper.cpp/issues/3531>
- <https://github.com/huggingface/AnyLanguageModel> (0.14.2 and 1.1.0 Package.swift) · <https://github.com/mattt/llama.swift> · <https://github.com/tattn/LocalLLMClient> · <https://github.com/ml-explore/mlx-swift> · <https://github.com/ml-explore/mlx-swift-lm> (PR #389, 3.32.3) · <https://github.com/ml-explore/mlx-swift/issues/274>
- <https://github.com/google-ai-edge/LiteRT-LM> (v0.18.1, issue #2407) · <https://developers.google.com/edge/litert-lm/models/gemma-4> · <https://github.com/cactus-compute/cactus/blob/main/LICENSE> · <https://github.com/Anemll/Anemll>

**Models and evals:**
- <https://huggingface.co/Qwen/Qwen3.5-2B> · <https://huggingface.co/Qwen/Qwen3.5-4B> · <https://huggingface.co/unsloth/Qwen3.5-2B-GGUF> · <https://huggingface.co/unsloth/Qwen3.5-4B-GGUF> · <https://huggingface.co/blog/gemma4> · <https://ai.google.dev/gemma/docs/core/model_card_4> · <https://arxiv.org/pdf/2607.02770> · <https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct/blob/main/LICENSE>
- <https://gorilla.cs.berkeley.edu/data_overall.csv> (BFCL V4, 2026-04-12) · <https://github.com/john-rocky/apple-silicon-llm-bench> · <https://ananasdda.github.io/pocket-ai-lab/benchmarks/> · <https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/MODEL_CARD.md> · <https://support.apple.com/en-gb/121115>

**Siri, App Intents, tools:**
- <https://developer.apple.com/videos/play/wwdc2022/10169/> · <https://developer.apple.com/videos/play/wwdc2023/10102/> · <https://developer.apple.com/documentation/appintents/appintent/supportedmodes> · <https://developer.apple.com/documentation/appintents/intentcancellationreason/timeout> · <https://developer.apple.com/documentation/appintents/longrunningintent> · <https://developer.apple.com/documentation/appintents/snippetintent> · <https://developer.apple.com/forums/thread/764177> · <https://developer.apple.com/forums/thread/764501> · <https://developer.apple.com/forums/thread/655189>
- <https://developer.apple.com/documentation/appintents/app-schema-domains> · <https://developer.apple.com/videos/play/wwdc2026/240/> · <https://developer.apple.com/videos/play/wwdc2026/343/> · <https://developer.apple.com/forums/thread/847230> · <https://www.apple.com/newsroom/2026/09/siri-ai-a-profoundly-more-capable-and-personal-assistant-is-here/> · <https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/>
- <https://support.apple.com/en-gb/guide/shortcuts/apdcd7f20a6f/ios> · <https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit> · <https://developer.apple.com/documentation/eventkit/accessing-the-event-store> · <https://developer.apple.com/documentation/messageui/mfmessagecomposeviewcontroller> · <https://developer.apple.com/documentation/vision/recognizedocumentsrequest> · <https://developer.apple.com/documentation/translation/translationsession> · <https://developer.apple.com/documentation/mapkit/mkdirectionstransporttype/transit> · <https://developer.apple.com/documentation/contacts/cncontactstore/unifiedmecontactwithkeys(tofetch:)>

**Shipping and prior art:**
- <https://developer.apple.com/app-store/review/guidelines/> · <https://developer.apple.com/support/terms/apple-developer-program-license-agreement/> · <https://developer.apple.com/documentation/backgroundassets/downloading-apple-hosted-asset-packs> · <https://developer.apple.com/help/app-store-connect/reference/apple-hosted-asset-pack-size-limits> · <https://developer.apple.com/support/compare-memberships/> · <https://developer.apple.com/help/account/membership/fee-waivers/> · <https://www.fsf.org/news/2010-05-app-store-compliance>
- <https://github.com/a-ghorbani/pocketpal-ai> (AskPalIntent.swift, LlamaInferenceEngine.swift) · <https://github.com/OpenMinis/OpenMinis> · <https://github.com/google-ai-edge/gallery> · <https://huggingface.co/datasets/google/mobile-actions> · <https://github.com/openclaw/openclaw/blob/main/apps/ios/APP-REVIEW-NOTES-APPLE.md>
