# Tempo as an MCP server

**Your AI can ask Tempo. It can never act for you.**

The Gateway serves an [MCP](https://modelcontextprotocol.io) server at `/mcp`. Any MCP client can
connect to it: Claude Code, Claude Desktop, Zed or Cursor. An assistant connected to Tempo can check
a suspicious text, read a letter, start a claim, see how a claim is going, look at the Time Ledger,
screen entitlements and verify an Agent Passport mandate.

**No tool approves anything.** A claim that an assistant starts waits for the person's own yes,
given on their own device: the Tempo web app, Face ID, or a text that says YES. This is decision 3
in `plan.md` §1: models read and plan; code decides money, time and permissions. Approval is a
permission, so no MCP tool can give it. Tempo doesn't rely on a prompt asking the model to hold
back. The tool to approve doesn't exist, and a made-up one is refused with `Unknown tool`.

The code is in `apps/gateway/src/tempo_gateway/mcp_server.py`. Each tool calls the same service as
its HTTP route, so an assistant gets the same answers and the same refusals as the web app.

## Connect

| | Local (`make demo`) | Live demo |
|---|---|---|
| URL | `http://127.0.0.1:8000/mcp` | `$PUBLIC_URL/mcp` (the tunnel's https address) |
| Token | `devtoken` | the Gateway's `TEMPO_API_TOKEN` |
| Transport | Streamable HTTP | Streamable HTTP |

`GET /mcp/info` (with the same bearer) gives the URL, the transport and the lists of tools,
resources and prompts. The web app's MCP section is built from it.

## Tools

| Tool | Input | Output | Read-only |
|---|---|---|---|
| `check_message` | `text`, `language?` | Scam Shield's verdict: `level`, `zone`, `say`, `reasons`, `why`, `advice` | yes |
| `read_letter` | `image_base64` (a `data:` URL works too), `filename?`, `mime_type?` | the letter reading: `kind`, `sender`, `money`, `must_do`, `by`, `unsure`, `reading_text`, … | yes |
| `start_rail_claim` | `user_id`, `display_name`, `origin_crs`, `destination_crs`, `travel_date`, `departure`, `fare_gbp`, `profile_id?`, `phone?` | `mission_id`, `state`, `started`, `message`, `amount_gbp`, `proof`, `court`, `needs_consent_from`, `how_to_approve` | no (it starts a claim but sends nothing) |
| `start_missed_visit_claim` | `user_id`, `display_name`, `provider`, `visit_date`, `notice_hours?`, `profile_id?`, `phone?` | the same shape | no (it starts a claim but sends nothing) |
| `claim_status` | `mission_id` | `mission_id`, `state`, `message`, `amount_gbp`, `timeline`, `needs_consent_from` | yes |
| `money_returned` | none | the Time Ledger: `minutes_returned`, `hours_returned`, `gbp_recovered` | yes |
| `screen_entitlements` | the ten answers: `age`, `weekly_income_gbp`, `couple?`, `savings_gbp?`, `benefits?`, `needs_care_day?`, `needs_care_night?`, `care_months?`, `terminally_ill?`, `has_broadband_or_phone?` | `flags`, `disclaimer`, `figures` | yes |
| `verify_mandate` | `envelope`, `counterparty`, `action`, `amount_gbp?` | Agent Passport's verdict: `ok`, `reason`, `message`, `assurance`, … (for a company's agent) | yes |

The two start tools are marked `destructiveHint: false` and `idempotentHint: true`. Sending the
same journey twice (or the same provider and day) gives back the same claim, with
`"started": false`. Tempo never claims the same thing twice.

While a claim waits for a yes, it says who must give it and how:

```json
"needs_consent_from": "the person, on their own device",
"how_to_approve": "Margaret approves on their own device: the Tempo web app or Face ID. An assistant cannot approve."
```

"By texting YES" is added only when the claim has her number (`phone`). Without a number, a text
from her would not find the claim, so Tempo doesn't offer it.

**Resources.** `tempo://rules/{rule_id}` is a rule pack: the rule in plain words, then the YAML that
Tempo runs (for example `tempo://rules/uk-rail.gwr.delay-repay`). `tempo://profiles/{profile_id}`
is a Tempo Profile's view as JSON (for example `tempo://profiles/commuter`).

**Prompts.** `claim-a-late-train` asks for the missing journey details one at a time, then uses
`start_rail_claim`. `is-this-a-scam` (optional `message`) uses `check_message` on the exact words.

## Client configs

Use `http://127.0.0.1:8000/mcp` and `devtoken` for a local `make demo`. For the live demo, use the
tunnel's address and the live token.

**Claude Code**

```bash
claude mcp add --transport http tempo http://127.0.0.1:8000/mcp --header "Authorization: Bearer devtoken"
```

Then `/mcp` in Claude Code shows `tempo` with eight tools.

**Zed** (`settings.json`)

```json
{
  "context_servers": {
    "tempo": {
      "url": "http://127.0.0.1:8000/mcp",
      "headers": { "Authorization": "Bearer devtoken" }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "tempo": {
      "url": "http://127.0.0.1:8000/mcp",
      "headers": { "Authorization": "Bearer devtoken" }
    }
  }
}
```

To keep the token out of the file, Cursor reads it from the environment with
`"Authorization": "Bearer ${env:TEMPO_API_TOKEN}"`.

**Claude Desktop**, through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge
(pinned to 0.14.3, a release more than a month old that supports `--transport http-only` and `--header`). Edit
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "tempo": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote@0.14.3", "http://127.0.0.1:8000/mcp",
        "--transport", "http-only",
        "--header", "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer devtoken" }
    }
  }
}
```

The header comes from `env` because Claude Desktop on Windows and Cursor don't escape spaces inside
`args` (mcp-remote's README describes this bug). There is no space after the colon for the same
reason. In a shell the one-liner works as it is:

```bash
npx -y mcp-remote@0.14.3 http://127.0.0.1:8000/mcp --transport http-only --header "Authorization:Bearer devtoken"
```

`--transport http-only` skips the old SSE fallback, which Tempo doesn't serve. mcp-remote accepts
plain HTTP on loopback. Anything else must be https, like the live tunnel. `--header-file
<path>` keeps the token out of the process list.

## Demo (about one minute)

```bash
make demo                                   # the Gateway on 8000, seeded (plan.md §6)
uv run --no-sync python scripts/mcp_demo_client.py --url http://127.0.0.1:8000 --token devtoken
```

`scripts/mcp_demo_client.py` connects with the MCP SDK's own client, just as an assistant would.
It reads the token from `TEMPO_API_TOKEN` when `--token` is left out. The beats:

1. **The tools.** Eight are listed; the two start tools are marked as starting something. "No tool
   approves anything."
2. **The HMRC text.** `check_message` answers zone `warn` and level `likely_scam`, and says why in
   plain words.
3. **Margaret's claim.** The 08:12 Oxford to Paddington on 23 October, £28.40. Tempo answers
   `awaiting_consent` and £14.20, with the Proof Trace and the Court's votes.
4. **Who approves.** "Margaret approves on their own device: the Tempo web app or Face ID. An
   assistant cannot approve."
5. **The assistant tries anyway.** It asks for `approve_claim` and the server says `Unknown tool:
   approve_claim`. `claim_status` still says `awaiting_consent`.

Then open Mission Control in the web app: the same claim is waiting there, and her yes is the only
one that counts. In Claude Code, the same story goes like this. Add the server (above), then run
`/mcp__tempo__claim-a-late-train` (MCP prompts appear as slash commands), or paste the HMRC text
and ask "is this a scam?".

## Security notes

- **The bearer.** `/mcp` and `/mcp/info` take the web app's token (`TEMPO_API_TOKEN`), checked by
  the same constant-time `web_caller` check as Mission Control. Without it, or with a wrong one, the
  answer is `401 {"detail": "a valid bearer token is required"}` with `WWW-Authenticate: Bearer`.
- **The Host check.** On top of the bearer, the SDK's DNS-rebinding protection accepts only this
  machine (`127.0.0.1`, `localhost`, `[::1]`, any port) and the host in `PUBLIC_URL`. Any other
  Host header gets `421`. Behind a new address, set `PUBLIC_URL` to it.
- **Read-only annotations.** Six tools carry `readOnlyHint: true`. The two start tools carry
  `readOnlyHint: false, destructiveHint: false, idempotentHint: true`: they create a mission that
  waits, and they file nothing.
- **No approve tool.** Approvals stay with the person: the web app (her passkey, once she has
  one), SMS YES, or her own call. Nothing in MCP reaches `MissionService.answer`. The
  integration test checks that no tool name contains "approve" or "consent".
- **Profiles bind.** A profile that may not claim is refused before anything starts, in the
  words `/missions` uses, for example "Your profile, Read It To Me, doesn't let me file a claim or
  accept cash, so I haven't started." The MCP SDK puts `Error executing tool start_rail_claim: `
  before every tool error; the sentence that follows is unchanged. An unknown profile is refused
  the same way.
- **The bus hears that a tool ran, not what it was given.** Each call publishes
  `{"type": "mcp_call", "tool": "check_message", "ok": true}`. It never carries the arguments or the
  result. A tool name Tempo doesn't have is reported as `"unknown"`. Scam Shield's own log still
  keeps only the zone, the level, the rules and the link hosts, with source `mcp`.
- **Photos.** `read_letter` reads a photo once and drops it, with the same 8 MB limit as
  `/letters/read`. The MCP request limit is raised to fit a photo that size, base64-encoded.

## How it is mounted (for developers)

`create_app` makes one call:

```python
mount_mcp(
    app, web_caller=web_caller, public_url=settings.public_url, service=service, bus=bus,
    shield=shield, profiles=profiles, mandates=mandates, vision=vision, holidays=holidays,
    entitlement=entitlement,
)  # fmt: skip
```

This builds the server (`build_mcp_server`) and includes one router (`mcp_routes`). The router
serves `/mcp` as an exact route, not a mount, so `/mcp` never redirects to `/mcp/` and
`/mcp/info` stays an ordinary route. It also carries the SDK session manager's lifespan. FastAPI
merges an included router's lifespan into the app's own (`_merge_lifespan_context`), so the
session manager starts after `create_app`'s lifespan has started and stops before it ends.
`create_app`'s lifespan stays as it is. Each start of the app gets a fresh session manager,
because one can run only once.

The transport is stateless with JSON replies (`stateless_http=True, json_response=True`). Every
POST stands alone: there is no session to lose when the Gateway restarts or a tunnel reconnects,
and a reply is one JSON body that any proxy can carry. Tempo sends no notifications, so nothing is
lost.

`tests/integration/test_mcp_server.py` drives all of this with the SDK's own client
(`streamable_http_client` over an `httpx2.ASGITransport`, no socket). Its `gateway_with_mcp` is
also a uvicorn factory, for trying a live server before `create_app` makes the call:

```bash
mkdir -p ../.tempo-mcp && cd ../.tempo-mcp
TEMPO_API_TOKEN=devtoken TEMPO_DEMO=1 TEMPO_MODE=replay PAYMENT_CHECK_AFTER_S=0 \
  PUBLIC_URL=http://127.0.0.1:8040 TEMPO_HOME=<repo> \
  uv run --project <repo> --no-sync uvicorn --app-dir <repo>/tests/integration \
  test_mcp_server:gateway_with_mcp --factory --port 8040
```

## Limits

- `verify_mandate` answers exactly as `POST /mandates/verify` does. It doesn't publish that route's
  `mandate_verified` / `mandate_refused` event, only `mcp_call`.
- The GET stream that the transport allows stays open without messages, because Tempo sends none
  in stateless mode. Clients that open it simply wait on it.
- `how_to_approve` says "their": Tempo doesn't ask for anyone's pronouns.
