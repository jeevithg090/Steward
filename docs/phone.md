# Steward on your phone

Steward stays on your computer. Your iPhone reaches it through a port of its own, with a key you
can take back at any time, and through the Shortcuts app: "Hey Siri, Steward, what needs me?"

This page covers the shortcut (Phase 1 of [the plan](plans/phone-and-shortcuts.md)) and the phone
app over an encrypted relay (Phase 2): how the phone reaches Steward, how to pair, what a phone may
do, and what still has to be checked on a real iPhone. The design and its reasons are in the plan; the threat model is in
[security.md](security.md#phones-the-device-port).

- [What you get](#what-you-get)
- [1. Let the phone reach Steward](#1-let-the-phone-reach-steward)
- [2. Pair an iPhone](#2-pair-an-iphone)
- [3. Use it](#3-use-it)
- [What a phone may do](#what-a-phone-may-do)
- [Updates](#updates)
- [The phone app, through your own relay](#the-phone-app-through-your-own-relay)
- [For maintainers: signing a release](#for-maintainers-signing-a-release)
- [What has been tested](#what-has-been-tested)
- [To check on a device](#to-check-on-a-device)

## What you get

- **The Steward shortcut.** One shortcut for everything. It holds no address and no key; your
  Steward decides what its menu shows, built from your skills, routines, bots and setup, so a new
  skill appears in it without adding anything. It also takes text from the share sheet ("Check
  this").
- **Launchers**, one tap each, from the Shortcuts page (`/shortcuts`): tiny shortcuts such as
  "Steward What needs me" that open the Steward shortcut at one action, so Siri, the Action button
  and the Home Screen can reach it.
- **Your setup's own shortcuts.** A tenant declares them in `tenants/<id>/shortcuts.yaml`; Tempo
  ships Delay Spotter and Scam Spotter that way.

## 1. Let the phone reach Steward

Steward listens on `127.0.0.1:8787` for this computer and on `127.0.0.1:8788` for phones. The phone
port answers only `/device/*`, and only with a device key.

**Point a tunnel at 8788. Never at 8787:** the main port has no sign-in, so anyone who reached it
could act as you. Steward refuses requests that arrive at 8787 through a tunnel, and warns at start
when `STEWARD_ALLOWED_HOSTS` is set.

Steward never starts a tunnel by itself. Settings → Phone shows which tools are installed and the
exact command for each.

### Tailscale Serve (recommended)

Only your own devices can reach it, and it has a real HTTPS certificate.

1. Install Tailscale on the computer and on the iPhone, and sign in to the same tailnet on both.
2. On the computer:

   ```sh
   tailscale serve --bg 8788
   ```

   It prints an address such as `https://your-mac.your-tailnet.ts.net`.
3. Put that address in **Settings → Phone → Phone address**, and save.

Keep the Tailscale app connected on the phone (it can connect on demand).

### Cloudflare named tunnel with Access

A stable public address on your own domain, with Cloudflare Access in front.

1. Create a named tunnel to `http://127.0.0.1:8788` and a hostname such as
   `https://steward.example.com` (Cloudflare's docs: `cloudflared tunnel create`, then a route).
2. In Cloudflare Access, create an application for that hostname with a **Service Auth** policy
   and a service token. Add a **Bypass** policy for `/device/pair`, `/device/shortcut/*` and
   `/device/install/*`: those take only a one-time code or a one-time link, and the phone has no
   service token until it has paired.
3. Give Steward the service token, in `.env`:

   ```sh
   STEWARD_DEVICE_ACCESS_CLIENT_ID=...
   STEWARD_DEVICE_ACCESS_CLIENT_SECRET=...
   ```

   Steward hands it to the phone in the pairing reply, and the shortcut sends it on every call
   (`CF-Access-Client-Id`, `CF-Access-Client-Secret`).
4. Put `https://steward.example.com` in Settings → Phone.

### Same Wi-Fi

At home only. Traffic is plain http, so anyone on the network could read the key.

1. In `.env`: `STEWARD_DEVICE_HOST=0.0.0.0`, then restart Steward. It warns at start.
2. Put `http://<your-mac>.local:8788` in Settings → Phone. Steward accepts plain http only for
   `.local` names and home or tailnet addresses, and shows a warning.
3. The phone asks for Local Network access the first time.

### Cloudflare quick tunnel (demos)

`cloudflared tunnel --url http://127.0.0.1:8788` prints a `trycloudflare.com` address. It changes
every run, so you pair again each time. Use it for a demo, not every day.

## 2. Pair an iPhone

In Steward on the computer: **Settings → Phone → Add iPhone**. Two QR codes appear, each with a
link (for when this page is open on the phone) and a copy button.

1. **Get the Steward shortcut** (once). Scan the first code with the iPhone's Camera, open the
   download, and tap **Add Shortcut**.
2. **Pair it.** Scan the second code. Shortcuts opens and asks "Pair with Steward on _your
   computer_ at _the address_?". Check that it names your computer, and tap **Pair**. The first
   call to a new address may ask you to **Allow** it.

The card on the computer turns green: "Sam's iPhone paired". The code works once, for 10 minutes,
and dies after 5 wrong tries. The key is stored in `iCloud Drive/Shortcuts/Steward/device.json`.

**One tap, with the key inside (Mac only).** The Shortcuts page can make a copy of the Steward
shortcut that already holds a new key, signed on this Mac for your own devices
(`people-who-know-me`; nothing goes to Apple). The link works once, for 10 minutes. Open it only on
your own iPhone, and delete the download afterwards. Whether an iPhone accepts it with Private
Sharing switched off is still to be checked (below); pairing with the code always works.

## 3. Use it

- **"Hey Siri, Steward"** opens the menu: Ask Steward, What needs me?, Needs you, your skills and
  routines, and your setup's shortcuts.
- **Share** a message or a link to Steward from any app: "Check this".
- **Launchers** from the Shortcuts page go straight to one action. Add them to the Action button or
  the Home Screen as you would any shortcut.
- **Your brief every morning:** in Shortcuts, add a Time of Day automation at your brief time,
  weekdays, Run Immediately, with the action Run Shortcut → Steward and the input `action:brief`.
  (iOS 27 can carry an automation inside a shared shortcut, but how one is encoded is not known
  yet; see check 7.)

Answers come back as words the shortcut shows, and Siri reads them aloud when Siri started it.

## What a phone may do

Each phone has its own key and its own list, under Settings → Phone:

| It may                | Out of the box | What it means                                           |
| --------------------- | -------------- | ------------------------------------------------------- |
| Read the brief        | yes            | What needs you today.                                   |
| See what Steward asks | yes            | List requests waiting for you, and **refuse** them.     |
| Say yes to requests   | **no**         | "This phone can say yes to things Steward asks about."  |
| Talk to Steward       | yes            | Ask for things; work started from a phone is marked so. |
| Tasks                 | yes            | See tasks.                                              |
| Run routines          | yes            | Run one of your routines now.                           |

And never, whatever you switch on:

- **Payments, signing and passwords** are finished on your Mac. A phone can refuse them.
- **From a shortcut, a send, delete or command after Steward read untrusted content** is finished
  in the app or on your Mac.
- **Always allow** is chosen on your Mac: it writes a standing rule.
- **Rules, settings, connections, secrets, the shell and the computer** are not reachable from a
  phone at all.
- **Work started from a phone asks before it sends**, signs, deletes or runs a command, even where
  you chose Always allow (a preset on `/rules`).

Every answer from a phone is in the record: "Answered from Sam's iPhone (Shortcuts)". Revoke a
phone in Settings → Phone; its next call is refused.

## Updates

Every call names the shortcut's version (`X-Steward-Shortcut: steward@1`). When a release needs a
newer one, Steward answers `426` with the notes and the download, and the shortcut opens it: tap
**Add Shortcut** and it stays paired, because the key lives in the shared file. The Shortcuts page
lists each phone's version under Installed and Updates.

## The phone app, through your own relay

The phone app is Steward's web app built for a phone: Today, Needs you, Chat and Tasks, with live
replies and notifications. It talks to Steward through a **relay you host**, and everything is
sealed end to end: the relay passes on ciphertext only. Steward dials out to the relay, so nothing
listens beyond your computer.

### 1. Run a relay

On a small server with a domain name (a VPS, Fly, a container), from a checkout of this repository:

```sh
pnpm install
pnpm --filter @steward/web build:phone
RELAY_MACHINE_TOKEN="$(openssl rand -base64 32)" \
RELAY_PUBLIC_URL=https://relay.example.com \
pnpm --filter @steward/relay start
```

It listens on `127.0.0.1:8790`. Put HTTPS in front of it, for example with Caddy:

```text
relay.example.com {
  reverse_proxy 127.0.0.1:8790
}
```

`RELAY_DATA_DIR` (default `./relay-data`) holds one SQLite file: device ids, hashed relay tokens,
push addresses and each phone's sealed log. Never a key, never plaintext.

### 2. Point Steward at it

In Steward's `.env`, then restart:

```sh
STEWARD_RELAY_URL=wss://relay.example.com
STEWARD_RELAY_TOKEN=<the same RELAY_MACHINE_TOKEN>
```

Settings → Phone → **Add phone (app)** says "connected" when it reached the relay.

### 3. Pair the phone

1. Settings → Phone → **Add phone (app)**. A QR code appears; it works once, for two minutes. Its
   one-time key is in the part of the address after `#`, which a browser never sends to a server.
2. Scan it with the phone's Camera. The app opens: name the phone and tap **Pair**. If the phone
   offers Face ID, allow it.
3. Both screens show a six-digit code. If they match, confirm on the Mac. If they don't, cancel:
   something between the phone and your Steward swapped the keys.

The phone makes its own keys (WebCrypto, non-extractable, kept in IndexedDB, never in
`localStorage`): one to receive its data key, one to sign answers, and the data key itself. There
is no master secret to hand over or recover. A lost phone is revoked and a new one paired.

4. On an iPhone, **Share → Add to Home Screen**, open Steward from there, and tap **Turn on
   notifications**. iOS delivers notifications only to apps added to the Home Screen.

### What the relay can see

Which phones are paired (by id), when they connect and from which IP address, how large each
message is and when it was sent, the name of each request (for example `approval.decide`), and your
phone's push address. Not what any message says: chat, approvals and notifications are sealed with
each phone's own key before they leave Steward. Push bodies are sealed too, so Apple and Google see
only an opaque blob and a level.

### Answers from the app

- Every answer is **signed** by the phone's key, with a one-time nonce and a time, for that
  approval. Steward checks all three; a replayed answer is refused and recorded.
- For a send, delete or command after Steward read untrusted content, the app asks for **Face
  ID** first; the assertion is tied to that one answer. Payments, signing and passwords are still
  finished on your Mac.
- The record says "Answered from Sam's iPhone (phone app, Face ID checked)".
- Revoke the phone in Settings → Phone: the relay closes its connection and forgets its token and
  log at once.

What the app may ask is a closed list: `approval.decide`, `chat.send`, `task.start`, `task.hide`,
`routine.run`, `run.stop` and `brief.get`. Rules, settings, connections, secrets, the shell and the
computer are never reachable from it.

## For maintainers: signing a release

iOS imports only signed shortcuts, and only a Mac signed into iCloud can sign one for anyone.

```sh
pnpm --filter @steward/shortcuts sign:release
```

This builds the generic Steward shortcut and the launchers with nothing personal in them, signs
each with `shortcuts sign --mode anyone` (Apple keeps a copy), and writes them with their unsigned
plists and a manifest to `packages/shortcuts/signed/`. Commit those files. A Linux host serves them
as they are.

- Re-sign every release, and at least every 6 months: the certificate lasts about 12.7 months.
- `anyone` signing refuses a file holding a device key (`stw_dev_…`). Personal files are only ever
  signed `people-who-know-me`, on the person's own Mac, at the moment they ask.
- CI checks the plist round trip and the templates on any OS; it cannot sign (no iCloud).
- Action identifiers come from Perspective Cuts' `actions.json` (MIT, iOS 26) in
  `packages/shortcuts/reference/`, plus the few listed in `EXTRA_ACTIONS` with where each was
  checked. Apple renames actions between releases: check them against the current Shortcuts app
  before a release.

## What has been tested

| Part                                            | Status                                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The phone port, keys, codes, scopes and presets | ✅ Unit and integration tests, including a tunnel-shaped request to 8787 being refused and an approval answered from a phone that resumes and is recorded.                                                             |
| The device API and its answers                  | ✅ Tested over HTTP the way the shortcut calls it: `POST` with `{ "text": … }` and the rest in the address.                                                                                                            |
| Building the shortcuts                          | ✅ The plist round-trips; every block closes; every variable points at an earlier action; every action is a known one.                                                                                                 |
| Signing on a Mac                                | ✅ On macOS 26.6 (28 Oct 2026): the generic shortcut (147 actions) signed `people-who-know-me` in about 0.2 s and `anyone` in about 2.9 s; both start with `AEA1`.                                                     |
| Settings → Phone and the Shortcuts page         | ✅ Unit tests and Playwright, with an axe audit.                                                                                                                                                                       |
| **The shortcut on an iPhone**                   | ❌ **Not run on an iPhone yet:** none was available. The action identifiers and parameter keys follow Perspective Cuts and Tempo's builder, and Apple's signer accepted the file, but no phone has imported or run it. |

## To check on a device

These need a real iPhone on iOS 26 and on iOS 27 (the Simulator is not enough). Each answer decides
something; record it here with the date, the iOS version and a screenshot.

| #   | Check                                                                                                                                               | What the answer decides                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Safari download of the signed file: how many taps to reach Add Shortcut, with `Content-Disposition: attachment` (what Steward sends).               | Whether "scan, open, Add" is the right wording, or the page needs another step.                                                                  |
| 2   | Does a `people-who-know-me` file signed on the person's Mac import on their own iPhone with Private Sharing **off**?                                | Whether the one-tap file is offered as is, needs a "switch on Private Sharing" step, or becomes an advanced option.                              |
| 3   | The `run-shortcut` link from a QR code and from Safari: what prompt appears, how long `text` can be, and what happens when the shortcut is missing. | Whether the pairing QR needs a fallback (a typed code) and what the page says when Steward isn't installed yet.                                  |
| 4   | The first Get Contents of URL to a new host: the prompt's wording, and does "Always Allow" survive an update?                                       | The words in step 2 of pairing, and whether updates need a note about allowing again.                                                            |
| 5   | Re-importing a shortcut with the same name: does it replace it or make "Steward 2"?                                                                 | The update notes ("delete the old one") and whether launchers, which call "Steward" by name, keep working.                                       |
| 6   | Global Shortcuts Storage on iOS 27 (Store Content): visible to other shortcuts? Does it sync? Does it survive a re-import?                          | Whether to move the key from the iCloud Drive file to Store Content on iOS 27. Its action identifier also has to be exported from the app first. |
| 7   | An automation embedded in a shortcut on iOS 27: how is it encoded? Export one.                                                                      | Whether the morning brief ships inside the Steward shortcut instead of the hand-made automation.                                                 |
| 8   | Does a file signed with an expired `anyone` certificate still import?                                                                               | How strictly the 6-month re-signing has to be kept.                                                                                              |

Also check what this build assumes but no phone has confirmed:

- **Get File and Save File** with the path `Steward/device.json` (`WFGetFilePath`, `WFFileDestinationPath`, no picker): the file is created, folder included, and read back as a dictionary.
- **Base64 decode** of the pairing text after swapping `-_` for `+/`, with `=` padding.
- **Run Shortcut by name** (`Steward`) from the shortcut itself, for a choice or an answer: a renamed shortcut breaks this.
- **Choose from List** over the labels the server sends, then matching the chosen label.
- **Show Result** read aloud when Siri runs the shortcut, several in a row.
- **Empty headers** (`CF-Access-Client-Id` with no value) are accepted when there is no Access in front.
