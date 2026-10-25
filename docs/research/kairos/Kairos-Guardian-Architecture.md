# Kairos Guardian: the vault and the blue team

> **What this is:** the design of the part of Kairos that makes its other agents safe to trust: a secure local store of
> what Kairos knows about the person, a set of watchers over the agents, a behaviour baseline, and a kill switch.
> Built Sun 25 Oct 2026 at OxHack (theme: TIME). Code: `tempo-hub/guardian/`. Research it rests on:
> `Kairos-Guardian-Threats-and-Defence.md` (76 sources). Marks: ✅ built and tested · ⚠️ built, needs a live run · ❌ not built, honest gap.

## 0. The pitch in one breath

Kairos gives people back time by doing their life admin: reading letters, paying bills, working the phone. The people
who need that most, older people and people new to the UK or to smartphones, don't use automation because they are
afraid of it. They are right to be: an agent that can pay your water bill can be talked into paying a stranger, and the
scams aimed at them run on exactly one thing, **time pressure** ("within 48 hours", "the courier is waiting", "don't
tell anyone, act now"). So safety is not a feature next to the time saving; it is the precondition for it.

**Scammers steal with urgency. Kairos defends with time.** Every defence below puts time back: a cooling-off day for a
new payee, a call-back on a number you already have, a Yes on your own phone with Face ID, a second model's opinion, a
log you can check tomorrow. And a blue team watches the agents themselves, so the thing that saves your time can never
quietly turn on you.

## 1. Threat model: who attacks, and what they can reach

| Attacker | How they get in | What they want | Guardian layer that answers |
|---|---|---|---|
| **A scammer talking to the person** (phone, WhatsApp, text, letter) | The person's trust and hurry; they then *ask Kairos* to pay or call | money moved by the person's own hand (APP fraud: the biggest UK loss category, §1 of the research) | Rhythm + threat catalogue → friction before the Navigator moves; teaching lines |
| **A scammer talking to the agents** (prompt injection) | Words on a letter, a screen, a notification that Kairos reads | make the letter reader say "pay £480 to this account", make the hands call a number | Sentinel in and out; agents only ever write their own kinds; separate letter-reader and bank-driver (Rule of Two) |
| **A compromised agent or token** on the Mac | malware, a leaked hands token, a bad model update | forge "approved", skip Confirmation of Payee, talk the Navigator into a payee | Invariants over the event stream; canaries; lockdown |
| **Someone with a shell on the Mac** | stolen laptop, remote-access scam ("install AnyDesk") | raise the Navigator's caps, edit the payee book, read or edit the vault | Signed manifest of code/prompts/skills/payee book; encrypted vault with a hash-chained log and signed checkpoints; the phone as a second witness |
| **Someone with the person's data** | a leak of the vault or the hub | a script for the perfect scam ("your son Arjun, account ending 4821, usually £200") | Encryption at rest, per-category keys (crypto-shred), blind indexes, least-privilege capabilities, local only |

Out of scope, and said so: the person's own bank app in their own hands; a fully compromised Mac *and* phone at once;
the voice vendor's cloud.

## 2. The defence chain (Swiss cheese: every layer can fail, no single failure loses the money)

```
 a scam arrives ──▶ 1 the person ──▶ 2 the Rhythm ──▶ 3 the Navigator's ──▶ 4 Confirmation ──▶ 5 Yes + Face ID ──▶ 6 the blue team
 (letter, call,    hears the        "unusual for      policy (caps, 24h       of Payee on the    on the person's      watches every
  message)         letter reader's  you" + the scam   cooling-off, no         bank's own screen  own phone, 90 s      step; canaries;
                   plain-words      catalogue:        PINs, no unknown                            window               lockdown
                   scam warning     stop / pause /    payees)
                                    notice + friction
```

| Layer | What it does | Where | Status |
|---|---|---|---|
| 1 Letter reader's safety check | fixed scam signals in code, not only the model's word (teammate's work) | `agents/document_interpreter/safety.py` | ✅ (teammate) |
| 2 Rhythm + threat catalogue | new payee, night, amount vs. the person's own history, urgency/authority/secrecy/unusual payment/remote access/codes, recent scam letter, recent unknown call, velocity → `normal / notice / pause / stop` with friction and a lesson | `guardian/profile.py`, `guardian/threats.py` | ✅ |
| 3 Navigator policy | caps, daily limit, 24 h cooling-off, duplicates, refuses PIN/OTP talk; **now also refuses while the Guardian's lockdown is set** | `navigator/policy.py` | ✅ (teammate + 1 hook) |
| 4 Confirmation of Payee | the name on the bank's review screen must match the payee book | `navigator/verify.py` | ✅ (teammate) |
| 5 Yes + Face ID | a 90-second one-time token, only from the person's phone | `navigator/navigator.py`, iOS `TempoSession` | ✅ (teammate) |
| 6 Blue team | invariants, canaries, sentinel, integrity, heartbeat, lockdown; the phone's Shield | `guardian/watchers.py`, `guardian/run.py`, iOS `ShieldView` | ✅ / ⚠️ live run |

The research's finding on warnings (Akhawe & Felt: generic warnings get clicked through; specific, rare, active ones
are heeded) shapes every message: each alert names the exact problem and gives one step ("ring 159", "call the old
number", "tell someone you trust").

## 3. The vault: storing what Kairos knows without creating the perfect scam script

`guardian/vault.py`, a separate SQLite file from the hub's raw life log, holding **derived** facts (who "my son" is, the
usual water bill, which hours the person is active, where they get stuck) and the canaries.

| Property | How | Why it matters |
|---|---|---|
| Encrypted at rest | AES-256-GCM per record; one data key per **category** (people, habits, money, documents…) wrapped by a root key (`data/vault.key` 600, or the macOS Keychain); the category and record id are the associated data, so a ciphertext can't be moved to another record | a stolen file is noise |
| Forget for good | **crypto-shredding**: "forget people" destroys that category's key; every record, and every old backup of the file, becomes unreadable at once | the right to erasure that actually works |
| Search without decrypting | tags ("payee:arjun gaddam", "relation:son") stored as HMACs (**blind index**); the Navigator can ask "who is my son?" without the vault ever holding that phrase in clear | no plaintext index to steal |
| Tamper-evident | every read, write, find, forget, export, by which actor, in a **hash chain** (Schneier–Kelsey style); each present record must match its last logged digest; forgotten records must stay gone; planted records show | "someone changed what Kairos believes" is detected, not guessed |
| Rollback-evident | the chain head is **signed with Ed25519** at each checkpoint and mirrored to `vault.head`, which only moves forward; the public key is published (`/api/guardian/pubkey`) so the phone can pin it and verify a checkpoint itself | a restored-from-yesterday database is caught; the phone is a second witness ⚠️ (pinning on the phone is the next step) |
| Least privilege | each agent opens a session with capabilities (`letter-reader`: write/read documents only; `navigator`: read people, money; `guardian`: read all, write canary); refusals are logged too | a hijacked letter reader can't read your payees |
| Rights | export (plain JSON, this computer only), forget one record, forget a category, access log, retention (`expires_at` + sweep) | the person owns it, in practice |

What stays out of the vault: raw letter text (the job keeps facts for an hour, then drops them), message text (the hub
hides it), photos (never stored). Raw events stay in the hub's log; the vault holds the baseline the agents need.

## 4. The Rhythm: "unusual for you"

`guardian/profile.py` builds a baseline from the hub's own events (money.*, hands.task, document.*, notification
counts): per-payee count/median/max/usual hours, the person's active window (5th–95th percentile of activity by local
hour), app habits from the hands' fixed labels, struggles (tasks that failed or needed help), letters by sender,
deadlines, what Kairos refused. It is saved to the vault as derived facts and rebuilt hourly.

`anomaly()` scores a request 0–1 from: first payment to this payee (+0.30), amount vs. the payee's median (+0.25) or the
person's 95th percentile (+0.20), outside the active window (+0.15), the levers in the words (urgency +0.20, authority
+0.15, **secrecy +0.30**, unusual payment method +0.30, remote access +0.30, codes +0.35, fear, reward), situation
(a scam letter read in the last 30 min +0.30, an unknown contact just before +0.25, a screen-sharing app just installed
+0.30, several payments in ten minutes), and the best-matching scam from the catalogue (+0.30 × its score).
Levels: `normal` < 0.30 ≤ `notice` (read it back twice) < 0.55 ≤ `pause` (tell someone; the catalogue's lesson) < 0.80 ≤
`stop` (payments paused; call back on a known number). The words it says are generated from the reasons, in plain English.

The **monthly review** turns the same events into: letters read, payments made and checked, things stopped and the money
kept, phone tasks done, the person's active hours, the task that tripped them up most with a teaching tip, what's due
next month, regular payments Kairos could remind about, and the **time returned** (an estimate, labelled as such: 12 min
a letter, 8 a payment, 4 a phone task). Spoken text, ready for the voice.

## 5. The blue team: agents watching the agents

All deterministic. Each finding is a `guardian.alert` event (plain words, severity `info/notice/high/critical`, evidence
refs, the scopes to lock) written back into the hub as class vault, shown on the phone's Shield and the hub page.

| Watcher | Invariant or check | On failure |
|---|---|---|
| Invariants | `money.sent` only after `money.approved` *and* `money.verified` for the same payment | critical, lock money+hands |
| | `money.approved` only `by: phone` | critical, lock money+hands |
| | approvals never from an agent-trust source | critical |
| | the hands never claim `user_confirmed` without a prior `needs_confirmation` | high, lock hands |
| | the hands never complete a task about a money app | high, lock hands |
| | no agent answer contains a code/PIN/card number | high, lock hands |
| | each writer stays on its rails (hands → hands.*, navigator → money.*, agents → document.*, guardian → guardian.*) | high |
| | a scam-flagged letter, then a payment to a new payee within 30 min | critical, lock money |
| | `anomaly()` says stop / pause on a payment request | high / notice |
| | ≥3 payment requests in 10 min | high, lock money |
| | a device joins while a payment is in flight; joins at night via link/window; keys revealed | high / notice |
| | agent event rate > 120/min | high, lock hands |
| Canaries | a payee ("Marjorie Pentland-Quist") and a contact that exist only as bait, in the vault and the payee book; any payment or task that names them | critical, lock everything |
| Sentinel (in) | instruction-like text, hidden Unicode, encoded blobs, requests for codes or remote access in what an agent reads | flags to the agent; alert |
| Sentinel (out) | an agent's answer may not contain a phone number, link or account the source didn't have, a secret, an instruction, or the word "safe" | high: the explanation is not trusted |
| Second opinion (optional) | a *different* model (local qwen) re-reads facts vs. explanation; may only add a warning | notice |
| Integrity | SHA-256 manifest of `agents/`, `navigator/` (+skills), `hands/`, `phone/`, `hub/`, `guardian/`, the voice server and its prompt, `data/payees.json`; Ed25519-signed by a key derived from the root key; secret files 600, `data/` 700; services up | critical, lock everything until the owner re-seals |
| Vault check | chain, digests, forgotten-stays-gone, checkpoint and head-file agreement | critical, lock everything |
| Heartbeat | `guardian.heartbeat` every minute; the phone shows "protection paused" if it stops (fail-visible) | |

**Lockdown** (`guardian/lockdown.py`) is one small JSON file every process honours: `navigator/policy.py` refuses money
out, `voice/token_server.py` refuses money and hands tasks, the hub exposes it. Only the owner lifts it: the phone (phone
key + Face ID → `POST /voice/guardian/unlock`), an admin device on the hub (`POST /api/guardian/unlock`), or the CLI on
the Mac. A lockdown carries its reason in plain words; nothing leaves the person stuck without an explanation.

Why a separate process and a separate device: a fault or compromise in the hub or an agent can't switch the watcher
off from inside, and the Guardian's own writes are limited to `guardian.*` by a capability the hub enforces.

## 6. How the agents' security research shaped it

| Source (see the research doc §3) | Applied as |
|---|---|
| Willison's dual-LLM / lethal trifecta; Meta's Rule of Two | the letter reader (reads untrusted text) and the Navigator (acts) are separate agents; the only bridge is structured facts + the person's Yes; the Sentinel checks the bridge |
| Beurer-Kellner et al. design patterns (action-selector, plan-then-execute, dual LLM, code-then-execute, context-minimisation) | the Navigator runs a fixed skill DSL with `never_tap Confirm` except after approval; models only classify/recover; agents receive the minimum context |
| CaMeL (capabilities on data flow) | vault capabilities per actor; agents write only their own kinds; the Guardian device can write only guardian.* |
| Baker et al.: a weaker model can monitor a stronger one | `Sentinel.second_opinion` uses the small local model to check Gemini's output |
| Schneier–Kelsey secure audit logs; Crosby–Wallach / Certificate Transparency | the vault's hash chain and signed checkpoints; the head file that only moves forward; the phone as an external witness |
| Spitzner / Thinkst honeytokens | canary payee and contact |
| NIST SP 800-57 key hierarchy; AWS envelope encryption; crypto-shredding | root key → per-category data keys → per-record nonces; forget = destroy the key |
| Blind indexes (searchable encryption, pragmatic form) | HMAC tags |
| Akhawe & Felt on warnings | every alert: one exact problem, one concrete step |

## 7. What the person sees

- **The Shield badge** on the Kairos home screen: green *Protected*, amber *Kairos stopped something*, grey *Protection
  off* (the Guardian isn't running or the Mac is unreachable). Tap for the sheet.
- **The Shield sheet**: the headline; if paused, the reason and one big button *Switch Kairos back on* (Face ID); what
  Kairos checked (code sealed, vault adds up, your rhythm: N people you pay over N days, N traps set); what it stopped or
  noticed, newest first, each in one plain sentence; the promise: code decides, no PINs, no acting on words in letters,
  never "safe".
- **The voice**: alerts are class vault, so the ElevenLabs agent speaks them only if the owner allowed vault data on
  that channel; the phone card is the primary path.
- **The hub page** (`/api/guardian/*`): status, alerts, the catalogue, the profile, the monthly review, the vault's stats,
  access log, export and forget, lock and unlock.

## 8. The stage: red team vs. blue team

`python -m guardian attack` (in-process, nothing needed) or `--live` (the running Mac): ten attacks, each printed as
RED TEAM → DEFENCE → LOCKDOWN. The in-process run takes two seconds and is the fallback if the Wi-Fi dies. The live
run forges records with the real hands token, edits `navigator/policy.py` on disk, flips a byte in the real vault,
registers a rogue device, and shows the Guardian catching each within seconds on the phone's Shield.
`python -m guardian attack reset --live` restores every file, unlocks and re-seals.

## 9. Honest limits and next steps

- ❌ The phone doesn't yet pin the vault's public key or countersign checkpoints with its Secure Enclave; the API and
  the pure verification function exist, the Swift side shows the status only.
- ❌ No automatic signal yet for "a remote-access app was just installed" or "a screen share is active" on the iPhone
  (the research says it is the strongest single signal); today it is caught from the words of the request.
- ⚠️ The second-opinion model check is wired but not called by the letter reader yet (it's a one-line call in the
  teammate's pipeline; the Guardian also scans every `document.read` after the fact).
- ⚠️ The teammate's scam classifier is consumed as `document.read.scam_level`; a `threat.verdict` event for calls and
  messages would plug straight into the same context flags.
- A full compromise of the hub computer defeats everything that lives on it; the design's answer is to keep the phone
  a separate witness and to make the person the only approver.
- Time estimates in the monthly review are labelled estimates; nothing claims minutes it can't show.

## 10. Where things are

| | Path |
|---|---|
| Code | `tempo-hub/guardian/` (`vault.py`, `profile.py`, `threats.py`, `watchers.py`, `lockdown.py`, `run.py`, `api.py`, `redteam.py`) |
| Tests (41) | `tempo-hub/tests/test_guardian_*.py` |
| Hub hooks | `hub/db.py` (reserved `guardian.`), `hub/main.py` (capability + mount), `scripts/device_admin.py add-guardian` |
| Agent hooks | `navigator/policy.py` (lockdown), `voice/token_server.py` (lockdown, `/voice/guardian/status`, `/voice/guardian/unlock`) |
| Phone | `tempo-ios/TempoApp/ShieldView.swift`, badge and sheet in `ContentView.swift` |
| Research | `research/Kairos-Guardian-Threats-and-Defence.md` |
| Run | `.venv/bin/python -m guardian run`, `seal`, `verify`, `status`, `review`, `export`, `unlock`, `attack` |
