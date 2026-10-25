# AI agents on the iPhone, for automation and protection: what already exists and what we can take

*Survey done Sun 25 Oct 2026, 02:00–02:30, for the Navigator (tempo-hub/navigator) and Kairos (tempo-ios).*

The question: which existing, usable projects give us agents that run **on the iPhone itself**, can **drive other
apps**, and can **protect** the person, so that we pull components in rather than rebuild them. Verdicts first, then
the detail and the sources.

## Verdicts

| Need | Best existing piece | Verdict | What we did / do |
|---|---|---|---|
| An agent runtime that runs **on the phone** | **OpenMinis** (App Store, iOS 16+, GPL-3, Swift): a full Alpine Linux userland on-device (ARM64 iSH fork), Python/Node/git, `apk`, Gemini or any OpenAI-compatible model, skills in the `SKILL.md` format, device bridges (Health, Calendar, Reminders, Contacts, Speech) as shell CLIs | ✅ Use it as the host today. Our Navigator is stdlib Python 3.9+, so it runs inside unchanged. | Packaged as a Minis skill: `tempo-hub/navigator/build_minis_skill.sh` → `dist/kairos-navigator.zip`. |
| Driving **other apps** on iOS | **iCTRL** (OpenMinis, Apache-2.0): XCUITest runner serving encrypted JSON-RPC on `127.0.0.1:8200`; an agent on the same phone reaches it over loopback with no Mac. Vision OCR fallback for web views. | ✅ Already installed on the phone. The only route that works for a non-jailbroken iPhone; Apple has no agent API for third-party apps. | `navigator/hands.py` `ICTRLHands` now pairs on first use (`--pair-as`) and works at `127.0.0.1:8200`. |
| The owner's **approval** on the phone | Nothing off the shelf. OpenMinis has "granular permissions" but no owner-approval flow for money. OpenClaw's iOS node does voice approvals, but against a gateway on a computer. | ✅ Ours: Kairos card + Face ID (LocalAuthentication), one-time 90 s token. | `navigator/card_server.py` (loopback API) + Kairos "Navigator on this phone" mode. |
| A **brain** on the phone | Gemini from the phone (API key in Minis's Keychain). Offline fallback: **LocalLLMClient** (MIT, iOS 17+, llama.cpp + MLX; Qwen3-1.7B-4bit class models fit an iPhone 12 Pro Max) | 🟡 Gemini now; a 1.7B local model only for classification/recovery, never for money | `brain.py` already selects Gemini → Ollama → off; a `LocalLLMClient` backend is the Swift-side follow-up. |
| **Speech** on the phone | **WhisperKit** (Argmax, MIT; Swift package, CoreML, streaming) or Apple `SFSpeechRecognizer` / `SpeechAnalyzer` (free, on-device) | ✅ Apple's first (zero dependency), WhisperKit when accents need better accuracy | Follow-up in Kairos (the voice today is ElevenLabs over the Mac). |
| **Scam protection** rules | Our own Tempo repo: `tempo_core/scam.py` Scam Shield (pressure signs: "safe account", deadlines, codes, secrecy, gift cards; FCA Register, FCA Warning List, Companies House checks; "never says safe") | ✅ Ported | `navigator/scamshield.py`, wired into `policy.py`: a big ask refuses the payment, a small sign makes Kairos read it back twice. |
| **Scam protection** on the OS | Apple **Message Filter extension** (`ILMessageFilterExtension`, on-device junking of SMS from unknown senders; open-source example **Bouncer**) and **Call Directory extension** (CallKit block/identify lists; what Truecaller/Hiya use). Live Caller ID Lookup needs a server. | 🟡 Product path: ship Scam Shield's rules inside a Message Filter extension of Kairos. Not built tonight. | Documented below. |
| Paying **real banks** without driving their UI | **Open Banking** PISP sandboxes (TrueLayer, Yapily, Santander) and **Confirmation of Payee** APIs (Santander sandbox, SurePay developer portal) | 🟡 The right production route: the agent initiates, the bank's own app asks the owner to consent. Regulated access (FCA) for live use. | Documented; the Navigator's `Hands` interface leaves room for an "OpenBankingHands". |
| Screen-understanding models | Mobile-Agent-v3.5 / GUI-Owl-1.5 (Alibaba, Qwen3-VL based, 2B–32B), OpenGUI, MobiAgent, AutoGLM-Phone-9B | 🟡 Android-first research; usable as a recovery brain via Ollama on the Mac, too big for the phone | Not used; the skill-autopilot approach needs no vision model. |
| Gateway + phone-node pattern | **OpenClaw** iOS app (MIT project; node for a self-hosted gateway: chat, Talk mode, approvals, device capabilities) | ✅ Validates our Mac-hub + Kairos design; nothing to copy, the app is a client | Same architecture we already run. |

## 1. OpenMinis: the on-device agent host

OpenMinis describes itself as "an on-device AI agent that goes beyond chat". On iOS it boots an Alpine `minirootfs`
inside an ARM64 fork of iSH (Linux usermode emulation on iOS, running native instructions, so `apk` installs and
scripts are quick). The agent "writes and executes scripts, installs packages, and processes data, no server
needed". Models: Claude, GPT, **Gemini**, OpenRouter, or any OpenAI-compatible endpoint, with keys kept in the
device Keychain. Skills are folders with a `SKILL.md` (YAML frontmatter `name`, `description`, `compatibility`;
`scripts/`, `references/`, `assets/`, `evals/`), the same format Claude, Codex, OpenClaw and Hermes skills use.
It is on the App Store (iOS 16+) and TestFlight, and the source is GPL-3 (it links iSH and PRoot).

iCTRL's own manual is written for an agent on the phone: *"On the phone (e.g. Minis), the device is 127.0.0.1"*, with
the client fetched from `http://127.0.0.1:8200/skill/clients/cli`. So the loop "agent on the phone reads the screen
and taps" is a supported configuration, not a hack.

**What this means for us:** the Navigator runs on the phone tonight as a Minis skill. Inside the sandbox it talks to
the iCTRL runner on loopback, reaches Gemini over the internet, and serves the approval card API on
`127.0.0.1:8790`, which the Kairos app polls when it is on screen. The Navigator brings Kairos forward for the card
(`launch_app`), then brings the bank back (`launch_app`, so the review screen is kept) and presses Confirm.

**Limits to say out loud:**
- GPL-3: we can *run* our code inside Minis and *read* its Swift for reference, but copying its code into Kairos
  (Apache-style project) would make Kairos GPL. Use it as the host, not as a source of code.
- The loopback approval API trusts anything on the phone that can read `/status`. The agent inside Minis is told
  never to call `/approve`, but that is an instruction, not a wall. The native in-app Navigator (below) closes it.
- iCTRL still needs Developer Mode, a 7-day certificate on a free Apple ID, and the DDI remounted after a reboot.
  iPhone Mirroring (Mac drives a locked phone) is the Apple-supported fallback for a demo without it.
- App Store Guideline 2.5.2 (apps that download and run code) is an open question for terminal-and-agent apps;
  Minis's App Store builds lag TestFlight.

## 2. The native path: Navigator inside Kairos (Swift)

Everything the Python Navigator does is portable to Swift, and the iCTRL protocol is deliberately simple
(HMAC-SHA256 everywhere, X25519 only for pairing; `CryptoKit` has both). Order of work when we do it:

1. `Money`, `PayeeBook`, `Policy`, `ScamShield`, `Verify`: pure logic, direct ports with the same tests.
2. `Skill` + `Autopilot`: load the same `skills/oxbank.json` from the bundle; same step DSL.
3. `ICTRLHands` over `127.0.0.1:8200`: pairing (X25519 → `HMAC(shared, "ictrl-pair"+pub+devpub)` → unwrap) and
   the envelope (`k_enc = HMAC(key, "ictrl-v1|enc-req"+nonce)`, PRF-CTR keystream, `tag = HMAC(k_mac,
   "v1"+tok+ts+nonce+ct)`), exactly as `ictrl_rpc.py`.
4. Approval in-app: the token never leaves the process; Face ID gates it (already built).
5. Keep-alive while the bank is in front: the `audio` background mode Kairos already has, with the agent narrating
   its steps (`AVSpeechSynthesizer`), plus a local notification "Tap to approve £50 to ARJUN GADDAM" as the fallback
   way back to the card.
6. Speech in: `SFSpeechRecognizer` (on-device), then WhisperKit if accuracy on accents needs it.
7. Offline brain: `LocalLLMClient` with a 1.7B 4-bit model, for classification and screen recovery only.

A native **OxBank** target is cheap to add (the phone has a free app slot: only Kairos and the iCTRL runner are
installed) and gives a clean accessibility tree instead of OCR on Safari.

## 3. Protection: what the OS lets an app do

- **Message Filter extension** (`ILMessageFilterExtension`, IdentityLookup): iOS asks the extension to classify
  SMS/MMS from unknown senders as allow / junk / promotion / transaction, entirely on-device; network is limited
  to Apple's deferred query flow. Bouncer is an open-source MIT example with word-list rules. Scam Shield's
  pressure patterns are a drop-in rule set: "safe account", "move your savings", a deadline, a code, secrecy.
  Known rough edge: an iOS 26 report that the extension stops being invoked for a conversation already moved to
  Spam.
- **Call Directory extension** (CallKit): the app supplies block and identification lists; regular cellular calls
  only, not VoIP. This is how Truecaller and Hiya work. A live lookup needs a server (Live Caller ID Lookup).
- **In the Navigator itself** (done tonight): `scamshield.assess()` runs on every money request. "The bank just
  called, move £400 to a safe account right now" is refused with: hang up, wait, call the number on your card, or
  159. One small sign ("urgently") lets it proceed but makes Kairos read the amount back twice.
- **Registers** (in the Tempo repo, not yet in the Navigator): FCA Register, FCA Warning List and Companies House
  checks of a firm's name, phone and website. The right place is the "pay a new biller" setup flow.

## 4. Paying real banks: the production route

Driving a bank's UI is a prototype trick and most banks' terms forbid automation. The regulated route is **Open
Banking payment initiation (PISP)**: the agent creates the payment, the bank's own app asks the owner to approve
it (Face ID, in the bank), and the agent only sees the outcome. **Confirmation of Payee** is an API in that world
(Santander exposes CoP v2.9.1 and PIS v3.1.5 in its sandbox; SurePay runs a CoP developer portal; TrueLayer and
Yapily give free self-serve sandboxes with mock banks). Live use needs FCA authorisation or an agent of one, so
for a hackathon the sandbox is the demo and our `Hands` interface is where an `OpenBankingHands` would slot in.

## 5. Android, for "any phone"

Android's `AccessibilityService` lets an app read and act on other apps' UI natively, with the user's consent, so
the whole Navigator can live in one app with no runner. The open-source phone-agent work (Mobile-Agent-v3.5 /
GUI-Owl-1.5, OpenGUI, MobiAgent, AutoGLM-Phone-9B) is Android-first for that reason. Our Tempo repo already has an
Android notification node (`apps/android-signal`, not yet compiled). The `Hands` interface is the seam.

## Sources

- OpenMinis organisation and app: https://github.com/OpenMinis , https://github.com/OpenMinis/OpenMinis ,
  skills: https://github.com/OpenMinis/MinisSkills ; write-up: https://dev.to/creeta/openminis-on-device-alpine-linux-agents-iphone-github-ish-vs-termux-vs-mobile-claude-wor-50o0 ;
  review: https://www.xatakamovil.com/aplicaciones/ver-como-movil-funciona-solo-parece-magia-que-este-agente-sea-gratis-milagro
- iCTRL: https://github.com/OpenMinis/iCTRL (local copy: phone-control/iCTRL, `SKILL.md` "On the phone (e.g. Minis)")
- OpenClaw iOS app: https://www.macrumors.com/2026/06/29/openclaw-ios-app/ , https://www.helpnetsecurity.com/2026/06/30/openclaw-ios-app-iphone-ipad/
- Local LLMs on iPhone: https://github.com/tattn/LocalLLMClient , https://dev.to/tattn/localllmclient-a-swift-package-for-local-llms-using-llamacpp-and-mlx-1bcp ,
  MLX Swift: https://tessl.io/registry/dpearson2699/swift-ios-skills/3.9.0/files/skills/apple-on-device-ai/references/mlx-swift.md
- WhisperKit: https://github.com/argmaxinc/whisperkit , https://docsearch.algolia.com/mcp/docs/repo/argmaxinc/argmax-oss-swift
- Message filtering: https://developer.apple.com/documentation/identitylookup/sms-and-mms-message-filtering.md ,
  https://developer.apple.com/documentation/identitylookup/creating-a-message-filter-app-extension.md ,
  Bouncer: https://github.com/afterxleep/Bouncer , iOS 26 report: https://developer.apple.com/forums/thread/841074
- Call blocking: https://developer.apple.com/forums/thread/800415 , Hiya SDK: https://developer.hiya.com/docs/mobile-sdk-docs/ios/client-sdk/overview
- Open Banking / CoP: https://sandbox-developer.santander.co.uk/sanuk/external-sandbox/product-list ,
  https://blog.finexer.com/open-banking-sandbox/ , https://ffnews.com/newsarticle/surepay-launches-developer-portal-to-empower-uk-psps-to-implement-confirmation-of-payee
- Mobile GUI agents: https://howaiworks.ai/blog/alibaba-gui-owl-1-5-mobile-agent-v3-5.md , https://arxiv.org/html/2510.22009v2 ,
  https://huggingface.co/zai-org/AutoGLM-Phone-9B , https://cdn.jsdelivr.net/gh/core-mate/opengui@main/README.md
- Our own: Tempo repo `packages/tempo_core/src/tempo_core/scam.py`, `tempo_adapters/scam/registers.py`,
  `research/Kairos-iPhone-Capabilities.md` (what a sandboxed iOS app can and can't do).
