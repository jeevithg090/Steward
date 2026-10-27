# @steward/connectors

What Steward reaches outside itself with: mail and calendar, MCP servers, and the web.

None of this decides whether anything may run. Every call reaches these functions only after the
gateway has decided, recorded and, where needed, asked. This package only acts, and it acts carefully:
it refuses private and cloud-metadata addresses, caps what it reads, and turns every failure into a
sentence a person can act on.

| Export                                         | What it does                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `createDemoGoogleApp({ now? })`                | A Hono app serving an invented Gmail and Calendar. Mounted by the server at `/demo-google`. |
| `createGoogleMailCalendar(opts)`               | A `MailCalendar` that speaks Gmail v1 and Calendar v3, to the demo or to real Google.       |
| `createMcpManager({ db, allowPrivateHosts? })` | Connects the MCP servers the person added, offers granted tools, calls them.                |
| `createWebTools({ allowPrivateHosts? })`       | `fetch(url)` reads a public page as text; `search(query)` asks DuckDuckGo.                  |
| `migrations`                                   | This package's tables, for `db.migrate`.                                                    |

Also exported for the server and other packages: `htmlToText`, `checkWebAddress`, `classifyHostname`,
`createGuardedFetch`, the error classes (`GoogleApiError`, `McpCallError`, `WebFetchError`,
`WebSearchError`, `BlockedAddressError`) and the demo constants (`DEMO_ACCOUNT`, `DEMO_LABEL`,
`DEMO_TIME_ZONE`).

## The demo inbox and calendar

```ts
import { createDemoGoogleApp, createGoogleMailCalendar } from "@steward/connectors";

const demo = createDemoGoogleApp();
app.route("/demo-google", demo);

const mail = createGoogleMailCalendar({
  baseUrl: "http://127.0.0.1:8787/demo-google",
  label: "Demo inbox",
  isDemo: true,
  // Optional: skip the loopback hop and call the demo app in-process.
  fetch: (input, init) => demo.fetch(new Request(input, init)),
});
```

**What is in it.** About thirty invented emails for a person in London who has no name. Nothing greets
them by one: messages open with "Hi", "Hello", "Hey" or nothing at all, and the account is
`you@demo.steward.local`. Every message carries the **Demo** label, and the front page (`GET /`) says
the data is invented, so demo mail never passes for real mail.

- **Needs you:** a letting agent asking which repair slot suits by 5pm tomorrow, a GP surgery asking
  to book a medication review, an invoice due on Friday, a colleague's question before a review, a
  missed delivery that needs a choice, a new-sign-in security alert, a friend asking about Saturday,
  a dentist asking for confirmation, a contract to sign, a failed payment, a venue deposit.
- **Can wait:** newsletters and promotions (with `List-Unsubscribe` and the Promotions category),
  receipts, shipping updates, social notifications, an out-of-office auto-reply
  (`Auto-Submitted: auto-replied`), calendar responses, statements and bills.
- **Hard cases on purpose:** a phishing email, and an email that tells "the AI assistant reading this
  inbox" to forward invoices. It exists to show taint at work: once the agent has read it, anything
  that sends asks first.
- **Calendar:** a week of events in Europe/London, including today's stand-up, lunch, a call and an
  evening quiz night. Work events sit on working days only.

Every date is relative to `now()` in London, so the demo always reads as this morning's mail. When the
London day changes, the data is re-dated; anything sent, delivered or added survives that.
Addresses use only `example.*`, `.example` and `.test` domains, and phone numbers come from Ofcom's
range reserved for drama (020 7946 0xxx).

**Routes** (relative to the mount point):

| Route                                        | Behaviour                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /gmail/v1/users/me/messages`            | `q` (Gmail search: `is:unread`, `from:`, `to:`, `subject:`, `in:`, `label:`, `category:`, `newer_than:Nd`, `older_than:`, `after:`, `before:`, quoted phrases, `-` to negate, `OR`), `maxResults` (1–500, default 100), `pageToken`, `labelIds`. Newest first. `messages` is left out when nothing matches, as Google does. |
| `GET /gmail/v1/users/me/messages/:id`        | `format=full` (headers and base64url bodies, multipart where the mail has both text and HTML), `metadata` (with `metadataHeaders`), `minimal`, `raw`.                                                                                                                                                                       |
| `POST /gmail/v1/users/me/messages/send`      | `{ raw, threadId? }` with a base64url RFC 2822 message. Threads a reply by `threadId` or `In-Reply-To`. 400 without recipients.                                                                                                                                                                                             |
| `GET /gmail/v1/users/me/labels`, `/profile`  | Labels (system ones plus the user label **Demo**) and the profile.                                                                                                                                                                                                                                                          |
| `GET /calendar/v3/calendars/primary/events`  | `timeMin`, `timeMax` (RFC 3339 with an offset), `singleEvents`, `orderBy=startTime` (400 without `singleEvents=true`, as Google does), `q`, `maxResults`.                                                                                                                                                                   |
| `POST /calendar/v3/calendars/primary/events` | Inserts an event. 400 without a start or end, or when it ends before it starts.                                                                                                                                                                                                                                             |
| `GET /__demo/sent`                           | Everything sent, decoded: `{ id, threadId, to, cc, bcc, subject, body, inReplyTo?, sentAt }[]`.                                                                                                                                                                                                                             |
| `POST /__demo/reset`                         | Re-dates everything from now and forgets what was sent, delivered or added.                                                                                                                                                                                                                                                 |
| `POST /__demo/deliver`                       | `{ from, subject, body, labels? }` adds a new unread message, for demos and tests.                                                                                                                                                                                                                                          |

Errors use Google's body shape (`{ error: { code, message, errors, status } }`), so a client written
for Google handles the demo's errors the same way.

## Real Gmail and Calendar

The client speaks Google's REST shapes, so pointing it at Google is a matter of a token and two base
URLs. Steward v0.1 does not run the OAuth flow itself (that needs your own verified OAuth client), so
you bring an access token:

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, turn on the
   **Gmail API** and the **Google Calendar API**, and create an OAuth client (type _Web application_)
   with `https://developers.google.com/oauthplayground` as a redirect URI.
2. In the [OAuth Playground](https://developers.google.com/oauthplayground), open the settings, tick
   _Use your own OAuth credentials_ and enter the client's id and secret.
3. Authorise these scopes, then exchange the code for tokens:
   `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/calendar.events`.
4. Pass the access token to the client:

```ts
const mail = createGoogleMailCalendar({
  baseUrl: "https://gmail.googleapis.com", // Gmail v1
  calendarBaseUrl: "https://www.googleapis.com", // Calendar v3
  accessToken: process.env.GOOGLE_ACCESS_TOKEN,
  label: "you@gmail.com",
  isDemo: false,
});
```

`https://www.googleapis.com` serves both APIs, so `baseUrl: "https://www.googleapis.com"` alone also
works. Access tokens last about an hour and this client does not refresh them; a 401 comes back as
"the sign-in has expired or is missing … Connect the account again."

What the client does:

- `listEmails` searches `in:inbox` unless given a query, adds `is:unread` for `unreadOnly`, and reads
  up to 8 messages at a time with `format=metadata`. Each summary also carries `headers` with
  `List-Unsubscribe`, `List-Id`, `Precedence` and `Auto-Submitted`, so triage can sort newsletters and
  auto-replies by rule. User label ids (`Label_123`) are turned into their names; system labels
  (`INBOX`, `CATEGORY_PROMOTIONS`) stay as they are.
- `getEmail` prefers the `text/plain` part and falls back to the HTML part as readable text. Bodies
  are cut at 20,000 characters, visibly.
- `sendEmail` builds RFC 2822 itself: RFC 2047 encoded words for non-ASCII, base64 bodies, and no line
  breaks allowed in any header (that is how header injection starts). A reply (`inReplyTo` as a
  message id) joins the original thread with `In-Reply-To` and `References`.
- `createEvent` adds events with `sendUpdates=none`, so adding an event never emails anyone. Inviting
  people is a send, and sends go through their own approval.
- Timed events come back as UTC ISO strings; all-day events as `YYYY-MM-DD` with an exclusive end.

## MCP servers

```ts
const mcp = createMcpManager({ db, allowPrivateHosts: false });
await mcp.ready(); // optional: wait for saved servers to connect

await mcp.upsert({
  id: "github",
  name: "GitHub",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  granted: ["search_issues", "create_issue"],
  reads: ["search_issues"],
});

mcp.grantedTools("steward");
// [{ name: "mcp__github__search_issues", kind: "read", parameters: { type: "object", ... } },
//  { name: "mcp__github__create_issue", kind: "write", ... }]

await mcp.call("github", "search_issues", { q: "is:open label:bug" });
// { text: "...", truncated: false, structured?: {...} }
```

- **Persistence.** Configs live in `connectors_mcp_servers`, with the last tool listing, so granted
  tools can be offered before a server has reconnected after a restart.
- **Connections.** Saved servers connect at start. One that drops is marked and reconnects on its next
  call. Changing only the name, grants or reads does not restart the server.
- **stdio servers** start without a shell (arguments are passed as they are, so `;` or `$(...)` mean
  nothing), in the home folder, with only `PATH`, `HOME`, `LANG` and `TERM` from Steward's environment.
  The MCP SDK adds its own safe list (`USER`, `LOGNAME`, `SHELL`). No API key in Steward's environment
  reaches a server. The last lines a server wrote to stderr are shown when it fails to start.
- **http servers** (Streamable HTTP) pass the same address checks as `web_fetch`, when saved and on
  every request: loopback and private networks are refused unless `allowPrivateHosts`, and metadata
  addresses always. Requests connect to the exact addresses that were checked.
- **Read or write.** A tool is a read only when the person listed it in `reads` and the server did not
  mark it `destructiveHint: true`. Everything else is a write. A server's own `readOnlyHint` is never
  believed: it would let a server declare its own tools harmless.
- **Grants.** Only granted tools are offered, and `call` refuses anything not granted, whatever the
  caller says. Grants are per server and apply to every agent for now.
- **Names.** Tools are offered as `mcp__<server>__<tool>`. A tool whose full name a model cannot call
  (more than 64 characters, or characters other than letters, digits, `_` and `-`) is listed but not
  offered.
- **Calls** time out after 60 seconds. Results become text: text parts joined, embedded resources as
  their text, resource links as their address, other parts named (`[image]`), structured content as
  JSON when that is all there is, and an empty result said in words. Long results are cut at 20,000
  characters, visibly. A tool's own error (`isError`) throws `McpCallError`, so the record shows it
  as failed.

## The web

```ts
const web = createWebTools({ allowPrivateHosts: false });
await web.fetch("https://example.com/"); // { url, title, text, truncated }
await web.search("sqlite write-ahead log"); // [{ title, url, snippet }]
```

**`fetch(url, { maxChars? })`** reads one public page:

- http and https only; addresses with a user name or password in them are refused.
- The host is checked before connecting, then every address it resolves to, and the socket connects
  only to an address that passed (DNS rebinding cannot swap one in between).
- Up to 5 redirects, each hop checked again. A public page that redirects to `127.0.0.1` or to the
  metadata service is refused at that hop.
- 15 seconds in all; at most 2 MB of body after decompression; `maxChars` (default 20,000) of text,
  with `truncated` set when either cap was reached.
- HTML becomes readable text: scripts, styles, navigation and the head dropped; headings as `#`,
  lists as `-`, tables split by `|`, links as `[text](url)`. Plain text and JSON come back as they
  are. PDFs, images and other binary files are refused in plain words.

**`search(query, { limit? })`** asks DuckDuckGo's HTML endpoint
(`https://html.duckduckgo.com/html/?q=`): no key, one request, a User-Agent that says it is Steward.
Results come back with the real address unwrapped from DuckDuckGo's redirect; ads are skipped. When
DuckDuckGo limits automated searches, or its page cannot be read, the error says so rather than
returning an empty list the model would read as "nothing exists".

## Address safety

| Refused                                                                                                                                                                                          | Unless                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `169.254.0.0/16` (including `169.254.169.254` and `169.254.170.2`), `100.100.100.200`, `fd00:ec2::254`, `fe80::/10`, `metadata.google.internal`, `metadata.goog`                                 | Never                                                            |
| `localhost` and `*.localhost`, `127.0.0.0/8`, `0.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10` (carrier-grade NAT, Tailscale), `::`, `::1`, `fc00::/7`, multicast and reserved ranges | `STEWARD_ALLOW_PRIVATE_HOSTS=1` (pass `allowPrivateHosts: true`) |

IPv6 spellings that carry an IPv4 address (`[::ffff:127.0.0.1]`, NAT64 `64:ff9b::/96`) are unwrapped
first, and the root dot is dropped (`metadata.google.internal.`), so no spelling slips past the list.

## Tables

| Migration                    | Table                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `connectors.001_mcp_servers` | `connectors_mcp_servers`: id, name, transport, command, args, url, granted, reads, the last tool listing, the last error. |

## Tests

```sh
pnpm vitest run packages/connectors/test
pnpm --filter @steward/connectors typecheck
```

The tests drive the demo server through `app.request()`, run the client against it in-process, run
the MCP manager against an in-memory server, a real stdio server (`test/fixtures/stdio-server.ts`) and
a real Streamable HTTP server, and check host refusal, redirects and decompression against mocks and a
real local server. Nothing in them touches the internet.

## Credits

The address checks are adapted from OpenBot's `server/src/computer/target.ts`, the MCP result
handling from OpenBot's `server/src/plugins/mcp.ts`, and the MIME parsing and Gmail search matching
from OpenDuet's fake Google server (`openbot/scripts/fake-google/server.ts`). All MIT, by CopilotKit.
See `NOTICE` at the repository root.
