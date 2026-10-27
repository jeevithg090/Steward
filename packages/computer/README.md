# @steward/computer

The agent's computer of its own: one Chromium profile, one workspace folder and a restricted shell
per agent, all in the Steward process. The person can watch the screen live, take the wheel at any
time, and type a password into the page without the agent ever seeing it.

Nothing here decides whether an action may happen. That is the gateway's job (`@steward/gateway`);
the agent calls these methods only from inside `governance.execute`. This package makes sure the
actions it is given are safe to carry out: the right element, the right address, the right folder,
and never underneath the person.

```ts
import { createComputerManager, withToolCall } from "@steward/computer";

const computers = createComputerManager({
  dataDir: ".steward-data", // computers/<agentId>/{profile,workspace,tmp}
  allowPrivateHosts: process.env.STEWARD_ALLOW_PRIVATE_HOSTS === "1",
  audit, // from @steward/gateway
});

const computer = await computers.get("steward"); // starts Chromium on first use
const page = await computer.navigate("https://news.ycombinator.com");
await withToolCall(toolCallId, () => computer.click("e12")); // activity links back to the call
```

## What the model sees

Every browser method returns a `PageObservation`: the URL, the title and a compact accessibility
snapshot built from Playwright's AI snapshot (`page.ariaSnapshotJSON({ mode: "ai" })`).

```
- heading "Order" [level=1]
- textbox "Name" [ref=e1]: Ada
- textbox "Password" [ref=e2]: [hidden: sensitive field]
- combobox "Size" [ref=e3] [options: Small | Large]: Small
- checkbox "Bacon" [ref=e4]
- button "Save" [ref=e5]
- link "Next page" [ref=e6] [url=/next]
```

- Refs appear only on things the model can act on: fields, buttons, links, options, and anything
  the page marks as clickable.
- Values of password, one-time-code and card fields, and of fields the secret box filled, are
  replaced with `[hidden: sensitive field]`. If a field cannot be checked, its value is hidden too.
- The text is capped at 12,000 characters. On a longer page the kept window starts at the first
  element on screen, with a note saying how much is above and below, so `scroll` shows more.
- Label text that only repeats the name of the field beside it, and empty elements, are left out.
- Native dialogs (`alert`, `confirm`, `prompt`) cannot be shown in a headless browser, so they are
  dismissed (the safe answer to "Delete this?") and the next observation says so at the top.

## Refs, and why an old ref fails instead of clicking the wrong thing

Playwright numbers refs per document, so after a navigation `e5` names a different element. A
model holding an old `e5` would click something it never saw. Steward hands out its own refs,
unique for the life of the computer, and keeps the map to Playwright's. Before acting on a ref:

1. It must be in the latest snapshot, and the page must not have changed document since.
2. A fresh look must find the same element under it with the same role and name. A page that
   renames "Next" to "Pay now" after the snapshot cannot redirect the click.
3. It must still resolve on the page (`count() > 0`), so a dead ref fails at once rather than
   waiting out Playwright's timeout.

Any failure is a `ComputerError` with code `stale_ref` and a message starting
`Stale ref e5: … take a new snapshot and use the refs it returns.`

> Never take a default-mode snapshot of the agent's page (`page.ariaSnapshot()` or
> `locator.ariaSnapshot()` without `mode: "ai"`). Playwright resolves refs against the latest
> snapshot of a frame, so it silently invalidates every ref. Verified on Playwright 1.64.

## What the gateway is told

The gateway judges an action by the element it touches, so the computer reports that element as the
page really has it:

- `describe(ref)` returns the role and name from the latest snapshot, and `sensitive`: the field is
  a password, one-time code or card field by its type or `autocomplete` (or one the secret box
  filled), whatever its label says. A field that could not be checked counts as sensitive. Typing
  into a sensitive field is credential entry, so a `Passwort` or unlabelled password field gets the
  same floor as one labelled `Password`.
- `focused()` is what a key press acts on: the role, name and `sensitive` of the focused element,
  read from a fresh snapshot the same way, plus `submitter`, the control Enter or Space would
  activate. A focused button or link is its own submitter; a field in a form has the form's
  default button (the first submit button in tree order). It is `undefined` when nothing has
  focus. When focus is on something the snapshot cannot name, it comes back as
  `{ sensitive: true, submitter: {} }`.
- `submitterFor(ref)` is the default button of the form holding `ref`, for `type` with `submit`.
  `undefined` when the field is in no form, its form has no submit button, or the ref is not in the
  latest snapshot (the action will refuse it as stale anyway).

A submit button that exists but has no ref (hidden, or covered) comes back as `{}`: something will
be submitted and nothing names it, for the gateway to fail closed on. The button is matched to the
snapshot by identity in the browser, not by its text, so the name is the one the snapshot shows.

## Methods

| Method                                                                        | Notes                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate(url)`                                                               | `http`/`https` only. A bare `example.com` is read as `https://example.com`. Addresses with a user name or password in them are refused. |
| `snapshot()`                                                                  | A fresh look. Allowed while the person drives.                                                                                          |
| `click(ref)`                                                                  | Follows a popup it opens: the newest tab is the live one.                                                                               |
| `type(ref, text, { submit })`                                                 | Replaces the field's content; on a `<select>` it picks the option by label or value. The text is never echoed in errors or activity.    |
| `press(key)`                                                                  | Playwright key names: `Enter`, `Tab`, `Escape`, `ArrowDown`, `Control+A`…                                                               |
| `scroll("up" \| "down", px = 600)`                                            | Waits for smooth scrolling to stop before looking.                                                                                      |
| `back()`                                                                      |                                                                                                                                         |
| `requestHelp(reason, { signal })`                                             | Sets `status.help` and waits for the person to hand back (`{ released: true }`), or 15 minutes, or the signal (`{ released: false }`).  |
| `requestSecret(ref, label, { signal })`                                       | See the secret box below. Waits up to 10 minutes.                                                                                       |
| `listFiles(dir?)`, `readFile(path, { maxBytes })`, `writeFile(path, content)` | Workspace-relative paths only.                                                                                                          |
| `runShell(command, { timeoutMs, signal })`                                    | `bash -c` in the workspace.                                                                                                             |
| `activity(limit = 100)`                                                       | Newest lines, oldest first, from a ring of 500.                                                                                         |

The manager adds `status`, `subscribe`, `handle` (the WebSocket's two directions), `reset` (close
and start again; the profile and workspace stay) and `closeAll`. After an explicit close the
computer stays closed until `get` or `reset`; an action already in flight fails with code `closed`
rather than bringing the browser back.

## The live screen

`subscribe(agentId, listener)` sends the current status at once, then:

- `frame`: Chromium's own screencast over CDP (`Page.startScreencast`, JPEG quality 70, at most
  1280×800). Frames come only when the page repaints. The cast starts with the first watcher and
  stops with the last; a new watcher gets the latest frame straight away.
- `status`: whenever the URL, title, controller, help request or secret request changes.
- `activity`: each new line.
- `error`: a plain sentence when something the person sent could not be done.

`handle(agentId, message)` takes the client messages in `ComputerClientMessage`. It never throws;
problems come back as `error` messages. Every message is validated, since it arrives over a socket.

### Take the wheel

- `take`: waits for any agent action already on the screen to finish (the barrier), then gives the
  person control. From the moment a take begins, every agent action that acts (browser actions,
  `writeFile`, `runShell`, `requestSecret`) is refused with
  `The person has control of the screen right now.` (code `person_has_control`). Looking
  (`snapshot`, `listFiles`, `readFile`) stays open.
- While the person drives, `mouse`, `wheel`, `key`, `text` and `navigate` go to the page through
  CDP `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` and `Input.insertText`. Cmd is sent as
  Meta on macOS (so Cmd+A and Cmd+C work) and as Control elsewhere. Navigation still goes through
  the address checks. Input is refused unless the person holds the wheel.
- `release`: hands back. The agent must take a fresh snapshot before it acts on the page again
  (code `snapshot_required`), because the person may have changed anything. A pending
  `requestHelp` resolves with `{ released: true }`.
- While a help request waits, agent actions are refused too, so nothing runs underneath someone
  who is about to step in.

The record gets `computer.help_requested`, `computer.control_taken` and `computer.control_released`.
Individual keystrokes are not recorded.

### The secret box

1. The agent calls `requestSecret(ref, "Password for example.com")` with a text field from its
   latest snapshot. `status.secret` carries `{ id, ref, label, host, requestedAt }`; the host is
   shown so the person can check where the value is going. The record gets `secret.requested`.
2. The web app sends `{ type: "secret", requestId, value }`. The field is first marked
   (`data-steward-secret`, drawn as dots on the live screen), then filled. If the page has moved to
   another host, nothing is typed.
3. The agent's call resolves with `{ filled: true, length }`. The record gets `secret.filled` with
   only `{ length, host }`. `secret.cancel` resolves `{ filled: false, length: 0 }`.

The value is never logged, stored, returned, or put in activity text, and Playwright's error
messages are not passed on because they can quote their arguments. Only a keyed digest (a random
in-memory key, gone when the computer closes) is kept, so that a page that puts the value into
its address, such as a GET form, can have it replaced with `hidden` in every URL Steward reports.
Filling never submits the form; that is a separate, governed click.

## Network safety

The agent's browser can reach the public web and nothing else, in three layers:

1. **Before navigating**, the URL is parsed: only `http` and `https` (`file:`, `chrome:`, `data:`
   and `javascript:` are refused). The host is checked against the policy below.
2. **The route guard** (`context.route`) checks every request a page makes, including
   subresources and popups, and fails refused ones with `ERR_BLOCKED_BY_CLIENT`.
3. **The egress proxy**, a small forward proxy on 127.0.0.1 that Chromium is launched with, checks
   every connection again. Playwright never shows redirect hops or WebSockets to routes (verified:
   a 302 to `169.254.169.254` went straight past `context.route`); the proxy sees both. It
   connects only to the addresses it checked, so a DNS answer that changes between check and
   connect (rebinding) goes nowhere.

The policy (`HostPolicy`) resolves names and checks every address:

- **Always refused:** cloud metadata (`169.254.169.254`, `169.254.170.2`, `fd00:ec2::254`,
  `metadata.google.internal`, `100.100.100.200`, `168.63.129.16` and friends).
- **Refused unless `allowPrivateHosts`:** loopback, RFC 1918, link-local, carrier-grade NAT,
  unique-local IPv6, multicast and reserved ranges, `localhost` and `*.localhost`, including IPv4
  hidden inside IPv6 (`::ffff:127.0.0.1`, NAT64, 6to4).
- DNS answers are cached for 30 seconds (5 for failures).

A refused navigation is a `ComputerError` with code `blocked` and a sentence such as
`127.0.0.1 is on this computer or a private network. Steward's browser does not open those unless
private hosts are allowed (STEWARD_ALLOW_PRIVATE_HOSTS=1).` Refused subresources show in the
activity as `Blocked a request to <host>`, at most once a minute per host.

Also: service workers are blocked (they fetch outside routes), WebRTC is limited to proxied
connections, Chromium's popup blocker is on, and the profile's keychain is mocked on macOS so no
keychain prompt appears.

## Workspace and shell

Files live in `computers/<agentId>/workspace`. Paths must be relative; absolute paths, `~` and any
`..` are refused before the disk is touched. The real path of the parent folder, and of the file
when it exists, must stay inside the workspace, so a symlink cannot lead out; files are then opened
with `O_NOFOLLOW` at the checked path. Reads stop at 256 KiB by default (8 MiB at most) and refuse
binary files; writes stop at 5 MiB. Listings are recursive, at most 500 entries, and do not walk
into `node_modules` or `.git`. Downloads land in `downloads/`.

The shell runs `bash --noprofile --norc -c <command>` with the workspace as both the working folder
and `HOME`, and `TMPDIR` set to the computer's own `tmp`. Its environment is an allow-list (`PATH`,
`LANG`, `LANGUAGE`, `LC_*`, `TERM`, `TERMINFO`, `COLORTERM`, `TZ`), so model keys and tokens never
reach commands. The time limit is 120 s by default (1 s to 600 s); on timeout or abort the whole
process group is killed, and background jobs end with the command. Each stream keeps its last
64 KiB, because a failing command says why at the end.

The shell is not network-filtered and can read anything the server's user can. That is why the
gateway asks before every command by default.

## Errors

Every refusal is a `ComputerError` with a `code` and one plain sentence for the model:
`stale_ref`, `snapshot_required`, `person_has_control`, `blocked`, `bad_url`, `bad_input`,
`bad_path`, `not_found`, `too_large`, `not_text`, `busy`, `closed`, `timeout`, `failed`.

## Testing

```sh
pnpm vitest run packages/computer/test
```

The suite drives real Chromium (Playwright's cached build) against a local site on 127.0.0.1 and
finishes in about 10 seconds. It covers snapshots, clicking and typing by ref, masking, stale refs
(after a navigation and after a rename), metadata and private-host refusals including redirects,
take and release with the barrier, the secret box without leaks, files and symlink escapes, shell
timeouts and the environment, the screencast, popups, downloads and dialogs. If Chromium is
missing: `pnpm exec playwright install chromium`.

## Not yet

- No idle shutdown or cap on how many browsers run at once.
- No file uploads (`<input type="file">`) and no automatic CAPTCHA handoff.
- `context.route` turns off the browser's HTTP cache, so pages load a little slower.
- `navigator.userAgent` still says `HeadlessChrome`; some sites treat that differently.
- The person's own input is not recorded per keystroke, by design; taking the wheel is.

## Credits

Adapted from [OpenBot](https://github.com/CopilotKit/openbot)'s agent computer (MIT, CopilotKit):
the control state machine and barrier, workspace confinement, the shell, the egress filter, the
snapshot flattening and masking, and the screencast and input translation (which OpenBot adapts from
steel-browser, Apache-2.0, and Chrome DevTools, BSD-3-Clause). The macOS editing commands are a
subset of Playwright's `macEditingCommands.ts` (Apache-2.0).
