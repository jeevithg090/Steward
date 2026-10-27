# Plan: Steward on your phone

**Remote control adapted from Happy, and personalised iPhone Shortcuts**

Status: proposal, 27 Oct 2026. Nothing here is built yet. When it is accepted, it replaces the
"mobile apps" line in [PLAN.md §8](../../PLAN.md#8-out-of-scope-for-v01).

Research behind every claim:

- [docs/research/happy.md](../research/happy.md): Happy's architecture, its crypto, what to port and
  what not to.
- [docs/research/shortcuts.md](../research/shortcuts.md): the `.shortcut` format, signing measured
  on macOS 26.6, delivery routes on iOS 26 and 27, and open-source tools.

Neither brief could test on an iPhone. Anything marked **(check on device)** has to pass the
device checks in §10 before we build on it.

---

## 0. The short version

**What we are adding**

1. **Steward on your phone.**
   - See what needs you, answer approvals, chat with Steward and get notified, from anywhere.
   - Steward itself stays on your machine, listening only on 127.0.0.1.
   - We take Happy's design:
     - pair by QR code;
     - encrypt end to end;
     - relay through a server you can host yourself;
     - map permission prompts onto approvals.
   - We port about 2,000 lines of its MIT code, and we do not copy its known weaknesses.
2. **Personalised iPhone Shortcuts, RoutineHub-style.**
   - A Shortcuts page builds shortcuts from the person's profile: their skills, routines, mail,
     brief time and tenant pack.
   - "Add to iPhone" opens the Shortcuts app's **Add Shortcut** sheet with everything already set,
     including the address of their Steward and their device key.
   - Setup is one scan, one tap and one Allow. No typing.

**What we decided, and why**

| Question                           | Decision                                                                                                                                                                          | Why                                                                                                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What comes first?                  | **Phase 0: a devices layer.**                                                                                                                                                     | Today Steward has no tokens: it trusts loopback and its own page. Putting it behind a tunnel as it stands would expose the whole API with no login (§3.1). Both features need devices, so this is the foundation.                                     |
| Shortcuts or app first?            | **Shortcuts first (Phase 1), then the encrypted relay with a PWA (Phase 2), then a native app (Phase 3).**                                                                        | Shortcuts need no App Store, no developer account and no relay. The PWA reuses `apps/web`. Only a native app gets truly zero-setup shortcuts (App Intents) and APNs push, and it costs store review.                                                  |
| Fork Happy's app?                  | **No.** We port its protocol pieces.                                                                                                                                              | The app is about 117k lines of Expo. It is full of Happy's bundle ids, analytics and payments, and it is mid-pivot. The pieces we need are about 2k lines and MIT.                                                                                    |
| Run inside the official Happy app? | **No.**                                                                                                                                                                           | It relays through Happy's servers, its analytics are on by default, and it shows its own generic permission cards. That breaks Steward's no-telemetry and accessibility rules.                                                                        |
| How does a token reach a shortcut? | **One generic signed shortcut plus a one-time pairing code**, handed over by a `shortcuts://run-shortcut` QR code. On a Mac there is also a one-tap personal file signed locally. | Apple's `anyone` signing sends the whole file to Apple, so it must never hold a token. A pairing code keeps the secret off third parties and works when Steward runs on Linux.                                                                        |
| Which shortcut compiler?           | **Our own small TypeScript builder** (MIT), ported from Tempo's `build_shortcut.py`, with Perspective Cuts' `actions.json` as reference data.                                     | Cherri, the only well-maintained one, is GPL-2.0. Every other compiler is stale.                                                                                                                                                                      |
| How does the phone reach Steward?  | **Phase 1:** Tailscale Serve (recommended) or a Cloudflare tunnel, pointed at a **separate device-only port**. **Phase 2:** Steward dials out to its own encrypted relay.         | Shortcuts can't do end-to-end crypto, so they need a direct, authenticated path. The PWA can encrypt, so it gets the relay.                                                                                                                           |
| What can a phone do?               | **A short, closed list.**                                                                                                                                                         | Read the brief, see and answer approvals, chat, start a task or routine, stop a run. Rules, settings, connections, secrets, the shell and the computer stay loopback-only. Payments, signing and credential steps are never answered from a shortcut. |

---

## 1. What we take, from where

| From                                                                              | What                                                                                                                          | Licence        | How                                                                                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [slopus/happy](https://github.com/slopus/happy) (`happy-agent` runtime)           | NaCl box, secretbox and X25519 on `@noble` (`crypto/nobleNaCl.ts`, 90 lines)                                                  | MIT            | Copy as is                                                                                                                                 |
| Happy                                                                             | Payload and wrapped-key format (`crypto/happyEncryption.ts`, 130 lines)                                                       | MIT            | Copy; swap `node:crypto` AES-GCM for WebCrypto so one module runs on the server and in the PWA                                             |
| Happy                                                                             | Key tree (`deriveKey.ts`, 45 lines)                                                                                           | MIT            | Copy; rename the usage strings to `Steward …` so no key domain is shared with Happy                                                        |
| Happy                                                                             | Pairing handshake (`happy-cli/src/ui/auth.ts`, `HappyPairing.ts`) and server routes (`authRoutes.ts`)                         | MIT            | Rewrite with a 2-minute expiry, one-time use, a confirmation code shown on both screens, and per-device keys (fixes Happy's §3 weaknesses) |
| Happy                                                                             | Encrypted RPC manager and reconnect grace (`RpcHandlerManager.ts`, `rpcHandler.ts`)                                           | MIT            | Port onto the relay's WebSocket, with an **allow-list** of methods                                                                         |
| Happy                                                                             | Ordered, duplicate-safe sync (`v3SessionRoutes.ts`, `apiSession.ts`)                                                          | MIT            | Same primitive for a sealed AG-UI event log per thread: `localId` dedupe and `after_seq` catch-up                                          |
| Happy                                                                             | Presence-aware push with outcomes (`push/*`)                                                                                  | MIT            | Swap Expo push for Web Push (VAPID). Keep "don't notify if a client is visibly open". Send **sealed** bodies                               |
| Happy                                                                             | Recovery-key format (`secretKeyBackup.ts`)                                                                                    | MIT            | Copy, for "save your recovery key"                                                                                                         |
| Tempo (`apps/shortcuts/build_shortcut.py`)                                        | The plist builder: `act()`, text and attachment tokens, if/otherwise, variables, notify; the `shortcuts sign` call with retry | Ours           | Port to TypeScript in `packages/shortcuts`                                                                                                 |
| [taylorarndt/perspective-cuts](https://github.com/taylorarndt/perspective-cuts)   | `actions.json`: 180+ action identifiers including iOS 26                                                                      | MIT            | Reference data for checking our templates                                                                                                  |
| [electrikmilk/preview-shortcut](https://github.com/electrikmilk/preview-shortcut) | Renders a shortcut's actions as a picture                                                                                     | MIT            | Shows "what you're about to install" on the Shortcuts page                                                                                 |
| [0xilis/libshortcutsign](https://github.com/0xilis/libshortcutsign)               | `extract` and `verify` for signed files                                                                                       | MIT            | CI only: check signed output on Linux. Never its key-dump signing                                                                          |
| RoutineHub                                                                        | The update-checker pattern (version manifest, notes, re-import)                                                               | (pattern only) | Re-implemented against Steward's own manifest. No RoutineHub infrastructure                                                                |

**Not taken:**

- From Happy:
  - its app sync engine (about 6.7k lines);
  - the Prisma/Postgres server;
  - the Claude, Codex and Gemini runners;
  - remote `bash` and `writeFile`;
  - voice that can approve;
  - analytics and payments;
  - the `happy-server` legacy repo, which has no licence;
  - the "Happy" name, logo and `happy://` scheme, which are trademarks not covered by MIT. We use `steward://`.
- Cherri (GPL-2.0).
- shortcuts-js and Open-Jellycore (GPL-3.0).
- HubSign and Shortcuty, third-party signers that receive the file.

**NOTICE additions:**

- "Copyright (c) 2026 Happy Coder Contributors"
- "Copyright (c) 2024 Happy Coder Contributors"
- "Copyright (c) 2026 rig Contributors"
- Perspective Cuts' and preview-shortcut's copyright lines.

Every ported file gets an "Adapted from …" header, as today.

---

## 2. How it fits together

```
            iPhone                                          Your Mac (or Linux box)
 ┌───────────────────────────┐                      ┌──────────────────────────────────────┐
 │ Shortcuts app             │ HTTPS + device token │ Device listener 127.0.0.1:8788       │
 │  "Steward" (thin client)  │ ───────────────────► │  /device/* only, bearer-scoped       │
 │  launchers, automations   │  via Tailscale Serve │        │                             │
 ├───────────────────────────┤  or Cloudflare+Access│        ▼                             │
 │ Steward PWA (Phase 2)     │                      │ Steward core 127.0.0.1:8787          │
 │  Today · Needs you · Chat │◄──── sealed ────┐    │  gateway → record → act              │
 │  service worker, push     │   envelopes     │    │  runner, approvals, brief, tasks     │
 ├───────────────────────────┤                 │    │        ▲                             │
 │ Native app (Phase 3)      │            ┌────┴───┐│ Bridge (Phase 2): dials OUT over WSS │
 │  App Intents, APNs        │◄──────────►│ Relay  │◄──── seals AG-UI and live events      │
 └───────────────────────────┘            │(you host)  never sees plaintext                │
                                          └────────┘└──────────────────────────────────────┘
```

**Two paths, on purpose.**

- **Shortcuts (Phase 1)** use plain HTTPS to the device listener. Shortcuts cannot do NaCl crypto.
  Their requests are protected by TLS and a scoped, revocable token, and they never pass through a
  relay we don't control.
- **The PWA and the app (Phases 2 and 3)** use the relay with end-to-end encryption, so the relay
  sees only ciphertext.

The device API (§3.3) is shared by all three, so the phone surfaces never drift apart.

---

## 3. Phase 0: devices (the foundation)

### 3.1 The problem it fixes

`originGuard` (`apps/server/src/http/security.ts`) lets through mutating requests that have no
`Origin` header, because they come from programs on this machine. `hostGuard` accepts any name in
`STEWARD_ALLOWED_HOSTS`.

So pointing a tunnel at 8787 and adding its host to that list, as `docs/security.md` suggests for a
VPN, would let anyone on the internet drive `/api/*`. That covers approvals, chat and the computer,
with no login.

The phone features must never use 8787, and that docs advice has to change.

### 3.2 What we build

1. **A device listener.**
   - A second Hono app on `127.0.0.1:${STEWARD_DEVICE_PORT:-8788}`, with its own Host allow-list.
   - It mounts **only** `/device/*`.
   - Every route needs `Authorization: Bearer <device token>`, except the pairing exchange and the
     public download of the generic shortcut.
   - The device listener and the core share one process and one database. 8787 is unchanged.
2. **Devices and pairing codes** in SQLite, owned by `apps/server`:
   - `devices(id, name, kind 'shortcut'|'pwa'|'app', token_hash, scopes_json, created_at, last_seen_at, revoked_at, public_key)`;
   - `pairing_codes(code_hash, kind, expires_at, attempts, consumed_at)`.
   - Tokens are 256-bit random values, stored hashed (SHA-256), and shown once, only inside the
     pairing exchange.
   - Codes are 8 characters, last 10 minutes, are single-use and allow 5 attempts.
   - Everything is rate-limited and recorded.
3. **Scopes:**
   - `brief:read`
   - `approvals:read`
   - `approvals:decide`
   - `chat`
   - `tasks`
   - `routines:run`

   The defaults for a shortcut are all of them except `approvals:decide`. The person turns that one
   on per device, with the plain warning "This phone can say yes to things Steward asks about".
4. **The gateway knows who answered.**
   - The audit row for an approval decision gets `detail.via = "device:<id>"`, and the record shows
     "Answered from iPhone (Shortcuts)".
   - Runs started from a device carry `initiator: { kind: "device", id }`.
   - `Initiator.kind` gains `"device"`, and new presets use it.
5. **Two new presets, which can't be switched off:**
   - "From a phone, payments, signing and passwords are finished on your Mac."
     - A device decision on an approval whose kind is `pay` or `sign`, or which is credential
       entry, is refused.
     - The phone shows "Open Steward on your Mac to finish this".
   - "From a shortcut, a send or delete after reading untrusted content is finished in the app."
     - It refuses `approvals:decide` from a `shortcut` device on a tainted `send`, `delete` or
       `shell` call.
     - The PWA and the app may decide those after WebAuthn user verification (§5.4).
6. **Settings → Phone** in the web app:
   - add a phone (QR codes);
   - list paired devices, with last seen, scopes and Revoke;
   - set up the connection (§4.6).
7. **Docs.** `docs/security.md` gets the device listener and the "never tunnel 8787" rule.
   `STEWARD_ALLOWED_HOSTS` keeps working for VPN setups. When it is set while no device listener
   is in use, the server warns at start.

### 3.3 The device API (shared by Shortcuts, the PWA and the app)

Shortcuts can't read SSE or AG-UI streams, so every route returns finished JSON. Every call goes
through `@steward/gateway` like any other caller.

| Route                                                      | Scope                 | Returns                                                                                                                  |
| ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /device/pair` `{code, deviceName, kind, publicKey?}` | code                  | `{token, deviceId, scopes, minShortcutVersion}`                                                                          |
| `GET /device/home`                                         | any                   | Server-driven UI for the main menu, built from the person's profile (§4.3)                                               |
| `GET /device/brief`                                        | `brief:read`          | `{say (≤300 chars), items[]}`                                                                                            |
| `GET /device/approvals?status=pending`                     | `approvals:read`      | Items with a plain summary, plus `canDecideHere` and a reason when it is false                                           |
| `POST /device/approvals/:id/decision` `{answer}`           | `approvals:decide`    | The same handler as the web card: digest check, claim-once, resume sweep                                                 |
| `POST /device/say` `{text, skill?, threadId?}`             | `chat`                | Runs through the existing runner and waits up to about 20 s. Returns `{say, ui[], threadId}` or `{pending:true, taskId}` |
| `POST /device/run/:actionId`                               | depends on the action | Runs a catalogue action, such as a routine now or a skill (§4.3)                                                         |
| `GET /device/manifest`                                     | any                   | `{version, minVersion, url, notes}` for updates                                                                          |

**Server-driven UI.**

- Responses carry a fixed vocabulary that the shortcut interprets:
  - `say`
  - `show`
  - `choose` (each option has a label, a route and a body)
  - `ask` (a prompt, plus where to post the answer)
  - `open` (a URL)
- New features ship as server responses, not as new shortcut files.

**Versions.** Every request sends `X-Steward-Shortcut: <id>@<version>`. Below `minVersion` the
server answers `426` with the update notes and the download URL.

### 3.4 Done when

- A device token can call `/device/*` through the device port, and nothing on 8787.
- A revoked token is refused within one request.
- An approval answered from a device is recorded with `via` and resumes exactly as a web answer
  does.
- The new presets refuse pay, sign and credential decisions from devices.
- Tests cover all of it, including a tunnel-shaped request to 8787 being refused.

---

## 4. Phase 1: personalised iPhone Shortcuts

### 4.1 What the person sees

**Settings → Phone → Add iPhone** (or the new **Shortcuts** page) shows:

1. **"Get the Steward shortcut"**: a QR code to the signed file, or a button when the page is open
   on the phone. Safari downloads it and the Shortcuts app shows **Add Shortcut**.
2. **"Pair it"**: a second QR code that opens
   `shortcuts://run-shortcut?name=Steward&input=text&text=steward-pair:1:<payload>`.
   - The payload is `base64url({"u":"https://<device host>","c":"<code>","n":"<machine name>"})`.
   - The shortcut asks **"Pair with Steward on <name> at <host>?"**. On Pair, it trades the code
     for a token and stores it.
   - The token goes in **Shortcuts Storage** (global key `steward.device`) on iOS 27. On iOS 26 it
     goes in `iCloud Drive/Shortcuts/Steward/device.json`.
3. The Mac's card turns green: "iPhone paired. Try: 'Hey Siri, Steward'."

That is one scan, one tap, one Allow (the first network request to a new host) and one confirm.
The person never types an address or a key.

**One-tap personal file (Mac only).** Steward builds a copy with `{url, token}` inside and signs it
locally in `people-who-know-me` mode. That takes about 60 ms, and nothing is sent to Apple. It is
served once from a 10-minute link, for one scan and one tap.

- **(Check on device):** does your own iPhone import it with Private Sharing off? If not, this
  becomes an advanced option.

**What iOS allows.** iOS imports **one shortcut per Add Shortcut tap**; there is no bulk import.
So "all your shortcuts at once" means:

- **One "Steward" shortcut** whose menu is built from your profile on every run (§4.3). New skills
  and routines appear in it with no re-import.
- **Optional launchers**, one tap each: tiny shortcuts like "Steward: What needs me?" that call the
  main one with an action id. They exist so Siri phrases, the Action button and the Home Screen can
  reach one action directly.
- **iOS 27 embedded automations** (for example "Weekdays 08:00 → brief"). They arrive inside the
  shortcut, switched off behind one toggle.
- In **Phase 3** the native app gets up to 10 App Shortcuts that appear with no tap at all.

### 4.2 The generic "Steward" shortcut (a thin client)

The shortcut contains no secret and no personal data, so it can be `anyone`-signed once per
release by a maintainer, and it works on every host.

**Flow:**

1. Read input.
   - `steward-pair:` text means pairing.
   - Shared text or URLs from the share sheet mean "Check this".
   - `action:<id>` comes from a launcher.
   - No input means the home menu.
2. Load `{u, token}` from storage. If it is missing, show "Pair me from Settings → Phone on your
   Mac" and open the help URL.
3. Call `GET {u}/device/home`, or the route the input names.
4. Interpret the UI vocabulary: Speak or Show Result, Choose from Menu → post, Ask for Input → post,
   Open URL.
5. Read replies aloud when the person's profile has Read aloud on.
6. Check the version: on `426`, show the notes and open the update URL.

Logic and wording live on the server, so the shortcut seldom needs updating.

### 4.3 The catalogue: "based on their profile"

`buildCatalogue(profile)` lives in a new `packages/phone`. It returns the actions this person should
have, and the same list drives `/device/home`, the launchers and the Shortcuts page.

| Profile signal               | Action                                                                  | Launcher name and Siri phrase      |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| Always                       | Ask Steward (dictate or type → `/device/say`, reply spoken)             | "Steward"                          |
| Always                       | What needs me? (`/device/brief`)                                        | "Steward: What needs me?"          |
| Always                       | Needs you: pending approvals (choose, then answer, within scope)        | "Steward: Needs you"               |
| Mail connected               | Check this message: share sheet text or URL, triaged and checked        | Share sheet: "Check with Steward"  |
| Each skill (`/skills`)       | Run the skill with dictated input                                       | "Steward: <skill name>"            |
| Each routine                 | Run now                                                                 | "Steward: <routine title>"         |
| `briefTime` set              | Embedded automation, "Weekdays <time> → brief", switched off            | (inside the main shortcut, iOS 27) |
| Read aloud on                | All replies spoken                                                      | —                                  |
| Plain language on            | Server replies already plain                                            | —                                  |
| Tenant pack `shortcuts.yaml` | The tenant's own shortcuts, e.g. Tempo's Delay Spotter and Scam Spotter | As declared                        |

**Tenant packs** declare shortcuts the same way they declare skills:
`tenants/<id>/shortcuts.yaml` holds names, descriptions, the action id or template, and the Siri
phrase. This is how Tempo's two existing shortcuts become catalogue entries, which keeps "make it
your own" working.

**Later, after Phase 1:** "Make me a shortcut that …" in chat. A `shortcut_create` tool composes a
new catalogue entry from the **fixed template vocabulary**, never from arbitrary actions, and the
gateway treats it as a `write` that asks.

### 4.4 The Shortcuts page (our RoutineHub)

The new route is `/shortcuts`. It shows:

- **Suggested for you**: catalogue cards with a preview (preview-shortcut), what the shortcut
  reaches, its scopes, and **Add to iPhone**;
- **Installed**: from devices' `X-Steward-Shortcut` headers, with version and last used;
- **Updates**: when the installed version is below the manifest's;
- **From your setup**: the tenant pack's shortcuts.

Accessibility is the same as the rest of Steward: every QR code has a button and a copyable link
next to it, and every step is announced.

### 4.5 The builder: `packages/shortcuts` (new, MIT)

1. **Templates.**
   - Build the reference shortcut once by hand in Shortcuts.app on macOS 26 or 27.
   - Export it and unpack it (`aea` and `aa`).
   - Commit the action fragments under `packages/shortcuts/templates/`.
   - Check the parameter keys against Perspective Cuts' `actions.json`.
   - Action identifiers change between iOS versions, so templates are re-exported per release, not
     typed from memory.
2. **The builder** is a TypeScript port of Tempo's `build_shortcut.py`:
   - `buildWorkflow(entry, opts)` produces an XML plist;
   - `validate()` parses it back, because `shortcuts sign` crashes on bad input.
3. **Signing.** `sign(plist, mode)`:
   - On darwin it runs `execFile("shortcuts", ["sign", "--mode", mode, "--input", …, "--output", …])`
     with a 30 s timeout and three retries, because a transient CloudKit error came back about once
     in seven runs.
   - It checks the `AEA1` magic bytes.
   - It never logs the plist.
   - Elsewhere it returns `null`, and the server serves the shipped generic file.
4. **Modes.**
   - `anyone` only for the generic file and for launchers with no personal data. This is a
     maintainer step at release time, because CI has no iCloud.
   - `people-who-know-me` for anything personal, made on the person's own Mac at request time.
5. **Serving.**
   - `application/octet-stream` with `Content-Disposition: attachment; filename="Steward.shortcut"`.
   - Personal files: `Cache-Control: no-store`, 128-bit one-time ids, 10-minute expiry.
6. **CI.**
   - Plist round trips and template checks on any OS.
   - `libshortcutsign verify` on the shipped signed file.
   - On a macOS runner without iCloud, a test that the "must be signed into iCloud" error is
     reported in plain words.

### 4.6 Reaching the device listener

The connection steps on Settings → Phone, in order of preference:

| Transport                                          | Phone URL                               | When                                                                                               |
| -------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Tailscale Serve** (tailnet only)                 | `https://<mac>.<tailnet>.ts.net` → 8788 | Recommended: nothing public, real HTTPS                                                            |
| **Cloudflare named tunnel + Access service token** | `https://steward.<your domain>`         | A stable public URL. The Access headers are a second credential, delivered in the pairing response |
| Same Wi-Fi                                         | `http://<mac>.local:8788`               | Home only. Plain HTTP with a warning, and the iOS Local Network prompt                             |
| Cloudflare quick tunnel                            | `https://<random>.trycloudflare.com`    | Demos only. The URL changes every run, so you re-pair                                              |

Steward detects `tailscale` and `cloudflared` on PATH and prints the exact command. It never
starts a public tunnel by itself.

### 4.7 Done when

- On a real iPhone (iOS 26 and iOS 27):
  - scan, Add Shortcut, pair, then "Hey Siri, Steward, what needs me?" reads the brief;
  - a pending email approval can be refused from the shortcut, and allowed when the device has
    `approvals:decide`;
  - a payment approval says "finish on your Mac";
  - a new skill appears in the menu with no re-import;
  - a version bump offers the update and keeps the pairing.
- The Shortcuts page shows the installed shortcut and its version.
- Every device check in §10.2 is recorded with its result.

---

## 5. Phase 2: Steward Mobile (the Happy-derived part)

### 5.1 Shape

**New packages:**

- `packages/remote`: crypto, envelopes and pairing, ported from Happy. It runs in Node and in the
  browser.
- `apps/relay`: Hono, `ws` and `node:sqlite`, one small binary, about 1.5k lines. You can host it
  on a VPS, on Fly or in a container. It serves the PWA's static files and ciphertext, nothing
  else.

**In `apps/server`:** a **bridge** that dials out over WSS to the relay. It subscribes to the
runner's AG-UI events and to live events, seals an allow-listed subset per thread, and answers
sealed RPCs by calling the device API's handlers in-process.

**In `apps/web`:** a **PWA** mobile build (manifest, service worker, Web Push) with Today, Needs
you, Chat and Tasks. It reuses the existing components and accessibility work.

### 5.2 Pairing (Happy's design, fixed)

1. Settings → Phone → **Add phone (app)** shows the QR code
   `steward://pair?k=<one-time public key>&r=<relay url>&c=<6-digit code>`.
2. The PWA makes a **per-device** keypair. It uses WebCrypto, non-extractable keys, kept in
   IndexedDB (never `localStorage`, which is Happy's weakness). It seals its public key to the
   one-time key.
3. The desktop shows **"Pair 'iPhone 17'? Code 482-913"**. The person confirms on the Mac.
4. The desktop seals the data key to the device key.

Pairing requests expire after 2 minutes and are used once. Tokens are per device and revocable.
There is no handover of a master secret, and a recovery key is offered.

### 5.3 Data plane

- **Events.** Sealed, `seq`-numbered envelopes per thread, with `localId` dedupe and `after_seq`
  catch-up (Happy's v3 primitive). They carry **AG-UI events** as they are, so the PWA reuses the
  web chat's renderers.
- **RPC, closed list:**
  - `approval.decide`
  - `chat.send`
  - `task.start`
  - `task.hide`
  - `routine.run`
  - `run.stop`
  - `brief.get`
- **Never remote-callable:** rules, settings, connections, secrets, shell, computer input.
- **Reconnects.** Happy's 15 s reconnect grace, 30 s timeout and fast fail.

### 5.4 Approvals from the phone

- The PWA **signs** `{approvalId, answer, nonce, ts}` with its device key. The server checks the
  signature, the nonce and the time window. It then calls the same decision handler as the web
  card.
- For kinds the safety floor protects (pay, sign, credential entry), the person must still finish
  on the Mac in Phase 2.
- For tainted `send`, `delete` and `shell`, the PWA requires **WebAuthn user verification** (Face
  ID) before it signs.
- The record says "Answered from <device> (Face ID checked)".
- Voice never approves. That is a Happy pattern we reject.

### 5.5 Push

- Web Push (VAPID) goes to the PWA's subscription.
- **Steward seals the notification body** with the device key, so the relay and Apple or Google see
  an opaque blob and a level.
- The service worker decrypts it ("Steward wants to send an email to sam@…").
- Tapping a notification opens the approval card. iOS action buttons on PWA notifications need a
  check on a device.
- We keep Happy's rule of not notifying while a client is visibly open, and its delivery outcomes.
- iOS delivers Web Push only to PWAs installed on the home screen (iOS 16.4 and later), so the
  install step is part of the flow.

### 5.6 Done when

- The relay can be self-hosted with one command, and its logs and database hold no plaintext. A
  test greps a captured session for known strings.
- On a phone:
  - pairing with a code;
  - live chat while Steward works;
  - an approval answered with Face ID, then resumed and recorded;
  - a sealed push that reads correctly;
  - revocation that takes effect at once.

---

## 6. Phase 3: native app (Expo) with App Intents

Only if the PWA's iOS limits block us, or once Phase 2 is stable.

- **A fresh Expo app** (`apps/mobile`, SDK 58 or later). It is **not** a fork of happy-app. It reuses
  `packages/remote` and the device API.
- **`expo-app-intents`** (official, MIT, alpha), or `@bacons/apple-targets`, for an
  `AppShortcutsProvider`. Up to 10 App Shortcuts appear in Shortcuts, Siri, Spotlight and the
  Action button **the moment the app is installed**, with credentials in the Keychain. This is the
  only truly zero-setup route.
- **APNs** push with actionable notifications, sealed bodies, and a Notification Service Extension
  to decrypt them.
- **Control Center and Lock Screen controls** ("Needs you" count, "Ask Steward").
- **Costs:**
  - an Apple Developer account and a Google Play account;
  - TestFlight and store review;
  - account deletion (App Store 5.1.1(v));
  - export-compliance answers for end-to-end encryption;
  - privacy labels.
- The catalogue (§4.3) decides which 10 App Shortcuts to offer, so "based on their profile" carries
  over.

---

## 7. Security model

| Threat                                             | Mitigation                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A tunnel exposes the core API                      | Phones only reach the device port (8788). 8787 refuses non-loopback Hosts unless explicitly allowed, and the server warns. A test covers a tunnel-shaped request.                                                           |
| A token leaks through Apple or iCloud              | Tokens never go in `anyone`-signed files. Personal files are signed locally in `people-who-know-me` mode and served once.                                                                                                   |
| A hostile web page triggers `run-shortcut` pairing | The shortcut shows the host and machine name and needs a tap. It accepts only `steward-pair:` with `u`, `c` and `n`. Codes are single-use and short-lived. Plain `http` is accepted only for private hosts, with a warning. |
| A stolen phone                                     | Revocation in Settings → Phone. Scopes are narrow and `approvals:decide` is off by default. Floor kinds are never decided from a phone. The PWA uses WebAuthn for tainted sends.                                            |
| Replayed approvals                                 | Signed, nonce'd, time-boxed decisions (PWA). Claim-once in the gateway. The digest check is unchanged.                                                                                                                      |
| A curious relay operator                           | End-to-end encryption, and the relay stores ciphertext and ids only. What it still sees is listed in Settings: ids, timing, IP addresses, sizes and RPC method names.                                                       |
| Push content leaking                               | Push bodies are sealed. Steward never sends plaintext through Apple, Google or the relay.                                                                                                                                   |
| A shortcut's own data at rest                      | The token sits in Shortcuts Storage or iCloud Drive and is readable by the person's other shortcuts. This is documented. The token is revocable and can only call `/device/*`.                                              |
| Old weaknesses copied from Happy                   | §1 "not taken", plus review gates: no remote shell, no phone-set permission modes, no secret in `localStorage`.                                                                                                             |

Every device action is recorded in the hash-chained record with `via`, and runs through the gateway
like every other call.

---

## 8. Contracts to add (`packages/shared`)

```ts
// governance.ts
type InitiatorKind = "person" | "routine" | "task" | "resume" | "system" | "device";

// devices.ts (new)
type DeviceKind = "shortcut" | "pwa" | "app";
type DeviceScope = "brief:read" | "approvals:read" | "approvals:decide" | "chat" | "tasks" | "routines:run";
interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  scopes: DeviceScope[];
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  shortcutVersion?: string;
}
interface PairingOffer {
  code: string;
  expiresAt: string;
  qrText: string;
  shortcutUrl: string;
}

// phone.ts (new): the server-driven UI vocabulary and the catalogue
type DeviceUi =
  | { say: string }
  | { show: { title: string; body: string } }
  | { choose: { title: string; options: { label: string; post: string; body?: unknown }[] } }
  | { ask: { prompt: string; post: string; field: string } }
  | { open: string };
interface CatalogueEntry {
  id: string;
  title: string;
  description: string;
  siriPhrase?: string;
  action: { kind: "say" | "brief" | "approvals" | "check" | "skill" | "routine" | "tenant"; ref?: string };
  scopes: DeviceScope[];
  source: "core" | "skill" | "routine" | "tenant";
}

// api.ts: new loopback routes for the web app
//   GET /api/devices · DELETE /api/devices/:id · PATCH /api/devices/:id {scopes}
//   POST /api/devices/pairing {kind} → PairingOffer
//   GET /api/phone/catalogue → CatalogueEntry[] · GET /api/phone/shortcuts/:id/install → one-time link
```

---

## 9. Work breakdown

Each track owns its directories, as in the v0.1 build, so tracks can run in parallel within a
phase.

| Phase | Track                    | Owns                                                                                                           | Done when                                                                                | Size          |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- |
| 0     | Devices                  | `apps/server/src/device/**`, server migrations for devices and pairing codes, `packages/shared/src/devices.ts` | §3.4                                                                                     | ~1.2k         |
| 0     | Gateway                  | `packages/gateway` (initiator `device`, the two presets, `via` in records)                                     | Presets refuse floor decisions from devices; tests                                       | ~300          |
| 0     | Web: Phone settings      | `apps/web/src/pages/settings/phone/**`                                                                         | Pair, list, revoke, scopes; accessible QR alternatives                                   | ~600          |
| 1     | Builder                  | `packages/shortcuts/**` (templates, builder, validate, sign, serve)                                            | Round-trip tests; a signed generic file; local `people-who-know-me` signing on darwin    | ~1k           |
| 1     | Catalogue and device API | `packages/phone/**`, `apps/server/src/device/routes/**`                                                        | `/device/home`, `brief`, `approvals`, `say`, `run` and `manifest`, with server-driven UI | ~1k           |
| 1     | Web: Shortcuts page      | `apps/web/src/pages/ShortcutsPage.tsx`, cards, preview                                                         | Suggested, installed, updates, tenant                                                    | ~700          |
| 1     | Tenant packs and docs    | `tenants/*/shortcuts.yaml`, `docs/phone.md`, the `security.md` update                                          | Tempo's two shortcuts listed; setup guide per transport                                  | ~400          |
| 1     | Device test              | the device checklist (§10.2)                                                                                   | Every check recorded with screenshots                                                    | —             |
| 2     | Remote crypto            | `packages/remote/**` (ported)                                                                                  | Cross-runtime tests, Node ↔ browser, with Happy's test vectors                           | ~700          |
| 2     | Relay                    | `apps/relay/**`                                                                                                | Self-host in one command; plaintext-free storage test                                    | ~1.5k         |
| 2     | Bridge                   | `apps/server/src/remote/**`                                                                                    | Sealed events, RPC allow-list, signed approvals                                          | ~600          |
| 2     | PWA                      | `apps/web` mobile build, service worker, push                                                                  | §5.6 on a device                                                                         | ~1.5k         |
| 3     | Native app               | `apps/mobile/**`                                                                                               | App Shortcuts, APNs, TestFlight build                                                    | (sized later) |

**Order.**

- Phase 0 must merge first.
- Phase 1's builder track can start in parallel, because it doesn't touch the server.
- **Start with a one-day device spike:** the eight checks in §10.2, before writing the builder. The
  answers decide Flow B and the update behaviour.

---

## 10. Verification

### 10.1 Automated

- **Unit tests:**
  - token hashing and scopes;
  - pairing expiry, attempts and one-time use;
  - device presets;
  - catalogue from profile fixtures;
  - plist round trip and template checks;
  - sealed-envelope and RPC allow-list tests;
  - crypto vectors.
- **Integration tests:**
  - the device listener refuses everything without a token;
  - 8787 refuses a tunnel-shaped request;
  - a device-answered approval resumes and is recorded with `via`;
  - a relay capture contains no plaintext.
- **e2e (Playwright):**
  - Settings → Phone shows QR codes with button alternatives, and pairing via the API turns the
    card green;
  - the Shortcuts page lists the catalogue;
  - an axe audit of both pages.

### 10.2 On a real iPhone (needed; the Simulator is not enough)

From [the Shortcuts brief, §6.8](../research/shortcuts.md):

1. Safari download of a signed file: how many taps to Add Shortcut, on iOS 26 and 27.
2. Does a `people-who-know-me` file signed on the person's Mac import with Private Sharing off?
3. The `run-shortcut` link from a QR code and from Safari: what prompt appears, how long `text` can
   be, and what happens when the shortcut is missing.
4. The first `Get Contents of URL` to a new host: what prompt appears, and does "Always Allow"
   survive an update?
5. Re-importing a shortcut with the same name: does it replace or duplicate?
6. Global Shortcuts Storage on iOS 27: is it visible to other shortcuts, does it sync, and does it
   survive a re-import?
7. An automation embedded in a shortcut on iOS 27: how it is encoded (export one).
8. Does a file signed with an expired `anyone` certificate still import?

For Phase 2, add:

9. Web Push on a home-screen PWA: delivery, badges and action buttons.
10. WebAuthn user verification inside the installed PWA.

**We need someone with an iPhone on iOS 26 and on iOS 27 for these.** Tempo's shortcuts were
never imported on a device for the same reason, so book this first.

---

## 11. Risks and open questions

- **Apple keeps changing Shortcuts.** Action identifiers shift between releases. Mitigations:
  templates exported per release, a CI round trip, and a thin client so most changes are
  server-side.
- **The certificate on the generic signed file lasts about 12.7 months.** The release checklist
  re-signs it every release and at least every 6 months.
- **`anyone` signing needs a maintainer's iCloud session**, so it can't run in CI. This is a
  documented release step.
- **A Linux host can't sign**, so it ships the pre-signed generic file and uses pairing only. That
  is fine because Flow A needs no signing.
- **Private Sharing (check 2)** may make the one-tap personal file awkward. Pairing is the default
  either way.
- **The relay is a service someone has to run.** It is self-hosted by default. Do we also offer a
  hosted one? That is a product decision for the team. If so, it needs abuse limits and a privacy
  page.
- **PWA limits on iOS** (push only when installed; notification actions unverified) may push us to
  Phase 3 earlier.
- **Scope creep.** "Make me a shortcut" from chat stays within the fixed template vocabulary.
  Arbitrary actions are not offered, because the gateway can't judge what a hand-built shortcut
  does on the phone.

---

## 12. Sources

- Research briefs: [docs/research/happy.md](../research/happy.md) and
  [docs/research/shortcuts.md](../research/shortcuts.md). They have full source lists,
  including file paths in Happy and Apple's docs.
- Happy: <https://github.com/slopus/happy> (MIT).
- RoutineHub: <https://routinehub.co>.
- Apple:
  - [Shortcuts URL schemes](https://support.apple.com/guide/shortcuts/apd624386f42/ios)
  - [App Shortcuts](https://developer.apple.com/documentation/appintents/app-shortcuts)
  - [New in iOS 27](https://support.apple.com/en-us/149045)
- Expo: [expo-app-intents](https://docs.expo.dev/versions/latest/sdk/app-intents/).
- Tools:
  - [Perspective Cuts](https://github.com/taylorarndt/perspective-cuts)
  - [preview-shortcut](https://github.com/electrikmilk/preview-shortcut)
  - [libshortcutsign](https://github.com/0xilis/libshortcutsign)
  - [Cherri](https://github.com/electrikmilk/cherri), GPL, for reference only.
