# Personalised Apple Shortcuts with no setup: research brief

27 Oct 2026, for Steward (PLAN.md §2–§5). Tested on
macOS 26.6 (25G72) with Shortcuts.app 7.0 (build 4711). The current Apple guides are the iOS 27 /
macOS 27 editions.

**Evidence tags.**
- **[ran]**: done on this Mac today. Commands and outputs are in the scratchpad's `sctest/`.
- **[Apple]**: Apple docs or the man page.
- **[2nd]**: a secondary source, such as a blog, community docs or another project's code.
- **[unverified]**: not confirmed on iOS 26/27. **No iPhone was available**, so nothing was tried on
  a device.

---

## 0. Findings in short

1. **Format.** A `.shortcut` file is a plist (`WFWorkflowActions` and so on) inside an **Apple
   Encrypted Archive** (AEA1, profile 0: signed, not encrypted). Since iOS 15, iOS imports only
   signed files. Only macOS can sign (`shortcuts sign`), apart from the Shortcuts app's own share
   flow.
2. **The two signing modes behave very differently [ran].**
   - `anyone` takes about 2.5 s, **needs network and iCloud**, and **sends Apple a copy**
     ("notarize via iCloud"). Each run gets a fresh Apple leaf certificate valid for about 13 months.
   - `people-who-know-me` takes about 0.06 s and **signs locally**. It embeds your Apple ID's
     identifiers and hashed email and phone, and only "your devices" or your contacts can import it.
3. **Never put a secret in an `anyone`-signed file.** Apple gets the file, and an iCloud share
   would make it public.
4. **Delivery that works today:** a signed file over HTTPS (`application/octet-stream` plus
   `Content-Disposition: filename=X.shortcut`, as Shiori serves it [ran]). Safari downloads it,
   then **Add Shortcut** [2nd]. Two other routes are dead ends:
   - `import-shortcut?url=` is gone from the iOS 26/27 guide and reportedly takes iCloud URLs only
     [2nd].
   - iCloud links can't be created programmatically. They can only be read, through
     `icloud.com/shortcuts/api/records/<id>` [ran].
5. **`shortcuts://run-shortcut?name=…&input=text&text=…`** and its x-callback form are still
   documented for iOS 27 [Apple]. They can hand a pairing code to an installed generic shortcut
   from a QR code.
6. **iOS 27 adds three things that matter.**
   - **Shortcuts Storage** (`Store Content`, local or "global", synced via iCloud) can hold the
     device token.
   - **Automations can be built into shared shortcuts**; they arrive off, behind one toggle.
   - **Describe a Shortcut** creates shortcuts from a description [Apple, 2nd].
7. **RoutineHub** shares one public shortcut with everyone. It has a key-less version API
   (`/api/v1/shortcuts/<id>/versions/latest`) [ran] that UpdateKit-style updaters poll. HubSign
   (paid) refused connections today, and the community is moving to Shortcuty (no auth, `anyone`
   only) [ran]. **Nothing there is per-user.**
8. **Tools.** Cherri is the only well-maintained one, but it is **GPL-2.0**, so its code can't go
   into MIT Steward. Perspective Cuts (MIT) has an `actions.json` of iOS 26 actions we can reuse.
   ScPL, python-shortcuts, shortcuts-js and Jellycore are stale (the last two are GPL).
   **Write our own small TypeScript builder** from Tempo's helpers and templates exported from the
   app.
9. **Linux.** `0xilis/shortcut-sign` only contact-signs, with keys dumped from a jailbroken device.
   Signing servers need real macOS. GitHub macOS runners fail with "must be signed into iCloud"
   [ran]. **Ship a generic pre-signed file and pair at run time.**
10. **Native later.** App Shortcuts work "as soon as someone installs your app" [Apple]. The
    official **`expo-app-intents`** (MIT, alpha, SDK 58, published 8 Jun 2026) and
    `@bacons/apple-targets` bring them to Expo [ran]. PLAN §8 puts mobile apps outside v0.1.
11. **Recommended design.**
    - Pair with a **one-time code from a QR code that opens `run-shortcut`**.
    - Serve the phone from a **separate listener that accepts only device tokens**, through
      Tailscale Serve or a Cloudflare Tunnel with Access.
    - Keep the token in Shortcuts Storage on iOS 27. On iOS 26, or for a one-tap Mac install, use a
      **personalised `people-who-know-me` file**.
    - **Watch out:** `originGuard` lets requests with no `Origin` through, so adding a tunnel host
      to `STEWARD_ALLOWED_HOSTS` would expose the whole API with no authentication (§6.4).

---

## 1. The `.shortcut` file format today

### 1.1 Unsigned workflow plist

The workflow is a property list. `shortcuts sign` accepts **both binary (`bplist00`) and XML
input [ran]**, so Steward can emit XML from TypeScript with no extra dependency.

**Top-level keys.** Sources: Tempo's `build_shortcut.py`,
[zachary7829](https://zachary7829.github.io/blog/shortcuts/fileformat),
[sebj](https://github.com/sebj/iOS-Shortcuts-Reference).

| Key                                                                          | Purpose                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WFWorkflowActions`                                                          | An array of `{WFWorkflowActionIdentifier: "is.workflow.actions.<id>", WFWorkflowActionParameters: {…}}`                                                                                                                                    |
| `WFWorkflowClientVersion` / `WFWorkflowMinimumClientVersion(String)`         | Version gate. Tempo uses `"2700.0.4"` / `900`.                                                                                                                                                                                             |
| `WFWorkflowIcon`                                                             | `{WFWorkflowIconStartColor, WFWorkflowIconGlyphNumber}`                                                                                                                                                                                    |
| `WFWorkflowImportQuestions`                                                  | `[{ActionIndex, Category:"Parameter", ParameterKey, Text, DefaultValue}]`, asked as a setup step ([Apple](https://support.apple.com/guide/shortcuts/add-import-questions-to-shared-shortcuts-apdf330fd3a0/ios); key names from sebj [2nd]) |
| `WFWorkflowTypes`                                                            | For example `["ActionExtension"]` (share sheet) or `["Watch"]`                                                                                                                                                                             |
| `WFWorkflowInputContentItemClasses`, `…Output…`, `WFWorkflowNoInputBehavior` | Input and output types, and what happens with no input                                                                                                                                                                                     |

**How variables are stored.** A parameter that uses a variable is
`{WFSerializationType: "WFTextTokenString", Value: {string: "…￼…", attachmentsByRange: {"{0, 1}": {Type: "ActionOutput", OutputUUID, OutputName}}}}`.
Any action that produces output carries a `UUID`. Tempo's `text()`, `output()` and `attachment()`
already implement this (`tempo/apps/shortcuts/build_shortcut.py`, lines 45–96).

**Signing rewrites the plist [ran].** I signed a hand-built two-action plist (`gettext` +
`showresult`) and unpacked the result.
- `WFWorkflowClientVersion` had become `4711`.
- `WFQuickActionSurfaces`, `WFWorkflowHasOutputFallback`, `WFWorkflowHasShortcutInputVariables`
  and `WFWorkflowOutputContentItemClasses` had been added.

So Apple's migrator runs on the input. On **macOS 14.6**, hand-written plists were rejected with
"isn't in the correct format"
([DEV, 2026](https://dev.to/eugeniya_ivanova_4a58eadc/i-tried-to-build-an-apple-shortcut-from-code-apple-said-no-four-times-4l5d)).
On **macOS 26.6**, minimal binary and XML plists both signed. **A non-plist input crashes the CLI**
with an uncaught `NSInvalidArgumentException` in `WFWorkflowMigrator` (exit 134) [ran], so validate
input first.

### 1.2 Signed container (measured on this Mac)

```
"AEA1" | u32 profile=0 | u32 authLen | authData (bplist) | AEA segments → Apple Archive → Shortcut.wflow (bplist)
```

- **Profile 0 is `hkdf_sha256_hmac__none__ecdsa_p256`** (from `aea -h`): signed, **not encrypted**.
- **Unpacking works with Apple's own tools [ran].**
  `aea decrypt -i f.shortcut -o f.aar -sign-pub leafpub.pem && aa extract -i f.aar -d out/`
  produces `out/Shortcut.wflow`.
- **Tempo's `Tempo-Delay-Spotter.shortcut` has the same layout.**

### 1.3 Signing modes

`shortcuts sign [--mode anyone|people-who-know-me] --input X --output Y`. The default is
`people-who-know-me` [ran `shortcuts help sign`].

|                                                                                               | `anyone`                                                                                                                                                                                                                                                                                      | `people-who-know-me`                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Man page (`man shortcuts`, macOS 26.6)                                                        | "will notarize via iCloud, and allow anyone to import the shortcut"                                                                                                                                                                                                                           | "will sign locally, but only your devices, or people who have your contact info in their contacts, will be able to import"                                                                                                                                                                                                            |
| Apple guide ([Mac](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac), macOS 27) | "When you sign a shortcut, Apple receives a copy for validation"                                                                                                                                                                                                                              | "Your contact info will be included in the shortcut file"                                                                                                                                                                                                                                                                             |
| Time [ran]                                                                                    | 2.76, 2.83, 2.88, 2.05, 1.98 s. One run failed after 4.4 s with `Error: Failed to modify some records`, a CloudKit partial-failure message (Tempo saw the same as "HTTP 500 once" and retries ×3).                                                                                            | 0.09, 0.22, 0.06, 0.06 s (local)                                                                                                                                                                                                                                                                                                      |
| Auth data [ran]                                                                               | `SigningCertificateChain`: leaf `CN=<random hex>, O=Apple Inc.` issued by _Apple System Integration CA 4_ → _Apple Root CA – G3_.**New leaf every run** (different serials). notBefore is about 10 min before signing; **notAfter is +12.7 months**; there is an OCSP URL (Apple can revoke). | `AppleIDCertificateChain` (leaf `com.apple.idms.appleid.prd.<uuid>`, valid Sep 2026–Oct 2027), `SigningPublicKey` (P-256), `SigningPublicKeySignature`, `AppleIDValidationRecord` (CMS-signed plist: `altDsID`, `encDsID`, `ValidatedEmailHashes`, `ValidatedPhoneHashes`, `ValidAsOf`, `SuggestValidDuration = 2592000` s = 30 days) |
| Output size, 875-byte input                                                                   | 21.8 KB                                                                                                                                                                                                                                                                                       | 26.5 KB                                                                                                                                                                                                                                                                                                                               |
| Leaks                                                                                         | The whole shortcut goes to Apple                                                                                                                                                                                                                                                              | The signer's Apple ID identifiers and hashed contacts                                                                                                                                                                                                                                                                                 |
| Who can import                                                                                | Anyone                                                                                                                                                                                                                                                                                        | The signer's own devices, and contacts. On iOS, contact-shared shortcuts need **Settings → Shortcuts → Private Sharing** on ([Apple privacy page](https://support.apple.com/guide/shortcuts/apd961a4fc65/ios)). **Whether the signer's own iPhone needs that toggle is [unverified].**                                                |

**Requirements.**
- **macOS 12 or later, and a logged-in user signed in to iCloud.** A GitHub `macos-latest` runner
  (macOS 26.6.2) failed `--mode anyone` with **"Error: In order to do this, you must be signed into
  iCloud."** (public run log of [echo-zaq/shortcut-sign](https://github.com/echo-zaq/shortcut-sign),
  13 Oct 2026).
- **A GUI session.** [scaxyz](https://github.com/scaxyz/shortcut-signing-server) says "signal:
  abort trap" means nobody is logged in through the UI, and the DEV post hit the iCloud error under
  `launchctl asuser`. So sign from the user's Aqua session: Steward started from a terminal or a
  LaunchAgent, not a LaunchDaemon [2nd].
- **Re-signing an already-signed file works** (exit 0) [ran].

**Expiry [unverified].** The iCloud record of a public share carries
`signingCertificateExpirationDate` and `signingStatus: APPROVED` [ran]. One 2022 share has an
expiry of 2026-12-23 and was modified 2025-11-28, which suggests Apple re-signs shares
periodically. Shiori's live file was signed 16 Feb 2026 (expires 11 Mar 2027) and is still being
served [ran]. Assume a file stops importing once its leaf certificate expires (about 1 year for
`anyone`; possibly 30 days for the `people-who-know-me` validation record). **Re-sign on every
download; it is cheap.**

### 1.4 Signing without macOS (Linux)

| Route                                                                                                                          | What it is                                                                                                                                                                                                        | Status                                                                                                                              | Risk                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0xilis/shortcut-sign](https://github.com/0xilis/shortcut-sign) + [libshortcutsign](https://github.com/0xilis/libshortcutsign) | MIT, C, Linux + macOS; sign / resign / extract / verify                                                                                                                                                           | Active (pushed 13 Apr 2026). 42 and 24 stars.                                                                                       | **Contact-signing only.** It needs _your_ Apple ID private key, cert and validation record, dumped with [appleid-key-dumper](https://github.com/0xilis/appleid-key-dumper) (no licence) from a **jailbroken iPhone or an AMFI-disabled Mac**. The README says validation-record checks are not implemented. Extracting Apple ID keys is very likely outside Apple's terms. Not a product path. |
| HubSign (RoutineHub)                                                                                                           | `POST https://hubsign.routinehub.services/sign` with JSON `{shortcutName, shortcut: <XML plist>}`, returning AEA1. Taken from [Cherri `signing.go`](https://github.com/electrikmilk/cherri/blob/main/signing.go). | Paid ("To sign shortcut, a Developer subscription is required", RoutineHub changelog banner). **Connection reset on 27 Oct [ran].** | A third party sees every shortcut. Never send a personalised one.                                                                                                                                                                                                                                                                                                                              |
| [Shortcuty](https://github.com/Shortcuty/Signing-Server-API-Documentation)                                                     | `POST https://sign.shortcuty.app/api/v1/sign` (multipart `file`). **No authentication.** `anyone` mode only. 64 MiB in, 2 concurrent signings.                                                                    | Up today. `GET /api/v1` answered [ran]. The operator is unknown.                                                                    | Same as HubSign. It is also on top of Apple's own copy.                                                                                                                                                                                                                                                                                                                                        |
| [scaxyz/shortcut-signing-server](https://github.com/scaxyz/shortcut-signing-server)                                            | Unlicense, Go. HTTP wrapper around `shortcuts sign` on a real Mac.                                                                                                                                                | Stale (2023).                                                                                                                       | Fine on your own Mac. Its "docker-osx" guide breaks the macOS licence (VMs only on Apple-branded hardware you own [2nd: [eclecticlight](https://eclecticlight.co/2022/08/04/virtualisation-on-apple-silicon-macs-8-how-apple-limits-vms/), [threedots](https://threedots.ovh/blog/2020/12/macos-eula-licensing-restrictions-affecting-virtualisation/)]).                                      |
| Mass signing for other people with one Apple ID                                                                                | —                                                                                                                                                                                                                 | —                                                                                                                                   | zachary7829 warns Apple can ban the signing identity if someone signs malicious content [2nd].                                                                                                                                                                                                                                                                                                 |
| CI on GitHub macOS runners                                                                                                     | `shortcuts sign`                                                                                                                                                                                                  | **Fails** (no iCloud) [ran, run log]                                                                                                | —                                                                                                                                                                                                                                                                                                                                                                                              |

**On Linux, don't sign at runtime.** Ship a generic, secret-free, `anyone`-signed shortcut with
each release, signed by a maintainer on a Mac (as Tempo does) at least every 6 months, and
personalise it by pairing (§6).

---

## 2. Every way to get a shortcut onto an iPhone from a web page

| Channel                                                                       | Works today?                                                                                                                                                                  | Personalised per user?                               | Notes                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Signed `.shortcut` over HTTPS, opened in Safari**                           | **Yes** [2nd + live example]                                                                                                                                                  | Yes, if Steward signs the file                       | See 2.1                                                                                |
| AirDrop / Files / Mail attachment                                             | Yes ([Apple](https://support.apple.com/guide/shortcuts/apdf01f8c054/ios): "Recipients who open the file … tap Add Shortcut")                                                  | Yes                                                  | Manual hand-off                                                                        |
| **iCloud link** `https://www.icloud.com/shortcuts/<32-hex>`                   | Yes, for opening                                                                                                                                                              | **No programmatic creation**                         | See 2.2                                                                                |
| `shortcuts://import-shortcut?url=…&name=…&silent=`                            | **Don't rely on it**                                                                                                                                                          | —                                                    | See 2.3                                                                                |
| **`shortcuts://run-shortcut?name=…&input=text&text=…`**                       | **Yes** ([Apple, iOS 27 guide](https://support.apple.com/guide/shortcuts/apd624386f42/ios))                                                                                   | Delivers data to an _installed_ shortcut             | See 2.4                                                                                |
| **`shortcuts://x-callback-url/run-shortcut?…&x-success=&x-cancel=&x-error=`** | **Yes** ([Apple](https://support.apple.com/guide/shortcuts/apdcd7f20a6f/ios))                                                                                                 | Same as above, and returns `result` / `errorMessage` | See 2.4                                                                                |
| Import Questions                                                              | Yes ([Apple](https://support.apple.com/guide/shortcuts/add-import-questions-to-shared-shortcuts-apdf330fd3a0/ios))                                                            | The user types answers                               | This _is_ manual setup. Use it only as a fallback, with the `DefaultValue` pre-filled. |
| Other URL commands                                                            | `shortcuts://`, `create-shortcut`, `open-shortcut?name=`, `gallery`, `gallery/search?query=` ([Wikipedia list citing Apple](https://en.wikipedia.org/wiki/Shortcuts_(Apple))) | —                                                    | `open-shortcut` is a handy "show me the shortcut" link                                 |

### 2.1 Signed file over HTTPS

**A live production example [ran].** `GET https://www.shiori.sh/Shiori.shortcut` returns
`content-type: application/octet-stream` and `content-disposition: inline; filename="Shiori.shortcut"`,
with an `anyone`-signed AEA1 body. [Their docs](https://www.shiori.sh/docs/ios-shortcut) (iOS 16+)
describe the flow: Safari asks to download the file, you open it from Safari's Downloads, and
Shortcuts shows a preview with the blue **Add Shortcut** button. Shiori then has the user **paste a
code into a header by hand**, which is the step we want to remove.

**No MIME type is registered [ran].** `Shortcuts.app/Contents/Info.plist` exports the UTIs
`com.apple.shortcut` (`.shortcut`, conforms to `public.data`) and
`com.apple.shortcuts.workflow-file` (`.wflow`), but declares no `public.mime-type`. The URL
schemes are `shortcuts`, `workflow` and `shortcuts-production`. So the hand-off follows the
**filename extension**: send `Content-Disposition` with `filename="Steward.shortcut"`;
`application/octet-stream` is fine.

**[unverified on iOS 26/27]:** whether `attachment` saves a tap compared with `inline`; the exact
tap count; and what Add Shortcut does when a shortcut with the same name already exists.

### 2.2 iCloud links

- **Creating.** Only the Shortcuts app can create one (Share → Copy iCloud Link, with iCloud Sync
  on). There is **no `shortcuts share` command**: the CLI offers `run`, `list`, `view` and `sign`
  [ran]. UI-scripting the Mac app is the only automated route, and it is fragile. It would also
  put a personalised file on a public URL anyone can open. The
  [DEV post](https://dev.to/eugeniya_ivanova_4a58eadc/i-tried-to-build-an-apple-shortcut-from-code-apple-said-no-four-times-4l5d)
  agrees: "only the app can create iCloud links".
- **Reading.** `GET https://www.icloud.com/shortcuts/api/records/<id>` needs no sign-in today
  [ran]. It returns a `SharedShortcut` record with `name`, icon fields,
  `shortcut.value.downloadURL` (the unsigned plist; replace `${f}`),
  `signedShortcut.value.downloadURL`, `signingStatus`, `signingCertificateExpirationDate` and
  `maliciousScanningContentVersion`. It is undocumented; use it to read reference shortcuts.
- **What the recipient sees.** A page with **Get Shortcut**, which opens Shortcuts and adds it
  ([Apple](https://support.apple.com/guide/shortcuts/apdf01f8c054/ios)).

### 2.3 `import-shortcut`

- **Documentation.** It was documented in the Shortcuts 2.0 / iOS 12 guide
  ([page](https://support.apple.com/en-la/guide/shortcuts/apd77a47304b/2.0/ios/12.0)). Today that
  URL redirects to the guide's welcome page, and the iOS 27 table of contents lists only
  open/create/run, the Gallery, x-callback and other apps' schemes [Apple, fetched 27 Oct].
- **Reports.** In 2023, Shortcuts crashed after importing from a GitHub raw URL
  ([forum 726203](https://developer.apple.com/forums/thread/726203)). In 2026 on macOS 14.6, it
  answered "Import failed: the specified shortcut URL is invalid" for HTTPS gist URLs, which
  suggests it only accepts iCloud links (DEV post).
- **Verdict.** Not tested here, because testing would add a shortcut to the user's iCloud library.
  Treat it as gone.

### 2.4 `run-shortcut` / x-callback for pairing

- **Syntax** ([Apple, iOS 27 guide](https://support.apple.com/guide/shortcuts/apd624386f42/ios)):
  `shortcuts://run-shortcut?name=Steward&input=text&text=<urlencoded>`, or `input=clipboard`. The
  x-callback form is `shortcuts://x-callback-url/run-shortcut?…&x-success=<url>`; `x-success`
  receives `result=<output>` and `x-error` receives `errorMessage`.
- **Still present on macOS.** In the macOS 26.6 dyld cache, `WFRunWorkflowURLHandler` registers
  `run-shortcut`/`run-workflow` and `open-shortcut`/`open-workflow` [ran]. A Camera QR scan or a
  Safari link shows iOS's usual "Open in Shortcuts?" prompt [unverified on 27].
- **Security.** **Any web page can fire this URL with any text**, so treat the input as untrusted
  (§6.3). Prefer `input=text`: the clipboard route adds a paste prompt and leaves the code on the
  shared pasteboard.

### 2.5 iOS 26/27 changes that matter

**iOS 27** ([Apple "New in … 27"](https://support.apple.com/en-us/149045), 26 Oct 2026;
[MacStories](https://www.macstories.net/stories/ios-and-ipados-27-review/12/)):
- **Shortcuts Storage.** The actions are `Store Content`, `Get Stored Content`,
  `Delete Stored Content` and `Add Item to List`.
  - A stored value belongs to one shortcut, or is **"global"**: "saved in a special shared space in
    iCloud" and readable by all of the user's shortcuts.
  - It is not a distribution channel: people you share a shortcut with don't get your values.
  - Apple's WWDC example for a global value is an API key [2nd].
- **"Automations are now built directly into shortcuts, including shared shortcuts"** [Apple].
  Imported automations arrive switched off, and the user flips one toggle [MacStories]. So a
  Steward shortcut could ship with a ready "08:00 brief" trigger.
- **Describe a Shortcut** builds a shortcut from natural language (iPhone 15 Pro or later). It
  can't use third-party apps yet.
- **Action identifiers keep changing**
  ([Automators](https://talk.automators.fm/t/os-26-27-new-and-updated-actions/19177)); for
  example, `getonscreen…` changed. **Generate from templates exported from the current app.**

**iOS 26** added the **Use Model** action, 25+ other actions, and automations on the Mac
([9to5Mac](https://9to5mac.com/2025/12/09/ios-26s-shortcuts-app-adds-25-new-actions-heres-everything-new/)).

**First-run prompts still apply.** Expect Allow Once / Always Allow / Don't Allow data prompts
([Apple](https://support.apple.com/guide/shortcuts/apd961a4fc65/ios)), and probably a prompt the
first time `Get Contents of URL` reaches a new host [unverified wording]. So "zero setup" really
means **one Add Shortcut tap plus one Allow**.

---

## 3. How RoutineHub works

- **Distribution.** Authors publish versions: an iCloud link or a signed file, plus notes and a
  version string. Users tap through to **Get Shortcut**. One shortcut serves everyone; personal
  data comes later from Import Questions, prompts or stored files.
- **API.** The changelog's 12 Oct 2018 entry reads "Basic API for RoutineHub added" alongside
  "UpdateKit and RoutinePub support" ([changelog](https://routinehub.co/changelog/), Jan 2026 archive
  copy; the live site sits behind a Cloudflare bot check).
  - `GET https://routinehub.co/api/v1/shortcuts/<id>/versions/latest` needs no key [ran, 5 ids].
    It returns `{"result":"success","id":58884,"Version":"6.6","URL":"https://routinehub.co/shortcut/5256/","Notes":"…","Release":"July 01, 2026"}`.
  - Today `URL` is the RoutineHub page. [Older docs](https://extratone.github.io/RoutineHub-API)
    describe it as the iCloud link.
- **The update-checker pattern** (UpdateKit, UpdateHub):
  1. The shortcut embeds its id and version.
  2. It polls `versions/latest`, typically about once a day.
  3. If the version differs, it shows the notes and opens the URL.
  4. The user taps Add Shortcut.

  **Copy this pattern with Steward's own manifest** (§6.6).
- **HubSign.**
  - Launched 19 Sep 2024: "Simplify shortcut signing via API or web form". A banner says a
    **Developer subscription is required**.
  - Its endpoint is in Cherri's source (§1.4). It **reset connections today** [ran].
  - A note on the "Shortcut Source Helper" shortcut (15 Sep 2026) reads "Remote Sign now uses
    Shortcuty" [ran].
  - RoutineHub also markets **BuildHub**, an AI shortcut builder.
- **Terms [unverified].** `/terms` is behind a Cloudflare bot check, which I did not bypass, and
  the archive copy returned 403. Steward needs only the pattern, never RoutineHub's infrastructure.

---

## 4. Open-source tools (checked with `gh api` on 27 Oct 2026)

| Repo                                                                                                                           | Licence            | Lang   | Last push                                | Stars   | Current actions?                                                                                                                                                                | Signing                                                                                               | Verdict                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------ | ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [electrikmilk/cherri](https://github.com/electrikmilk/cherri)                                                                  | **GPL-2.0**        | Go     | 2026-10-14 (release v2.3.0, 23 May 2026) | 1659    | Yes. It also reads the Mac's **ToolKit DB** (`~/Library/Shortcuts/ToolKit/Tools-active`, needs Full Disk Access) for every installed action, including third-party App Intents. | `shortcuts sign` (default `people-who-know-me`, `--share anyone`), then HubSign or `--signing-server` | Best maintained. **Can't copy into MIT Steward.** Fine to _run_ as a separate CLI, or read for reference. |
| [taylorarndt/perspective-cuts](https://github.com/taylorarndt/perspective-cuts)                                                | **MIT**            | Swift  | 2026-04-25                               | 182     | 180+ actions incl. iOS 26 Apple Intelligence (`Sources/perspective-cuts/Resources/actions.json`, v2.0.0). No iOS 27 Storage actions yet.                                        | `shortcuts sign` only                                                                                 | **Copy `actions.json` as reference data.** Self-described "highly experimental".                          |
| [pfgithub/scpl](https://github.com/pfgithub/scpl)                                                                              | MIT                | TS     | 2021-07-25                               | 289     | **No.** README: "not been updated to support the new iOS 13/14+ actions".                                                                                                       | none                                                                                                  | Stale. Its parser ideas are MIT.                                                                          |
| [joshfarrant/shortcuts-js](https://github.com/joshfarrant/shortcuts-js)                                                        | **GPL-3.0**        | TS     | 2023-06 (archived)                       | 1754    | iOS 12                                                                                                                                                                          | none                                                                                                  | Don't use.                                                                                                |
| [alexander-akhmetov/python-shortcuts](https://github.com/alexander-akhmetov/python-shortcuts)                                  | MIT                | Python | 2024-04 (archived)                       | 669     | Old                                                                                                                                                                             | none                                                                                                  | Don't use.                                                                                                |
| [OpenJelly/Open-Jellycore](https://github.com/OpenJelly/Open-Jellycore) (Jellycuts compiler)                                   | **GPL-3.0**        | Swift  | 2024-06-10                               | 122     | Outdated (Perspective Cuts' author says it lacks iOS 26 actions)                                                                                                                | via HubSign in RoutineHub's flow                                                                      | Don't use.                                                                                                |
| [sebj/iOS-Shortcuts-Reference](https://github.com/sebj/iOS-Shortcuts-Reference)                                                | none               | docs   | 2022 (archived)                          | 221     | Format docs (keys, import questions, `WFWorkflowTypes`)                                                                                                                         | —                                                                                                     | Read only.                                                                                                |
| [zachary7829 format doc](https://zachary7829.github.io/blog/shortcuts/fileformat)                                              | —                  | docs   | undated                                  | —       | Format + iOS 15 signing history                                                                                                                                                 | —                                                                                                     | Read only.                                                                                                |
| [electrikmilk/preview-shortcut](https://github.com/electrikmilk/preview-shortcut)                                              | **MIT**            | TS     | 2026-09-30                               | 44      | Renders a shortcut preview from plist/JSON                                                                                                                                      | —                                                                                                     | **Use it** to show "what you are about to install" on Steward's pairing page.                             |
| [drewburchfield/shortcuts-toolkit](https://github.com/drewburchfield/shortcuts-toolkit)                                        | MIT                | JS     | 2025-09                                  | 49      | —                                                                                                                                                                               | Claims "no cryptographic signing involved"                                                            | **Wrong for iOS 15+**; ignore.                                                                            |
| [0xilis/libshortcutsign](https://github.com/0xilis/libshortcutsign) / [shortcut-sign](https://github.com/0xilis/shortcut-sign) | MIT                | C      | 2026-04-13                               | 24 / 42 | —                                                                                                                                                                               | Contact-signing with dumped keys                                                                      | See §1.4. Its `extract`/`verify` features are handy for CI checks on Linux.                               |
| Tempo `apps/shortcuts/build_shortcut.py`                                                                                       | Steward's own team | Python | —                                        | —       | 2700-era identifiers; not imported on a device yet                                                                                                                              | `shortcuts sign --mode anyone`, retry ×3                                                              | **The template to port.**                                                                                 |

**Recommendation.** Write a small TypeScript builder in Steward (MIT) that emits XML plist, by
porting Tempo's `act()`, `text()`/`attachment()`, if/otherwise/end, `set_variable` and `notify`.
Build the reference shortcut once in Shortcuts.app, export it, unpack it (`aea decrypt` +
`aa extract`) and commit the fragments as templates. Check parameter keys against Perspective Cuts'
`actions.json`. In CI, decode and diff the signed output.

---

## 5. The native alternative: App Intents / App Shortcuts

**What App Shortcuts give you.** You write an `AppShortcutsProvider` with
`AppShortcut(intent:phrases:shortTitle:systemImageName:)` entries. Apple says these shortcuts "are
available as soon as someone installs your app, and you don't have to register them yourself",
and they appear in the **Shortcuts app, Siri and Spotlight**
([App Shortcuts doc](https://developer.apple.com/documentation/appintents/app-shortcuts), read
through its JSON). They exist from iOS 16 and macOS 13. An app can have at most **10**, and each
phrase must contain `\(.applicationName)` ([Expo docs](https://docs.expo.dev/versions/latest/sdk/app-intents/)).
**This is the only truly zero-setup route, and credentials live in the Keychain.**

**Where else they appear.**
- **The Action button** (iPhone 15 Pro and later). Under **Shortcut** it lists apps' App
  Shortcuts, and under **Controls** it lists App Intent-based `ControlWidget`s (iOS 18+). Source:
  [MacRumors](https://macrumors.com/guide/iphone-16-action-button) [2nd].
- **Control Center and the Lock Screen**, through the same controls.
- **Spotlight on Mac** (macOS 26) and **Apple Intelligence** entities.

**React Native / Expo.**
- **[`expo-app-intents`](https://docs.expo.dev/versions/latest/sdk/app-intents/)** is official
  Expo [ran].
  - Facts: lives in the `expo/expo` monorepo, MIT, npm `0.5.13`, first published **8 Jun 2026**,
    updated 27 Oct 2026. Status is **alpha** ("frequent breaking changes"). Needs Expo SDK 58 and
    iOS 16.4+, and **does not run in Expo Go**.
  - How it works: Swift intent types go into the app target through Inline Modules, because
    "Apple's build-time metadata extraction does not see code in static pods". JavaScript
    receives calls through `useAppIntents`, or through a background task via
    `expo-task-manager` (30 s timeout).
  - Supports `AppShortcutsProvider` (phrases fixed at build time) and Spotlight-indexed
    entities.
- **[`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets)** (v5.0.0; MIT on
  npm, no LICENSE file in the repo) adds `app-intent`, `widget` (including controls) and
  `intent`/`intent-ui` targets.
- **Avoid** `react-native-siri-shortcut` (SiriKit, last push 2023).

**Trade-off for Steward.**
- **Gains:** zero setup, Keychain storage, **APNs push for approvals** (Shortcuts cannot receive
  pushes), and actionable notifications.
- **Costs:** an Apple Developer Program account, TestFlight / App Store review, and an EAS or
  Xcode build.
- **Fit:** PLAN §8 rules out mobile apps for v0.1. Treat Shortcuts as the v0.x bridge and an Expo
  app as v1, with **both on the same device API (§6.5)**.

---

## 6. Recommended design for Steward

### 6.1 Principles

1. **No long-lived secret leaves the Mac in a file that Apple or a third party can see.** So
   `anyone` signing, iCloud links, HubSign and Shortcuty are only for generic files that hold no
   secret.
2. **The phone holds a scoped, revocable device token, never "Steward itself".** Steward has no
   sign-in: "anyone who can reach its port can use it as you" (`docs/security.md`).
3. **The shortcut is a thin client.** Its logic and wording live on the server, so most changes
   need no re-import.
4. **It fails closed and stays honest (PLAN §2).**
   - Every phone action goes through the gateway and is recorded as coming "from iPhone (device X)".
   - Pay, sign and credential steps are never decided from a shortcut. The phone shows "Open
     Steward on your Mac to finish this" instead.

### 6.2 Flows

**A. Generic shortcut plus a pairing link.** This is the default, and it also works when Steward
runs on Linux.

1. **The release ships a generic file.** `assets/shortcuts/Steward.shortcut` holds no URL or token
   and is `anyone`-signed by a maintainer on a Mac. Steward serves it at
   `/device/shortcut/Steward.shortcut`. On a Mac, Steward re-signs it at serve time once it is
   more than 90 days old.
2. **Settings → Phone → Add iPhone shows two QR codes** (or two buttons when the page is opened on
   the phone).
   - **QR 1**, needed only once, points at `https://<device-host>/device/shortcut/Steward.shortcut`.
   - **QR 2** is `shortcuts://run-shortcut?name=Steward&input=text&text=steward-pair:1:<base64url({"u":"https://<device-host>","c":"<8-char code>","n":"<Mac name>"})>`.
3. **The shortcut asks before pairing.** It checks the prefix, then asks **"Pair with Steward on
   <Mac name> at <host>?"** with Pair and Cancel. This is the defence against hostile pages (§6.3).
4. **It exchanges the code for a token.** `POST {u}/device/pair {code, deviceName}` returns
   `{token, deviceId, scopes, minShortcutVersion}`. The code is single-use, lasts 10 minutes,
   allows 5 attempts, and is bound to the device host.
5. **It stores `{u, token}`.**
   - **iOS 27:** `Store Content`, global key `steward.device`, so the token survives updates.
     Per-shortcut storage is safer but is lost on re-import.
   - **iOS 26:** `Save File` to `Shortcuts/Steward/device.json` in iCloud Drive. Other shortcuts
     can read it and it syncs, which is the same exposure as global storage.
6. **The Mac confirms.** Its Settings card polls `GET /api/devices` and turns green when the phone
   has paired.

**B. Personalised one-tap file.** This needs a Mac. It suits iOS 26, or anyone who wants a single
step.

1. **Build.** Steward builds the file with `{u, token}` inside. The token is new and marked
   `delivery: file`.
2. **Sign locally** with **`people-who-know-me`** (about 60 ms, nothing sent to Apple) [ran].
3. **Serve it once** at `GET /device/install/<128-bit id>.shortcut`. The link is single-use and
   lasts 10 minutes. The token stays _pending_ until the shortcut first calls.
4. **On the phone.** Scan the QR code, download, tap **Add Shortcut**, then allow the network
   prompt on first run. Remind the user to delete the download.

**Test before relying on B [unverified]:**
- **Private Sharing.** Does the signer's own iPhone import the file with Private Sharing off? If it
  needs the toggle, say so up front, or fall back to A.
- **Never fall back to `anyone` signing with a token inside.**
- **The 30-day validity.** It doesn't matter here, because the link is used within 10 minutes.

### 6.3 Getting the per-user secret in safely

| Option                                           | No typing          | Secret seen by Apple or a third party     | Survives shortcut update      | Works on Linux host | Notes                                    |
| ------------------------------------------------ | ------------------ | ----------------------------------------- | ----------------------------- | ------------------- | ---------------------------------------- |
| Token baked into an `anyone`-signed file         | ✓                  | **Yes (Apple)**, and iCloud too if shared | ✗ (new file each time)        | needs signer        | **Rejected**                             |
| Token baked into a `people-who-know-me` file (B) | ✓                  | No                                        | ✗ (new file, new token; fine) | ✗                   | Own devices only; contact hashes in file |
| Generic file + `run-shortcut` text pairing (A)   | ✓ (scan 2 QRs)     | No                                        | ✓ with global storage         | ✓                   | Recommended default                      |
| Generic file + clipboard pairing                 | ✓                  | No (but on the pasteboard)                | ✓                             | ✓                   | Paste prompt; weaker                     |
| Import Questions with defaults                   | ✗ (confirm screen) | Depends on signing                        | ✗                             | needs signer        | Fallback only                            |
| Shiori-style "paste code into header"            | ✗                  | No                                        | ✗                             | ✓                   | What we're replacing                     |

**Defences against pairing by URL.** _Any_ web page can open
`shortcuts://run-shortcut?name=Steward&input=text&text=…`.
- **Pairing.**
  - Always show the host and the Mac's name, and require a tap.
  - Refuse plain `http`, except for RFC 1918 and `.local` hosts, which get a warning.
  - On a re-pair, show the old host too.
  - Read only `u`, `c` and `n` from the input.
- **Tokens.**
  - 256-bit random, never shown in chat (rule 3).
  - Stored **hashed** (SHA-256), with scopes and `lastSeen`.
  - Revocable in Settings → Phone.
- **The pair endpoint.** Rate-limit `/device/pair`, and record every pairing.

### 6.4 How the phone reaches a loopback server

**Today's hazard (code checked).**
- `originGuard` in `apps/server/src/http/security.ts` **lets through mutating requests that have
  no `Origin` and no `Sec-Fetch-Site`** ("come from programs … allowed").
- `hostGuard` accepts any name listed in `STEWARD_ALLOWED_HOSTS`.
- So exposing `127.0.0.1:8787` through a tunnel and listing its host, as `docs/security.md`
  suggests for a VPN, would let **any program on the internet** drive all of `/api/*`, including
  approvals, chat and the computer, with **no authentication**.

**Fix: a separate device listener.** Run a second Hono app on `127.0.0.1:8788`
(`STEWARD_DEVICE_PORT`). It mounts **only** `/device/*`, requires a bearer device token on every
route except `pair` and the static download, and has its own Host allow-list.
**Tunnels point at 8788, never at 8787.**

**Transports, in order of preference:**

| Transport                                                | Phone URL                            | Pros                                                                                                                  | Cons                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tailscale Serve** (tailnet-only)                       | `https://<mac>.<tailnet>.ts.net`     | Nothing public; real HTTPS cert; the phone app stays connected (VPN on demand)                                        | Tailscale app and account on both devices. Funnel (public) is beta, ports 443/8443/10000 only ([KB](https://tailscale.com/kb/1223/funnel)).                                                                                                   |
| **Cloudflare named Tunnel + Access service token**       | `https://steward.<your-domain>`      | Stable public URL; Access rejects anyone without `CF-Access-Client-Id`/`-Secret` headers, which the shortcut can send | Needs a Cloudflare account and domain; the Access secret is a second credential to deliver (put it in the pairing response)                                                                                                                   |
| Same Wi-Fi / Personal Hotspot                            | `http://<mac>.local:8788`            | No third party                                                                                                        | Plain HTTP; iOS Local Network prompt; home only                                                                                                                                                                                               |
| **Cloudflare quick tunnel** (`cloudflared tunnel --url`) | `https://<random>.trycloudflare.com` | No account; good for demos (Tempo uses it)                                                                            | "For testing and development"; **URL changes every run**; no SSE; 200 in-flight cap; no uptime guarantee ([docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)) |
| ngrok                                                    | `https://<id>.ngrok-free.app`        | Easy                                                                                                                  | Free-tier warning page (needs a `ngrok-skip-browser-warning` header); account                                                                                                                                                                 |

**When the URL changes** (quick tunnels, re-provisioned tunnels), re-pair with a new QR code.
A relay hosted by Steward (Steward dials out to it, the phone talks to the relay) comes after
v0.1, with its own end-to-end encryption and abuse design.

### 6.5 The device API (narrow; shared later with an Expo app)

Shortcuts can't consume SSE or AG-UI streams, so the device API returns finished JSON. Every
route is bearer-authenticated, scoped, and run through `@steward/gateway` like any other caller.

| Route                                  | Scope              | Notes                                                                                                                                                  |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /device/pair`                    | none (code)        | The code is made by `POST /api/devices/pairing` on the loopback UI                                                                                     |
| `GET /device/brief`                    | `brief:read`       | Returns a spoken-friendly `say` (≤ 300 chars) plus `items[]`                                                                                           |
| `GET /device/approvals?status=pending` | `approvals:read`   | Each item carries `canDecideHere`                                                                                                                      |
| `POST /device/approvals/:id/decision`  | `approvals:decide` | Refused for `pay`/`sign`/credential kinds and for tainted `send`/`delete`/`shell`. Records "decided from <device>". Same digest check as the web card. |
| `POST /device/say`                     | `chat`             | Starts a run through the existing runner. It waits up to about 20 s, then returns `{say, ui[], threadId}` or `{pending, taskId}`.                      |
| `GET /device/manifest`                 | any                | `{version, minVersion, url, notes}` for updates                                                                                                        |

**Server-driven responses**, for example
`{"ui":[{"say":"…"},{"choose":{"title":"…","options":[{"label":"Allow once","post":"/device/approvals/42/decision","body":{…}}]}}]}`.
The shortcut interprets a fixed vocabulary (Speak/Show, Choose from Menu → POST, Ask for Input →
POST, Open URL), so new features ship as server responses, not new files.

### 6.6 Keeping shortcuts updated (the RoutineHub pattern, self-hosted)

- **Version check.** Every request sends `X-Steward-Shortcut: <version>`. Below `minVersion`, the
  server answers `426`
  `{"update":{"version":"4","url":"https://<host>/device/shortcut/Steward.shortcut","notes":"…"}}`.
  The shortcut shows the notes and opens the URL (Safari, then Add Shortcut). It also checks
  `GET /device/manifest` at most once a day.
- **The token survives an update.** On iOS 27 it is in global storage (`steward.device`); on iOS 26
  it is in `Shortcuts/Steward/device.json`. Flow B issues a new file and token, and revokes the old
  token on the new token's first call.
- **[unverified]** Does re-importing replace the shortcut or create "Steward 2"? If it duplicates,
  tell the user to delete the old copy.
- **iOS 27 automations.** Optionally embed one (for example "08:00 weekdays → brief"); it arrives
  off. Maintainers re-sign the generic file every release and at least every 6 months (the leaf
  lasts about 12.7 months).

### 6.7 Build pipeline (suggested package `packages/phone`; not created)

1. **Build.** `buildWorkflow(kind, opts)` produces XML plist text from templates exported from
   Apple's app. Then `validate()` parses it back, because `sign` crashes on bad input [ran].
2. **Sign.** `sign(plist, mode)`:
   - On a platform other than `darwin`, return `null` and use the shipped generic file.
   - Otherwise run `execFile("shortcuts", ["sign","--mode",mode,"--input",in,"--output",out])`
     with a 30 s timeout and up to 3 retries (the CloudKit error appeared once in seven runs).
   - Check that the output starts with `AEA1`. Never log the plist.
3. **Serve** with these headers: `application/octet-stream`,
   `Content-Disposition: attachment; filename="Steward.shortcut"`, and `Cache-Control: no-store`.
   Use one-time ids for personal files.
4. **Tests.** A plist round trip on any OS. On a macOS CI runner without iCloud, assert that the
   "must be signed into iCloud" error is reported cleanly.

### 6.8 Check on a device before building on these assumptions

1. **Safari download.** With `attachment` and with `inline`, how many taps does it take to reach
   Add Shortcut on iOS 26 and on iOS 27?
2. **Own-device signing.** Does a `people-who-know-me` file signed on the person's Mac import on
   their iPhone with Private Sharing **off**?
3. **The `run-shortcut` link** from a QR code and from Safari. What confirmation appears, how long
   can `text` be (keep it under 1 KB), and what happens if the shortcut is missing?
4. **The first `Get Contents of URL` to a new host.** What does the prompt say, and does
   "Always Allow" survive an update?
5. **Re-importing a shortcut with the same name.** Does it replace the old one or duplicate it?
6. **Global `Store Content` (iOS 27).** Can other shortcuts see it? Does it sync? Does it survive a
   re-import?
7. **An automation embedded in a shortcut (iOS 27).** How is it encoded in the plist? Export one
   to find out.
8. **Expired certificates.** Does a file signed with an expired `anyone` certificate still import?

---

## 7. Sources

**Run on this Mac** (scratchpad `…/scratchpad/sctest/`): `make.py` (test plist); `inspect.py` and
`dumpcerts.py` (AEA header, auth data, cert chains); `shortcuts sign` timings; the `aea decrypt` +
`aa extract` round trip; `Shortcuts.app` Info.plist (UTIs, URL schemes); dyld-cache strings
(`WFRunWorkflowURLHandler`); `man shortcuts`; the iCloud records API; the RoutineHub version API;
Shortcuty `GET /api/v1`; HubSign (connection reset); Shiori's headers and cert; the
`echo-zaq/shortcut-sign` Actions log; `gh api` repo metadata; `npm view expo-app-intents` and
`@bacons/apple-targets`.

**Apple:** [Mac command line / sign](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac) ·
[Share shortcuts](https://support.apple.com/guide/shortcuts/apdf01f8c054/ios) ·
[Run a shortcut from a URL](https://support.apple.com/guide/shortcuts/apd624386f42/ios) ·
[x-callback-url](https://support.apple.com/guide/shortcuts/apdcd7f20a6f/ios) ·
[Import questions](https://support.apple.com/guide/shortcuts/add-import-questions-to-shared-shortcuts-apdf330fd3a0/ios) ·
[Privacy settings](https://support.apple.com/guide/shortcuts/apd961a4fc65/ios) ·
[old import-shortcut page (iOS 12)](https://support.apple.com/en-la/guide/shortcuts/apd77a47304b/2.0/ios/12.0) ·
[New in iOS/macOS 27](https://support.apple.com/en-us/149045) ·
[App Shortcuts](https://developer.apple.com/documentation/appintents/app-shortcuts) ·
[AppShortcutsProvider](https://developer.apple.com/documentation/appintents/appshortcutsprovider) ·
the `shortcuts(1)` man page.

**Secondary:** [DEV, 2026: four walls](https://dev.to/eugeniya_ivanova_4a58eadc/i-tried-to-build-an-apple-shortcut-from-code-apple-said-no-four-times-4l5d) ·
[dev forum 726203](https://developer.apple.com/forums/thread/726203) ·
[zachary7829 format](https://zachary7829.github.io/blog/shortcuts/fileformat) ·
[sebj reference](https://github.com/sebj/iOS-Shortcuts-Reference) ·
MacStories iOS 27 review [p12](https://www.macstories.net/stories/ios-and-ipados-27-review/12/) and [p13](https://www.macstories.net/stories/ios-and-ipados-27-review/13/) ·
[9to5Mac iOS 27 actions](https://9to5mac.com/2026/09/29/ios-27s-shortcuts-app-adds-35-new-improved-actions-heres-whats-new/) ·
[Automators changelog](https://talk.automators.fm/t/os-26-27-new-and-updated-actions/19177) ·
[Cherri FAQ](https://cherrilang.org/faq.html) and [signing.go](https://github.com/electrikmilk/cherri/blob/main/signing.go) ·
[RoutineHub changelog](https://routinehub.co/changelog/) (archive copy) ·
[RoutineHub API notes](https://extratone.github.io/RoutineHub-API) ·
[Shiori docs](https://www.shiori.sh/docs/ios-shortcut) ·
[Expo app-intents](https://docs.expo.dev/versions/latest/sdk/app-intents/) ·
[expo-apple-targets](https://github.com/EvanBacon/expo-apple-targets) ·
[Cloudflare quick tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) ·
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) ·
[MacRumors Action button](https://macrumors.com/guide/iphone-16-action-button) ·
macOS licence notes: [eclecticlight](https://eclecticlight.co/2022/08/04/virtualisation-on-apple-silicon-macs-8-how-apple-limits-vms/), [threedots](https://threedots.ovh/blog/2020/12/macos-eula-licensing-restrictions-affecting-virtualisation/).

**Local repos** (read only, not modified): `steward/PLAN.md` §2–§8, `steward/docs/security.md`,
`steward/apps/server/src/http/security.ts`, `tempo/apps/shortcuts/README.md` and `build_shortcut.py`.
