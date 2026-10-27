# Happy (slopus/happy): research brief for Steward's mobile story

Prepared 27 Oct 2026 for Steward (PLAN.md §2–§5).
All paths below are relative to the clone root they name. The clones are read-only and untrusted.
Nothing in them was installed, built or run. Anything not confirmed in source is marked **UNVERIFIED**.

| Clone (scratchpad `src/…`) | Upstream                        | HEAD (shallow)                                                     | Licence file                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `happy/`                   | github.com/slopus/happy         | `e589a1a` 2026-10-27 "Release Happy CLI v1.2.6"                    | `LICENSE`: MIT, "Copyright (c) 2026 Happy Coder Contributors". `packages/happy-app/LICENSE`: MIT, "(c) 2024 Happy Coder Contributors". `packages/expo-tailcat/LICENSE`: MIT, plus `THIRD_PARTY_NOTICES.md` (Go deps: BSD-3 Tailscale/tailcat, Apache-2.0 gVisor and others). The other packages have no LICENSE file of their own, so the root MIT covers them, and their `package.json` files say `"license": "MIT"`. |
| `happy-agent-runtime/`     | github.com/slopus/happy-agent   | `8e7693e` 2026-10-27                                               | `LICENSE`: MIT, "(c) 2026 rig Contributors"                                                                                                                                                                                                                                                                                                                                                                            |
| `happy-desktop/`           | github.com/slopus/happy-desktop | `59d826d` 2026-10-27                                               | `LICENSE`: MIT, "(c) 2026 Happy (2) Contributors"                                                                                                                                                                                                                                                                                                                                                                      |
| `happy-server-legacy/`     | github.com/slopus/happy-server  | `922a62f` 2026-02-13 (stale; the server now lives in the monorepo) | **No LICENSE file**.`package.json` says MIT. Do not copy from it. Use `happy/packages/happy-server` instead.                                                                                                                                                                                                                                                                                                           |

---

## 0. The short version

1. Happy has three parts. A **phone/web app** (Expo SDK 55 / React Native 0.83.1) talks to a **zero-knowledge relay** (Fastify 5 + Socket.IO 4.8 + Prisma/Postgres, or PGlite for self-host). A **desktop CLI/daemon** (`happy`, Node) wraps Claude Code, Codex and others. The relay stores only ciphertext, ids, sequence numbers and timing.
2. **Pairing** works through a QR code. The desktop makes an ephemeral X25519 box keypair and shows `happy://terminal?<base64url pubkey>`. The phone scans it and encrypts its answer to that key. The relay only passes along the sealed bundle and issues a bearer token.
3. **Encryption** is NaCl box/secretbox (tweetnacl on Node, libsodium on device), plus per-session AES-256-GCM data keys. Each data key is wrapped to an account "content" public key, which is derived from a 32-byte master secret held only on the phone.
4. **Claude Code permission prompts** are caught through the Agent SDK `canUseTool` callback. They are published as encrypted `agentState.requests` and answered by an encrypted `permission` RPC from the phone. This is structurally the same as Steward's parked approval followed by `POST /api/approvals/:id/decision`.
5. **Push** goes CLI → `POST /v1/sessions/:id/push-event` → relay → Expo push (`exp.host`) → APNs/FCM. The title, body (session summary or folder name) and tool name travel **in plaintext**. This contradicts `PRIVACY.md`, which says push is device-to-device.
6. **Voice** is ElevenLabs Conversational AI, with a WebRTC/LiveKit SDK on native and a WebSocket SDK on web. It is gated by RevenueCat and the relay. The voice LLM can **approve permissions** via a client tool.
7. **Worth porting:** the crypto formats and key tree (~500 lines), the pairing handshake (~400), encrypted RPC over the relay (~400), seq-ordered idempotent message sync (~350) and presence-aware push dispatch (~230). Happy Agent's `happy` module is the cleanest daemon-side reference: pure `@noble`, two-minute pairing TTL, and an outbox.
8. **Not worth porting:** the app sync engine (`sync.ts`/`storage.ts`/`ops.ts`, about 6.7k lines), the Prisma server, the Claude/Codex runners, the remote `bash`/`writeFile` RPCs, the voice stack, and the social, GitHub and RevenueCat code.
9. **Recommendation:** give Steward an **E2E-encrypted outbound relay** borrowed from Happy's design, with no inbound port, so loopback stays loopback. Add an **installable PWA** built from `apps/web` components, with **Web Push carrying E2E-sealed payloads**. Answers from the phone go to the existing decision endpoint through the gateway, and each one is signed per device and recorded in the hash chain. Defer a native Expo fork. Running Steward as a "Happy-compatible machine" works, but it breaks Steward decision 11 (no telemetry) unless the relay is self-hosted, and it cannot render Steward's approval cards properly.

---

## 1. Architecture map

### 1.1 Packages in `happy/` (pnpm workspace, `pnpm-workspace.yaml`)

| Package                                                           | What it is                                                                                                                                                              | Tech                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Size (TS/TSX lines)                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `packages/happy-app`                                              | Mobile app (iOS/Android), web client (`app.happy.engineering`) and a Tauri desktop shell (`src-tauri/`)                                                                 | Expo `~55.0.8`, react-native `0.83.1`, React `19.2.0`, expo-router `~55.0.7`, react-native-unistyles 3, zustand 5, react-native-mmkv 3, socket.io-client 4.8, `@more-tech/react-native-libsodium` (native) / `libsodium-wrappers 0.8.2` (web), `rn-encryption` (native AES-GCM) / `crypto.subtle` (web), expo-notifications, expo-camera (QR scan), expo-secure-store, `@elevenlabs/react(-native)`, `@livekit/react-native`, `posthog-react-native`, `react-native-purchases` (RevenueCat) | about 117k excluding tests (`sources/`) |
| `packages/happy-cli`                                              | The original `happy` CLI and daemon. It wraps Claude Code, Codex, Gemini, ACP agents and OpenClaw, owns the session/machine sockets and runs RPC handlers               | Node, `@anthropic-ai/claude-agent-sdk ^0.3.295`, `@agentclientprotocol/sdk`, tweetnacl, socket.io-client, `expo-server-sdk`, ink, fastify (local control server)                                                                                                                                                                                                                                                                                                                            | about 40k excluding tests (`src/`)      |
| `packages/happy-server`                                           | The relay: HTTP `/v1`–`/v3` and Socket.IO at `/v1/updates`                                                                                                              | Fastify 5, socket.io 4.8.1, Prisma 6.19.2 on Postgres, `@electric-sql/pglite` + `pglite-prisma-adapter` (standalone), optional ioredis with `@socket.io/redis-streams-adapter`, minio/S3 or local files, `privacy-kit` tokens, tweetnacl, prom-client, `elevenlabs`                                                                                                                                                                                                                         | about 11.8k (`sources/`, 120 files)     |
| `packages/happy-server-self-host`                                 | Publishing shell. `happy server` runs the relay on embedded PGlite with local uploads and the bundled web app (README)                                                  | (bundles `happy-server/sources/standalone.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                              | about 0 (scripts)                       |
| `packages/happy-wire`                                             | Shared Zod schemas for the wire (`sessionProtocol.ts`, `messages.ts`, `legacyProtocol.ts`)                                                                              | zod                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 1.2k                                    |
| `packages/happy-agent`                                            | A small Node "remote control" client. It does what the phone does (account QR link, list, spawn, send, read history). The easiest plain-TS reference for the phone side | tweetnacl, socket.io-client, commander                                                                                                                                                                                                                                                                                                                                                                                                                                                      | about 2.0k excluding tests              |
| `packages/happy-ios`                                              | A native Swift/UIKit/GRDB rewrite of the app. Requires iOS 26 (`README.md`)                                                                                             | Swift 6.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | about 226k                              |
| `packages/happy-android`                                          | A native Kotlin/Compose rewrite. "Latest protocol only" (`AGENTS.md`)                                                                                                   | Kotlin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | about 94k                               |
| `packages/expo-tailcat`                                           | Experimental, unpublished. App-scoped WireGuard HTTP/WS to a Tailscale **Tailcat** server, with no VPN profile (`README.md`). Not wired into happy-app                  | Go + Expo module                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | small TS, large Go                      |
| `packages/happy-app-logs`, `happy-mobile-gym`, `dev-environments` | Dev tooling                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | small                                   |

Companion repos. **Happy Agent** (`happy-agent-runtime/`) is the newer headless agent daemon behind the Electron desktop app. Its relay integration is `packages/happy-agent-modules/sources/happy/` (about 13.3k lines). **happy-desktop** is the Electron client for Happy Agent. The project is clearly moving from "CLI wraps Claude Code" to "Happy Agent plus native apps", while the Expo app "stays the reference for behaviour, protocol and design" (`packages/happy-android/AGENTS.md`).

### 1.2 Data flow

```
 Phone / web (happy-app)                Relay (happy-server)                 Desktop (happy-cli daemon + sessions)
 ───────────────────────                ────────────────────                 ─────────────────────────────────────
 master secret (32 B, SecureStore) ─┐   Postgres: Account(publicKey),        ~/.happy/access.key {token, publicKey,
 content keypair = box_seed(         │   Session{metadata*,agentState*,       machineKey} (dataKey) or {token, secret}
   KDF(secret,"Happy EnCoder",       │     dataEncryptionKey*, seq},          per-session AES key (random), wrapped
   ["content"]))                     │   SessionMessage{content:{t,c*}},      to the content public key
                                     │   Machine{metadata*, daemonState*}     (* = ciphertext, base64)
 user-scoped socket  ◄──── update / ephemeral ────►  session-scoped socket (per session)
                     ──── rpc-call "<sid>:permission" (encrypted params) ──► rpc-request → canUseTool resolves
 HTTP POST /v3/sessions/:id/messages (batch, localId) ─► new-message ─► session socket (seq-checked)
                                     │   push-event (plaintext title/body) ─► exp.host ─► APNs/FCM ─► phone
```

---

## 2. Accounts and authentication

- **There is no username or password. An account is a public key.** On first run the phone makes a 32-byte secret (`happy-app/sources/app/(app)/index.tsx` `createAccount`: `getRandomBytesAsync(32)`). It derives an Ed25519 signing keypair from that secret (`sodium.crypto_sign_seed_keypair`, `sources/auth/authChallenge.ts`), signs a random 32-byte challenge, and calls `POST /v1/auth {publicKey, challenge, signature}`. The server verifies with `tweetnacl.sign.detached.verify`, runs `db.account.upsert({where:{publicKey}})` and returns a token (`happy-server/sources/app/api/routes/authRoutes.ts:9-38`).
- **Tokens** come from `privacy-kit` `createPersistentTokenGenerator({service:'handy', seed: HANDY_MASTER_SECRET})` (`sources/app/auth/auth.ts`). The payload is `{user: <cuid>, extras?}`. No expiry was found. Verified tokens are cached for 24 h. `invalidateUserTokens` exists but nothing calls it (grep), so **there is no token revocation**. `docs/user-identity.md` calls these JWTs. The real format is privacy-kit's; `standalone.ts` patches Ed25519 JWK import for it (**UNVERIFIED internals**).
- **Storage.** The phone keeps `{token, secret}` in `expo-secure-store`, but on **web it uses `localStorage`** (`sources/auth/tokenStorage.ts`). The CLI writes `~/.happy/access.key` as plaintext JSON with no explicit file mode (`happy-cli/src/persistence.ts:263-280`), so with a 022 umask it is 0644.
- **Recovery.** The secret is shown as base32 groups `XXXXX-XXXXX-…` (`sources/auth/secretKeyBackup.ts`, 178 lines, tolerant of 0/O, 1/I and 8/B). It can also be moved to a new device by **account link**. The new device shows `happy:///account?<pubkey>`, an existing device scans it and sends the **master secret** box-sealed to that key (`sources/hooks/useConnectAccount.ts`; `POST /v1/auth/account/request|response`).
- **Extras** (all optional, all server-side and plaintext): profile name and username, GitHub OAuth (token encrypted at rest with a server KeyTree, not E2E), vendor API keys (`ServiceAccountToken`, server-encrypted), friends and feed, RevenueCat entitlement checks, voice usage (`docs/user-identity.md`, `prisma/schema.prisma`).

## 3. Pairing a phone with a desktop process (QR)

Terminal pairing, used by the CLI and the daemon (`happy-cli/src/ui/auth.ts`):

1. The CLI makes `secret = randomBytes(32)` and `keypair = tweetnacl.box.keyPair.fromSecretKey(secret)`. Both are ephemeral and used only for this handshake.
2. It calls `POST /v1/auth/request {publicKey, supportsV2:true}`, which creates a `TerminalAuthRequest` row keyed by the public key.
3. It shows a QR of `happy://terminal?<base64url(publicKey)>` (`doMobileAuth`), or opens the web app with the key in the URL (`api/webAuth.ts`).
4. The phone scans it with `CameraView.launchScanner` (`sources/hooks/useConnectTerminal.ts`) and builds two answers, each `encryptBox(…, terminalPublicKey)`. The bundle layout is `ephPub(32)|nonce(24)|box`:
   - **V1 (legacy):** the account **master secret**.
   - **V2:** `[0x00 | contentPublicKey(32)]`. This is only the public half, so the desktop can wrap keys to the account but never read other sessions.
     The phone checks `GET /v1/auth/request/status` and posts **one** answer (V2 if the request said `supportsV2`) to `POST /v1/auth/response` with its bearer token (`sources/auth/authApprove.ts`).
5. The CLI polls `POST /v1/auth/request` every second. Once `response` is set, the server mints a token for `responseAccountId` (extras `{session: <request id>}`) and returns it with the sealed response. The CLI opens it with `box.open`. With V2 it stores `{publicKey, machineKey: random 32 B, token}` (`writeCredentialsDataKey`).

What is good: the relay never sees a key. The phone needs no inbound connection. The QR carries only a public key.

Weaknesses seen in code (relevant to Steward's threat model):

- **No TTL and no one-time use.** `TerminalAuthRequest` rows are never deleted. The schema has no expiry and grep finds no cleanup, and every later poll with the same public key mints a **fresh account token** (`authRoutes.ts:66-79`). Anyone who saw the QR (it holds the public key) can keep minting bearer tokens. They cannot decrypt the sealed answer, but they can call the API as the account. Happy Agent's re-implementation adds a client-side 120 s lifetime (`HAPPY_PAIRING_LIFETIME_MS = 120_000`, `happy-agent-runtime/…/happy/HappyPairing.ts:10`), but the server is unchanged.
- **No short authentication string or confirmation.** The phone approves whatever QR it scans and shows no machine name first. A desktop that requests without `supportsV2` gets the **master secret** (the V1 path). Scanning a hostile QR can therefore hand over the whole account.
- **The `/v1/auth` challenge is chosen by the client** with no server nonce, so a captured `{challenge, signature}` can be replayed for a token. This matters little behind TLS, but it is not proof of possession.

## 4. End-to-end encryption

Sources: `happy-cli/src/api/encryption.ts` (247), `happy-app/sources/sync/encryption/*` (about 900), `happy-app/sources/encryption/{deriveKey,libsodium,aes*,hmac_sha512}.ts`, `docs/encryption.md`, and Happy Agent `…/happy/crypto/{nobleNaCl,happyEncryption}.ts` (90 + 130, pure `@noble/ciphers` and `@noble/curves`).

**Libraries.** On the desktop: tweetnacl 1.0.3 plus `node:crypto` AES-256-GCM. On the phone: libsodium (native `@more-tech/react-native-libsodium`, web `libsodium-wrappers`), AES-GCM through `rn-encryption` (CryptoKit on iOS) or `crypto.subtle` on web, and HMAC-SHA512 written by hand over `expo-crypto` digests. Happy Agent uses `@noble` only. **PRIVACY.md's "TweetNaCl (same as Signal)" is marketing. Signal does not use TweetNaCl.**

**Key hierarchy (dataKey variant, current).**

| Key                           | Derivation / origin                                                                                                                                                                                                     | Where it lives                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Master secret `S` (32 B)      | random on the first phone                                                                                                                                                                                               | phone SecureStore (web: localStorage). Never leaves phones, except V1 pairing and account link |
| Auth signing key              | `crypto_sign_seed_keypair(S)` → Ed25519; the public key is the account id                                                                                                                                               | derived on demand                                                                              |
| Content keypair               | `seed = deriveKey(S, "Happy EnCoder", ["content"])`, then `crypto_box_seed_keypair(seed)` (libsodium hashes the seed with SHA-512 and takes the first 32 bytes, as reproduced in `happy-agent/src/encryption.ts:74-81`) | the phone derives it; desktops hold only the **public** half                                   |
| Session data key `K_s` (32 B) | random per session, made by whoever creates the session (CLI `api.ts:38-51`)                                                                                                                                            | desktop memory. Stored on the relay as `dataEncryptionKey = 0x00                               | ephPub | nonce | box(K_s → contentPub)` |
| Machine key `K_m`             | random at pairing (`machineKey`) and wrapped the same way                                                                                                                                                               | `~/.happy/access.key`                                                                          |
| Blob key                      | `deriveKey(K_s, "Happy Blobs", ["session"])`. Legacy: `deriveKey(S, "Happy Blobs", ["master"])`                                                                                                                         | derived                                                                                        |
| Analytics id                  | `deriveKey(S, "Happy Coder", ["analytics","id"])` hex[0:16]                                                                                                                                                             | sent to PostHog                                                                                |

`deriveKey` (`sources/encryption/deriveKey.ts`, 45 lines) is a BIP32-style tree. The root is `I = HMAC-SHA512(key = usage + " Master Seed", data = seed)`, giving `key = I[0:32]` and `chain = I[32:]`. Each child is `HMAC-SHA512(chain, 0x00 || utf8(index))`.

**Payload formats.**
- _dataKey:_ `ver(1)=0 | nonce(12) | AES-256-GCM ciphertext | tag(16)` over `JSON.stringify(value)`.
- _legacy:_ `nonce(24) | secretbox(JSON)` under `S` itself.
- _blobs (attachments):_ `nonce(24) | secretbox(bytes)`.
- All of these go over the wire as base64 strings.

The phone opens `dataEncryptionKey` with its content secret key (`Encryption.decryptEncryptionKey`). To **resume** a session on a desktop, the phone hands the raw `K_s` back to the owning machine inside a machine-encrypted RPC (`sync/encryption/encryption.ts`, comments at `sessionDataKeys`).

**What is encrypted:** session metadata (path, host, summary, tools, slash commands, lifecycle), `agentState` (pending and completed permission requests with tool name and **arguments**), every session message, machine metadata and daemon state, RPC params and results, artifacts, KV values, access keys and account settings (`docs/encryption.md`).

**What the relay can see.** Account public key; any profile or GitHub data the user chose to add; session, machine and message ids; per-user and per-session `seq`; message count, sizes and timestamps; `active`, `thinking` and online presence; IP addresses and `X-Happy-Client` (platform/version); **`UsageReport.data` (tokens and cost) in plaintext**; RPC **method names** (`<sessionId>:permission`, `<machineId>:spawn-happy-session`, `bash`, …), so it knows _that_ and _when_ a permission was answered; push tokens; and **push title, body and data** (§7). Server-side encrypted, not E2E: GitHub and vendor tokens (`HANDY_MASTER_SECRET` KeyTree).

## 5. Relay and sync protocol

Sources: `docs/protocol.md`, `docs/realtime-sync-and-rpc.md`, `happy-server/sources/app/api/socket.ts` (197), `socket/rpcHandler.ts` (260), `socket/sessionUpdateHandler.ts` (293), `events/eventRouter.ts` (739), `routes/v3SessionRoutes.ts` (240).

- **Transport.** Socket.IO on path `/v1/updates`. The CLI and app use websocket only. CORS is `*`, `pingInterval` 15 s and `pingTimeout` 45 s (`socketConfig.ts`). HTTP JSON runs on `/v1`, `/v2` and `/v3`. Auth runs in `io.use` middleware **before** `connect`, to close a race in which early `rpc-register` events were dropped (`socket.ts:49-91`).
- **Three connection scopes** come from the handshake `auth: {token, clientType, sessionId?, machineId?, happyClient, appState}`:
  - `user-scoped`: phone and web, receive everything for the account.
  - `session-scoped`: one per running agent session.
  - `machine-scoped`: one per daemon, which also drives online/offline `machine-activity`.
    Rooms are `user:<uid>`, `user:<uid>:session:<sid>`, `user:<uid>:machine:<mid>` and `rpc:<uid>:<method>`. Multi-replica uses the Redis streams adapter when `REDIS_URL` is set. The docs say Redis is required, but `main.ts:24-28` makes it optional.
- **Two event channels.** `update` events `{id, seq, body:{t,…}, createdAt}` are durable and ordered by a per-user `Account.seq`. Their types are `new-session`, `update-session`, `new-message`, `new-machine`, `update-machine`, artifacts, `kv-batch-update`, `update-account`, and others. `ephemeral` events `{type,…}` are not stored: `activity` (with `thinking`), `machine-activity`, `usage`, `machine-status` and `session-event`.
- **Messages.**
  - The phone sends `POST /v3/sessions/:id/messages {messages:[{localId, content:<base64 ciphertext>}]}`.
  - The server deduplicates by `localId` inside a transaction and allocates per-session `seq` with `allocateSessionSeqBatch`, which makes the call **idempotent**.
  - It stores `{t:"encrypted", c}` and fans out `new-message`.
  - Readers page with `GET /v3/sessions/:id/messages?after_seq=&limit=` (or `before_seq` going backwards).
  - The CLI session client accepts a `new-message` only if `seq === lastReceivedSeq + 1`. Otherwise it invalidates and refetches `after_seq` (`happy-cli/src/api/apiSession.ts:325-345, 605-660`).
  - The app keeps a per-session **pending outbox** and flushes it in batches (`sync/sync.ts:880-930, 2195-2225`).
- **Mutable state** (`metadata`, `agentState`, `daemonState`, artifacts, KV) uses **optimistic concurrency**. A client emits `update-state {sid, agentState, expectedVersion}` and gets back either `{result:"success", version}` or `{result:"version-mismatch", version, agentState}`, then retries on the current value.
- **RPC (point-to-point control).**
  - A handler owner emits `rpc-register {method:"<scopeId>:<name>"}` and joins room `rpc:<uid>:<method>`.
  - A caller emits `rpc-call {method, params}` with an ack. The server forwards it as `rpc-request` with ack to a socket in that room.
  - There is a 15 s reconnect grace, a 30 s call timeout, a 2 s presence poll and a fast fail if the target leaves (`rpcHandler.ts:16-34`). The app gives up after 50 s (`sync/apiSocket.ts`, `RPC_ACK_TIMEOUT_MS`).
  - Params and results are **encrypted with the session or machine key** (`happy-cli/src/api/rpc/RpcHandlerManager.ts`, 147 lines). Handlers re-register on every reconnect.
- **Reconnection.** The app uses socket.io automatic reconnection (1–5 s backoff, unlimited) and an `appState` callback that is re-read on every reconnect. The CLI uses `reconnection:false` plus its own "smart reconnect" that waits for network capability, then invalidates the receive cursor (`apiSession.ts:1025-1063`). Presence comes from `session-alive` and `machine-alive` heartbeats, and `presence/timeout.ts` expires them.

## 6. Permission prompts (maps directly onto Steward approvals)

**Desktop side** (`happy-cli/src/claude/utils/permissionHandler.ts`, 457 lines; `claude/sdk/query.ts` maps `canCallTool` to the SDK `canUseTool`):

1. Claude Code (through `@anthropic-ai/claude-agent-sdk` `query({ canUseTool })`) asks before a tool runs. Before asking the phone, the handler auto-allows in these cases:
   - tools on its session allow-list, including `Bash(cmd)` literals and `Bash(prefix:*)` prefixes;
   - every tool in bypass/yolo mode;
   - edits in `acceptEdits` mode;
   - non-dangerous tools in `plan` mode.
     `AskUserQuestion` and `ExitPlanMode` always ask.
2. Otherwise `handlePermissionRequest` parks a Promise keyed by `toolUseID` (`agentID:toolUseID` for subagents). It then:
   - fires a **push** with `kind:'permission'` and data `{sessionId, requestId, tool, type:'permission_request', provider:'claude'}`;
   - writes `agentState.requests[id] = {tool, arguments, createdAt}` as an encrypted, versioned `update-state`. That reaches the phone as `update-session`.
3. The handler serves the RPC `permission` (`<sid>:permission`) with body `{id, approved, reason?, mode?, allowTools?, decision?: approved | approved_for_session | denied | abort, updatedInput?}`. It resolves the Promise to `{behavior:'allow', updatedInput}` or `{behavior:'deny', message}`. It moves the entry to `completedRequests[id]` with `status`, `mode` and `allowTools`, and an abort signal cancels it.

**Phone side.**
- `components/tools/PermissionFooter.tsx` (612 lines) renders Allow / Allow for session / Deny under the tool card. It calls `sessionAllow` or `sessionDeny` (`sync/ops.ts:919-956`), which wrap `apiSocket.sessionRPC(sid, 'permission', req)`.
- Questions use a separate `communication` RPC (`sessionAnswerQuestion`).
- Unknown tool names render with a generic title and input/output sections; names prefixed `mcp__` render minimal (`components/tools/ToolView.tsx:62-105`).

**What the phone can also do that Steward must not copy.**
- User messages carry `meta.permissionMode` (switch to `yolo` / `bypassPermissions`) and `meta.appendSystemPrompt` (`sync/sync.ts:882-897`; `docs/permission-resolution.md`). The phone can therefore turn off asking and inject prompts remotely.
- `registerCommonHandlers.ts` exposes RPCs `bash`, `readFile`, `writeFile`, `listDirectory`, `ripgrep` and `difftastic`. On the **daemon** they have no path boundary (`workingDirectory === null` → `{valid:true}`, lines 168-172). This is a remote shell available to any holder of the machine key and token.
- The ElevenLabs voice agent's `processPermissionRequest` tool can allow or deny (`realtime/realtimeClientTools.ts:49-93`).
- Happy Agent (the newer daemon) narrowed this. Its session RPCs are an allow-list: `abort, communication, killSession, leaveTask, gitState, readFile, readFileAtRevision, setAvatar` (`happy-agent-runtime/…/happy/handleHappySessionRpc.ts`). It offers permission **modes** only (`happyPermissionModes.ts`) and does not bridge per-call prompts.

**Mapping to Steward.**

| Happy                                            | Steward                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agentState.requests[id]` (encrypted, versioned) | `Approval{status:"pending"}` + LiveEvent `approval.created`                                                                                                                                |
| `agentState.completedRequests[id]`               | `Approval{status: allowed\|refused\|expired\|cancelled}` + `approval.decided`                                                                                                              |
| RPC `permission {id, approved, decision}`        | `POST /api/approvals/:id/decision {answer: once\|always\|refuse}`, then the 3 s server **resume sweep** starts the resume run (PLAN §4.4). No browser is needed, which is ideal for phones |
| `allowTools` / `approved_for_session`            | "Always allow" creates a standing rule. **Only when `canAlways`** (not for taint, safety floor or the person's own ask rules)                                                              |
| push `kind: permission \| done \| question`      | `AppNotification.level: needs_you \| done \| …` (LiveEvent `notification`)                                                                                                                 |
| `session-alive` / `thinking` ephemeral           | LiveEvents `run.started` / `run.finished`                                                                                                                                                  |
| `new-message` stream                             | AG-UI events (`TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED` with `outcome.type="interrupt"`)                                                                                             |

## 7. Push notifications

- **The phone registers** an Expo token with `Notifications.getExpoPushTokenAsync({projectId})` (`sync/pushRegistration.ts`), then `POST /v1/push-tokens` (`sync/apiPush.ts`). Tokens are per account, in `AccountPushToken`.
- **What triggers a push.** Only the desktop's `PushNotificationClient.sendSessionNotification` (`happy-cli/src/api/pushNotifications.ts`) for `done` ("It's ready!"), `permission` ("Permission request") and `question` ("Clarification needed"). The **body is the session summary text or the last path segment of the project folder** (`getSessionTitle`). Data includes `sessionId`, `requestId`, **tool name** and provider. There is no push per message; it was removed as too noisy (`pushDispatch.ts` header).
- **Relay dispatch.** The route is `POST /v1/sessions/:id/push-event` (`routes/pushRoutes.ts:89-151`).
  - It first emits an ephemeral `session-event` to open clients.
  - It **suppresses** the push if any user-scoped socket reports `app-state: active`, and it fails open (`push/pushDispatch.ts`, `push/focusTracker.ts`).
  - It posts directly to `https://exp.host/--/api/v2/push/send` in batches of 100 with an 8 s deadline, and deletes tokens reported `DeviceNotRegistered` (`push/pushSend.ts`).
  - It returns an outcome (`sent | partial | suppressed | no_tokens | failed`) so callers can see outages. The comment records that a push outage once went unnoticed for two months.
  - The CLI falls back to a direct Expo send when `sessionId` is missing.
- **E2E gap.** The title, body and data are plaintext to the relay, Expo and APNs/FCM. `PRIVACY.md` ("Push notifications are sent directly from your devices to each other, not from our backend… We never see the content") is **contradicted by the code**.
- Notifications are not actionable: no categories or action buttons were found. Tapping deep-links to `/session/<id>`.

## 8. Voice

ElevenLabs Conversational AI (`docs/voice-architecture.md`, `sources/realtime/*` about 970 lines, `happy-server/sources/app/api/routes/voiceRoutes.ts`).

- **Transport.** Native uses `@elevenlabs/react-native` over LiveKit/WebRTC. Web uses `@elevenlabs/react` over WebSocket.
- **Token flow.** The relay checks RevenueCat entitlements (`api.revenuecat.com/v2/projects/proj493735ad/…`) and usage. It then fetches `api.elevenlabs.io/v1/convai/conversation/token?agent_id=…&participant_name=u_<HMAC(cuid)>`. A "bring your own agent" path bypasses the relay.
- **Context.** The app streams session context (paths, summaries, history, pending permission requests with tool arguments) to ElevenLabs as plaintext. It uses `sendContextualUpdate`, which is silent, and `sendTextMessage`, which prompts and is queued while anyone is speaking, with VAD debounce at 0.5 and 300 ms.
- **Client tools.** `messageClaudeCode` and `processPermissionRequest`.
- For Steward this is a third-party LLM that can approve actions and receives tool arguments. **Do not port it.** The batching and VAD ideas are worth reading.

## 9. Self-hosting

- `npm i -g happy happy-server-self-host && happy server` runs `standalone.ts`: PGlite in `DATA_DIR/pglite`, hand-rolled migrations, local file storage, and the bundled web export (about 28 MB). It writes `settings.serverUrl` for the CLI. The default bind is `127.0.0.1`, and `--host 0.0.0.0` is needed for phones on the LAN (`docs/plans/happy-serve-self-host.md:49,197,285`).
- Pointing the CLI elsewhere: `HAPPY_SERVER_URL` / `HAPPY_WEBAPP_URL` (`happy-cli/src/configuration.ts`). The phone has a custom server URL setting in MMKV (`sync/serverConfig.ts`). iOS allows plain HTTP to LAN via `NSAllowsLocalNetworking` (`app.config.js:79-88`).
- Production uses Postgres, optional Redis, S3/MinIO and `HANDY_MASTER_SECRET` (`docs/deployment.md`, `Dockerfile.server`, `deploy/*.yaml`). The defaults hard-code `https://api.cluster-fluster.com` (CLI, app and push client) and `https://app.happy.engineering`.
- A self-hosted relay still pushes through `exp.host` with tokens from the **official** app's Expo project (`4558dd3d-cd5a-47cd-bad9-e591a241cc06`). Whether this works without Happy's Expo access token depends on that project's push-security setting (**UNVERIFIED**).

## 10. What to copy into Steward and what to re-implement

Keep the MIT notices (§12). Sizes are line counts.

**Copy and adapt** (small, self-contained, protocol-level):

| Module                                 | Path                                                                                                                                              | Lines           | Adaptation for Steward                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NaCl box/secretbox + X25519 on @noble  | `happy-agent-runtime/packages/happy-agent-modules/sources/happy/crypto/nobleNaCl.ts`                                                              | 90              | Use as is. Runs in Node 24 and in the browser/PWA                                                                                                             |
| Payload and wrapped-key formats        | `…/happy/crypto/happyEncryption.ts`                                                                                                               | 130             | Swap `node:crypto` AES-GCM for WebCrypto so one module serves server and PWA. Keep the version byte                                                           |
| Key tree (HMAC-SHA512, string indices) | `happy/packages/happy-app/sources/encryption/deriveKey.ts` (or the sync Node version in `happy/packages/happy-agent/src/encryption.ts:36-81`)     | 45 / 45         | Use `node:crypto` / WebCrypto HMAC. Rename the usage strings to `Steward …` (no shared key domains with Happy)                                                |
| Sealed-box bundle helpers              | `happy/packages/happy-app/sources/encryption/libsodium.ts`, `happy-cli/src/api/encryption.ts:58-80`                                               | 57 / 25         | Use as the pairing response and data-key wrap                                                                                                                 |
| Pairing handshake (desktop side)       | `happy-cli/src/ui/auth.ts` (`doMobileAuth`, `waitForAuthentication`, `decryptWithEphemeralKey`) + `…/happy/HappyPairing.ts` (TTL, cancel, unlink) | about 120 + 370 | Drop V1 (secret transfer). Add server TTL and one-time consumption, a short code shown on both screens, and device naming                                     |
| Pairing server routes                  | `happy-server/sources/app/api/routes/authRoutes.ts`                                                                                               | 243             | Port to Hono or the relay. Fix the issues in §3: delete on first read, expire after 2 min, issue a **device-scoped** token, use a server nonce for `/v1/auth` |
| Recovery-key format                    | `happy-app/sources/auth/secretKeyBackup.ts`                                                                                                       | 178             | Use as is for the "save your recovery key" screen                                                                                                             |
| Encrypted RPC manager                  | `happy-cli/src/api/rpc/RpcHandlerManager.ts`                                                                                                      | 147             | Replace socket.io with the relay's WS. Expose an **allow-list** of methods only (§11)                                                                         |
| RPC routing with reconnect grace       | `happy-server/sources/app/api/socket/rpcHandler.ts`                                                                                               | 260             | Re-implement about 120 lines for one user and one machine. Keep the 15 s grace, the 30 s timeout and the fast fail                                            |
| Seq-ordered idempotent messages        | `happy-server/sources/app/api/routes/v3SessionRoutes.ts` + `happy-cli/src/api/apiSession.ts:325-345,605-660`                                      | 240 + about 100 | Same primitive for an encrypted AG-UI event log per thread: `localId` dedupe, `after_seq` catch-up, gap → refetch                                             |
| Optimistic concurrency on state        | `happy-server/sources/app/api/socket/sessionUpdateHandler.ts:13-135`                                                                              | about 120       | Use for small mirrored state (pending approvals list, brief)                                                                                                  |
| Presence-aware push with outcomes      | `happy-server/sources/app/push/{pushDispatch,pushSend,focusTracker}.ts`                                                                           | 130 + 76 + 24   | Swap Expo for Web Push (VAPID). Keep the "suppress if a client is visibly active" rule and the outcome enum. Send **sealed** payloads (§11)                   |
| Outbox and cursor persistence          | `…/happy/HappySyncDatabase.ts` + `…/happy/README.md` "Storage"                                                                                    | 612             | Idea only. Two `node:sqlite` tables: `remote_outbox` and `remote_cursor`, keyed per device/thread                                                             |
| Wire schemas                           | `happy/packages/happy-wire/src/sessionProtocol.ts`                                                                                                | 174             | Idea only. Steward should carry **AG-UI events** inside the envelope rather than invent a third event vocabulary                                              |

**Re-implement (learn from, do not copy):**
- the app sync engine: `happy-app/sources/sync/sync.ts` (3,345), `storage.ts` (2,035), `ops.ts` (1,367), `typesRaw.ts` (1,302);
- the Prisma/Postgres server, the social, feed, GitHub and vendor-token routes, and artifacts and KV;
- the socket scopes and rooms. Steward has one person and one machine, so `eventRouter.ts`'s 739 lines collapse to a few dozen;
- the RN UI: `PermissionFooter.tsx` (pattern only) and `knownTools.tsx`.

**Claude Code / Codex specifics to drop or adapt to AG-UI:**
- `happy-cli/src/claude/**` (SDK `canUseTool`, hook server, session scanner, `sdkToLogConverter`), `codex/**` (`codexAppServerClient.ts` 1,584, `sessionProtocolMapper.ts` 1,406), `gemini/**`, `agent/acp/**`, `openclaw/**`, `agy/**`.
- Permission modes (`default | acceptEdits | bypassPermissions | plan | read-only | safe-yolo | yolo`) and `Bash(prefix:*)` allow-lists. These are replaced by Steward's CEL policy and gateway (PLAN §4.3, §4.6).
- `agentState.requests` and the `permission` RPC. These are replaced by Steward `Approval` plus the decision endpoint.
- In Steward the source of the event stream is the CopilotKit runtime and `NodeSqliteAgentRunner`. A relay bridge in `apps/server` would subscribe to the runner's AG-UI events and LiveEvents and seal them, instead of wrapping a child process.

## 11. Recommended shape for Steward

**Option A: be a Happy-compatible machine.** Port Happy Agent's `happy` module (about 13k lines; the core is about 3k) so Steward registers as a machine and threads appear in the official Happy app.
- _For:_ no app to ship, E2E, push and voice included.
- _Against:_
  - the default relay is Happy's (`api.cluster-fluster.com`), which breaks PLAN §4.11 (telemetry: none) unless self-hosted;
  - the app has PostHog on by default and RevenueCat;
  - Steward's approval cards (summary, findings, `canAlways`, taint, target) would render as generic tool cards;
  - push bodies leak in plaintext;
  - UI accessibility is not under Steward's control (Steward is accessible first);
  - Steward would be tied to a fast-moving third-party protocol (legacy/dataKey, v1/v2/v3 routes).
- Good as an experiment, not as the product.

**Option B (recommended): a Steward relay and PWA built on Happy's protocol ideas.**
- **No inbound ports.** `apps/server` stays on 127.0.0.1 and **dials out** over WSS to a relay (`apps/relay`: Hono + ws + `node:sqlite`, one binary, about 1.5k lines). The relay is self-hostable on a VPS, on Fly or in a container. "Turn on phone access" is opt-in in `/settings`, and the screen states what the relay can see.
- **The phone UI is an installable PWA,** a mobile build of `apps/web` (same React 19 components and accessibility work), served as static files **from the relay origin** over HTTPS. Push and installation need a stable HTTPS origin; loopback cannot provide one. All content is E2E: the relay serves code and ciphertext only.
- **Pairing.**
  - In `/settings`, Steward shows a QR `steward://pair?k=<ephemeral pub>&r=<relay url>&c=<6-digit code>`.
  - The PWA creates a **per-device** keypair (WebCrypto, non-extractable, in IndexedDB) and seals its device public key to the ephemeral key.
  - Steward shows "Pair 'Pixel 9'? code 482-913" and the person confirms on the desktop.
  - Steward then seals the per-thread or account data key to the device key.
  - Server side: one-time, 2-minute TTL, device-scoped tokens, revocation from `/settings`.
  - This fixes every pairing weakness in §3.
- **Data plane.**
  - The bridge forwards an allow-listed subset of LiveEvents and AG-UI events as sealed, `seq`-numbered envelopes per thread, with `localId` idempotency and `after_seq` catch-up (the §10 primitives).
  - Phone actions are a closed RPC set:
    - `approval.decide {approvalId, answer}`, which goes straight into the existing decision handler;
    - `chat.send {threadId, text}`;
    - `task.start | task.hide`;
    - `run.stop`.
  - **Never** remote-callable: rules/policy, connections, settings, secrets, shell and computer input. Those stay loopback only, consistent with "the gateway is the only path to act".
- **Approval integrity.** The phone signs `{approvalId, answer, nonce, ts}` with its device key. The server verifies the signature and checks that `answer=always` is allowed only when `canAlways`. It records `via: phone:<deviceId>` in the hash-chained audit row and lets the existing claim-once and resume sweep finish. For safety-floor kinds (pay, sign, credential entry), require the PWA to re-check the person (WebAuthn user verification) before signing (**design proposal**).
- **Push.** Web Push (VAPID; RFC 8030/8291) to the PWA's subscription.
  - The **daemon** seals the notification body (for example "Send an email to sam@…?") with the device key, so the relay and the push service see only an opaque blob plus `level`.
  - The service worker decrypts it and shows the notification.
  - Keep Happy's suppression ("a visible client is active") and its outcome reporting.
  - iOS supports Web Push only for home-screen-installed PWAs (iOS 16.4+). Support for notification action buttons on iOS is **UNVERIFIED**, so tapping should open the approval card, which is also the safer UX.
- **Transport alternative.** Tailscale/Tailcat (`packages/expo-tailcat`) lets the phone reach the desktop with no relay. It needs a Tailscale-style client on the phone and suits power users. Keep it as an advanced option, not the default.

**Option C: fork the Expo app.** It is about 117k lines and carries App Store, EAS, push-certificate, RevenueCat and PostHog removal work (§12). Only worth it if the PWA's iOS limits become blocking. If so, start a fresh Expo app that reuses the §10 crypto modules rather than forking happy-app.

**Rough size for Option B v0:**
- crypto and pairing: about 700 lines (mostly ported);
- relay: about 1.5k;
- bridge in `apps/server`: about 600;
- PWA shell (manifest, service worker, approvals/Today/chat views reusing `apps/web`): about 1.5k;
- tests.

This adds `packages/remote` (shared crypto and envelopes) and `apps/relay`, and it needs a PLAN §8 change, because mobile is currently out of scope for v0.1.

## 12. Risks

**Licence obligations.**
- Everything worth copying is MIT. Keep each copyright line in `NOTICE` and in file headers of ported files:
  - "Copyright (c) 2026 Happy Coder Contributors" (root `LICENSE`);
  - "Copyright (c) 2024 Happy Coder Contributors" (`packages/happy-app/LICENSE`);
  - "Copyright (c) 2026 rig Contributors" (happy-agent runtime).
- Do not copy from `happy-server-legacy` (no LICENSE file).
- The **"Happy" name, logo and `happy://` scheme are not covered by MIT** (trademark). Use `steward://`.
- Fonts in `happy-app/sources/assets/fonts` (IBM Plex, Bricolage Grotesque, Space Mono) are likely OFL (**UNVERIFIED**; no licence files alongside).
- `@anthropic-ai/claude-agent-sdk` is under Anthropic's commercial terms, not OSS (**UNVERIFIED** exact terms). Steward does not need it.
- `expo-tailcat` brings Go dependencies under BSD-3 and Apache-2.0 (`THIRD_PARTY_NOTICES.md`).
- `privacy-kit`'s licence is **UNVERIFIED**. Do not depend on it.

**App Store / EAS (only if Option C).** Every identity in Happy's config is Happy's own and must be replaced:
- bundle ids `com.ex3ndr.happy` (prod), `com.slopus.happy.{dev,preview}` (`app.config.js:9-13`);
- EAS `projectId 4558dd3d-…` and `owner: "bulkacorp"`;
- Apple Team `466DQWDR8C` and ASC app ids in `eas.json`;
- `google-services.json` (Happy's Firebase project, committed);
- associated domain `applinks:app.happy.engineering`;
- scheme `happy`;
- the RevenueCat, PostHog and ElevenLabs keys (env-injected);
- OTA via `expo-updates` (`u.expo.dev/<projectId>`).

You would need:
- an Apple Developer account ($99/yr) and a Google Play account ($25);
- an APNs auth key uploaded to Expo/EAS and FCM v1 credentials;
- privacy nutrition labels.

Two compliance points need review (**UNVERIFIED**):
- **Account deletion** (App Store 5.1.1(v)) — grep found no account-delete flow in happy-app or happy-server.
- **Export compliance** — happy-app sets `usesNonExemptEncryption: false` despite E2E.

A PWA avoids store review entirely.

**Privacy: places the Happy code phones home** (each is relevant if anything is ported):
- default relay `api.cluster-fluster.com` and `files.cluster-fluster.com`, web app `app.happy.engineering` (CLI `configuration.ts`, app `serverConfig.ts`);
- PostHog `us.i.posthog.com`: on unless `analyticsOptOut` (`sources/track/tracking.ts`; `settings.ts:116` default `false`). It sends an id derived from the master secret, device and app data, and IP;
- RevenueCat (app, plus server `api.revenuecat.com`);
- ElevenLabs (voice);
- Expo push `exp.host` (server, plus a CLI fallback);
- Expo OTA `u.expo.dev`;
- **Mermaid loaded at runtime from `cdn.jsdelivr.net`** inside a WebView (`components/markdown/MermaidRenderer.tsx:119`);
- opt-in `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING`, which uploads **unencrypted** logs (`happy-cli/src/ui/logger.ts:56,186`).

The CLI itself has no analytics (grep: no posthog or telemetry in `happy-cli/src`).

**Security patterns not to inherit:**
- non-expiring, reusable pairing requests, and tokens that cannot be revoked (§2, §3);
- V1 handover of the master secret;
- the web client's secret in `localStorage`;
- `access.key` written with no mode;
- remote `bash` and `writeFile` without a boundary (§6);
- phone-controlled `permissionMode` and `appendSystemPrompt`;
- a voice LLM that can approve;
- plaintext push content;
- CORS `*`.

**Maintenance burden.**
- Happy ships several commits a day across three repos. It is mid-pivot: native Swift (iOS 26 only) and Kotlin apps, the Happy Agent daemon, and the desktop app.
- The protocol carries legacy and dataKey variants plus v1/v2/v3 routes.
- 10 dependency-patch scripts in root `patches/`, plus `packages/happy-app/patches/`.
- Expo SDK upgrades are yearly (see `docs/plans/expo-sdk-55-upgrade.md`).
- Wire compatibility (Option A) means tracking all of that. A protocol fork (Option B) means owning about 4k lines, with no upstream to track.

## 13. Open questions and unverified items

- privacy-kit token format and lifetime. Whether any route revokes tokens or rejects a deleted machine's token beyond machine registration. The Happy Agent README says registration is refused after deletion.
- Whether Expo push to the official Happy app works from a self-hosted relay without Happy's Expo access token.
- How iOS PWAs handle Web Push actions and badges in the current iOS version. Test on a device before committing to Option B's notification UX.
- Exact rendering of unknown-tool permission cards in the stock Happy app (relevant to Option A only). It was read from `ToolView.tsx` but not run.
- Font licences, `privacy-kit` licence, and `@anthropic-ai/claude-agent-sdk` terms.
