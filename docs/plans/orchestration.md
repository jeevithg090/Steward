# Plan: Claude, Codex, Grok and more in one app

**Several agents and models in one Steward, each run through the same gateway, with delegation
between them; adapted from what Happy does and what it does not.**

Status: proposal, 28 Oct 2026. **Phase 1 (picker and profiles, §8) is built:** the `xai`
provider, per-profile models with a `provider/model` prefix, `GET /api/agents` with availability,
the picker showing each agent's model and greying out the keyless ones, two example profiles in
`tenants/steward/agents.yaml`, and tokens per run in the record. Phases 2 to 5 are not. Research
behind every claim:
[docs/research/happy-orchestration.md](../research/happy-orchestration.md) (Happy's harness
integrations, its own multi-provider harness, subscriptions, subagents, and the Agent Client
Protocol), with [happy.md](../research/happy.md) for the rest of Happy. Legal points in it are
marked UNVERIFIED and stay so here.

---

## 0. The short version

Happy's "Orchestrate Claude, Codex and Grok in one app" is two things:

1. **Many harnesses, one UI.** Claude Code, Codex, Gemini CLI and others each run as a session you
   can watch and answer from the same app. Their permission prompts all become one shape.
2. **Many models, one agent.** Happy's own harness (Happy Agent) talks to Claude, Codex and Grok
   with each vendor's prompts and tools, signs in with the subscriptions the person already pays
   for, and lets any agent spawn a subagent on any model.

Steward already has half of this: **one agent per profile, each on its own model**, through any
OpenAI-compatible provider. Grok runs today through OpenRouter (`x-ai/grok-4.7`), Claude through
OpenRouter or Anthropic's endpoint, and a direct xAI provider is a ten-line addition. What is
missing, and what this plan adds:

| Piece                | What it gives the person                                                                                                                                      | How                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Agent picker**     | Choose who takes a conversation: Steward, a bot from the directory, or an external coding agent                                                               | One picker, built on the profiles Steward already has                                           |
| **Harness agents**   | Claude Code, Codex, Gemini CLI, Copilot, OpenCode and ~40 others as Steward agents, in their own workspace, **every permission prompt as a Steward approval** | One Agent Client Protocol client, plus a direct Codex app-server client; both emit AG-UI events |
| **Direct providers** | Grok through `api.x.ai`, Claude through Anthropic, OpenAI through OpenAI, by API key                                                                          | Small provider table additions                                                                  |
| **Your own sign-in** | Use the Claude Code, Codex or Grok Build login you already have, by running the vendor's own unmodified tool                                                  | Steward never reads or stores a vendor credential; the vendor's tool does its own sign-in       |
| **Delegation**       | Steward hands a task to another agent and reports back; the chat shows the sub-run                                                                            | A governed `delegate_task` tool, AG-UI `SUBAGENT_*` events                                      |
| **Cost and usage**   | Tokens per run per provider in the record; "included in your plan" when it can't be priced                                                                    | AG-UI `RUN_FINISHED.usage`                                                                      |

**What we refuse to copy from Happy:**

- reading another product's credential files, refreshing its tokens, or presenting Steward as the
  vendor's CLI to a consumer endpoint (how Happy Agent reaches Codex and Grok);
- "auto" permission modes where a reviewer model answers instead of the person;
- bypass flags (`bypassPermissions`, `danger-full-access`, `--dangerously-skip-permissions`),
  even behind a setting;
- harnesses with no permission stream at all (Antigravity's `agy --print`, OpenClaw);
- Happy's three event vocabularies; AG-UI already covers them and more.

---

## 1. What we take, from where

| From                                                                                        | What                                                                                                                                                                                                                         | Licence    | How                                                                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Agent Client Protocol](https://agentclientprotocol.com) (`@agentclientprotocol/sdk` 2.0.2) | The one protocol ~48 agents speak: Gemini CLI natively; Claude Code and Codex through Zed's adapters (`@zed-industries/claude-agent-acp` 0.23.1, `@zed-industries/codex-acp` 0.16.0); Copilot, OpenCode, Goose, Cursor, Pi … | Apache-2.0 | The **primary** integration: one client in `packages/harnesses/src/acp`                                                           |
| Happy `happy-cli/src/codex/codexAppServerClient.ts` + types                                 | JSON-RPC client for `codex app-server`: framing, process lifecycle, approval requests, interrupt with forced restart                                                                                                         | MIT        | Ported and trimmed (~900 lines) for Codex, because the ACP adapter lags the app-server and `@openai/codex-sdk` has no approvals   |
| Happy `claude/utils/permissionHandler.ts` (pattern)                                         | The `canUseTool` → pending promise → answer loop; subagent-scoped ids; "AskUserQuestion and ExitPlanMode always ask"                                                                                                         | MIT        | Re-implemented on `governance.execute`, used only if the direct Claude Agent SDK path is needed                                   |
| Happy `agent/acp/sessionUpdateHandlers.ts` and the stdout line filter                       | ACP chunk, thought and tool-call mapping; ignoring banner lines before JSON                                                                                                                                                  | MIT        | Ported with two fixes: use `toolCallId` and `rawInput` (not the ACP `kind` as the tool name), and use the option `kind` to answer |
| Happy `collaboration/README.md` and `create_agent.ts` (pattern)                             | "Collaborator … finished working. Its answer follows, verbatim."; depth and count limits                                                                                                                                     | MIT        | The `delegate_task` result wording and limits                                                                                     |
| Happy `ProviderModelCompatibility.ts` (idea)                                                | Whether a thread's history survives switching agent or model                                                                                                                                                                 | MIT        | A small compatibility table; an incompatible switch starts a fresh context with a notice                                          |
| Happy `grokRetry.ts`                                                                        | Retry policy: 4xx terminal except 408/429, `retry-after`, capped doubling                                                                                                                                                    | MIT        | Generic retry for direct providers                                                                                                |
| [`@ag-ui/claude-agent-sdk`](https://www.npmjs.com/package/@ag-ui/claude-agent-sdk) 0.0.8    | Claude Agent SDK → AG-UI event mapping                                                                                                                                                                                       | MIT        | Only for the optional direct Claude path; it never wires `canUseTool`, so governance is ours                                      |
| Vendor tools, installed by the person                                                       | `claude` (Anthropic's terms), `codex` (Apache-2.0), `gemini` (Apache-2.0), Grok Build (Apache-2.0 code; endpoint terms unknown)                                                                                              | various    | External binaries; never bundled, never modified                                                                                  |

Not taken: `happy-wire`, Happy's relay and app code, `agy`, OpenClaw, `gemini/**` (deprecated
upstream in favour of ACP), the smart-pool router, team mode, the auto-mode reviewer, and all
credential-file readers and vendor-impersonating clients (listed in the brief, §4.3).

---

## 2. How it fits together

```
 Web app ── agent picker ─────────────────────────────────────────────────────────────
     │        "Steward" (BuiltInAgent, any model)   ·   "Rent Scout" (installed bot)   ·
     │        "Claude Code" / "Codex" / "Gemini CLI" (HarnessAgent)
     ▼
 CopilotKit runtime  ──►  AgentHost.agents  { steward, rent-scout, claude-code, codex, gemini }
     │                                            │                       │
     │   BuiltInAgent + GovernedToolsMiddleware   │        HarnessAgent (AbstractAgent → AG-UI)
     │   every tool call → gateway                │        ├─ ACP client  ──► gemini / claude-agent-acp / codex-acp / …
     │                                            │        └─ Codex app-server client ──► codex app-server
     │                                            │        every permission request → gateway.execute (park → interrupt → resume)
     ▼                                            ▼
 @steward/gateway: policy → record → approval → act          cwd = computers/<agent>/workspace
```

- **An external agent is an AG-UI agent.** `HarnessAgent extends AbstractAgent`, `run(input)`
  returns AG-UI events, so the runner persists it, the chat renders it, and approvals use the
  existing interrupt card. No new event vocabulary.
- **One gateway.** Every ACP `session/request_permission`, Codex `item/*/requestApproval` or
  Agent SDK `canUseTool` becomes a `GateCall` with `tool.source = "harness:<id>"`, the kind from
  the mapping in §3, the target from structured fields (paths, `command[]`, file changes; never
  from titles), `tainted: true`, and goes through `governance.execute`.
- **The harness asks for everything.** Codex runs with `approvalPolicy: untrusted` and
  `sandbox: workspace-write`; Claude with `permissionMode: default` and an empty allow-list; ACP
  agents in their default mode. Steward's rules decide what runs without asking, what asks, and
  what is refused. "Always allow" is a Steward rule, never a harness mode.
- **The harness lives in the agent's workspace.** `cwd` is `computers/<agent>/workspace`; env is
  the shell's allow-list plus what the vendor tool needs for its own sign-in; vendor credential
  folders (`~/.claude`, `~/.codex`, `~/.grok`) are never inside the workspace.

---

## 3. Permission prompts → Steward approvals

| Harness                     | Prompt                                                                                                                                                                             | `GateCall`                                                                                                                                                                                                                                  | Answer                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACP v1                      | `session/request_permission { toolCall { toolCallId, title, kind, rawInput, locations }, options[{ optionId, kind }] }`                                                            | kind from ACP `ToolKind`: `read`, `search`, `fetch` → read; `edit`, `move`, `other` → write; `delete` → delete; `execute` → shell; `think` → ui. `target.path` from `locations`, `target.command` from `rawInput`, `target.url` for `fetch` | once → the `allow_once` option; always → `allow_always` only when `canAlways`, else `allow_once` plus a Steward rule; refuse → `reject_once`; run stopped → `cancelled` |
| Codex app-server            | `item/commandExecution/requestApproval { command[], cwd }`, `item/fileChange/requestApproval { fileChanges }`, `mcpServer/elicitation/request`, `item/permissions/requestApproval` | shell with `target.command`; write with `target.path` per changed file (one approval per request, listing the files); mcp with `{ server, tool }`                                                                                           | once → `accept`; always → `acceptForSession` only when `canAlways`; refuse → `decline`; stopped → `cancel`                                                              |
| Claude Agent SDK (optional) | `canUseTool(toolName, input, { toolUseID, agentID })`                                                                                                                              | kind from a descriptor table (`Bash` → shell, `Edit`/`Write` → write, `WebFetch` → read with `target.url`, `mcp__*` → mcp); `AskUserQuestion` and `ExitPlanMode` always ask                                                                 | once/always → `{ behavior: "allow" }` (always = Steward rule); refuse → `{ behavior: "deny", message }`                                                                 |

A parked request **keeps the harness process and its pending request alive**: the run ends with
the interrupt, `{ threadId, harnessSessionId, requestId }` is stored, and the resume run calls
`governance.resume`, answers the harness and continues streaming. Existing presets apply as they
are: a harness `shell` asks; a tainted `delete` asks; payments and credentials are never
answered by a phone (phone plan).

**What the gateway cannot see.** Every harness runs its read-only tools (Claude `Read`/`Grep`,
Codex sandboxed reads, ACP `read`/`search`) without a prompt. Steward records them from the
event stream but cannot refuse them. Documented rule: the workspace holds nothing the agent should
not read.

---

## 4. Models and sign-in

### 4.1 Direct providers (API keys)

`packages/agent/src/model.ts` gains:

| Provider | Endpoint                                                  | Key           | Default model |
| -------- | --------------------------------------------------------- | ------------- | ------------- |
| `xai`    | `https://api.x.ai/v1` (OpenAI-compatible, confirmed live) | `XAI_API_KEY` | `grok-4.7`    |

Anthropic, OpenAI, Gemini, NVIDIA, OpenRouter, Ollama and OpenAI-compatible already exist. Each
agent profile may name its own `model`, so "Steward on Claude" and "Steward on Grok" are two
profiles in the picker, sharing tools, rules and record.

### 4.2 Using the sign-in you already have

"Reuse your subscriptions" in Steward means **run the vendor's own tool, signed in by you**:

- **Claude Code**: `claude` installed and signed in by the person; Steward spawns the unmodified
  binary (through `claude-agent-acp` or the Agent SDK) with the person's own login. Steward never
  reads `~/.claude/.credentials.json` or the keychain, never calls `api.anthropic.com` with a
  subscription token, never sets `CLAUDE_CODE_OAUTH_TOKEN`.
- **Codex**: `codex` installed and signed in with ChatGPT by the person; Steward spawns
  `codex app-server`. Steward never reads `~/.codex/auth.json`, never calls
  `chatgpt.com/backend-api`, never refreshes OpenAI tokens.
- **Grok**: API key only (`api.x.ai`) until xAI publishes terms for Grok Build's proxy. Grok Build
  itself can be added as an ACP or app-server harness if it ships one.
- **Gemini CLI**: its own login; speaks ACP natively.

The setup checklist shows each as "via Claude Code (your login)" or "Anthropic API key", so the
person always knows which bill a run lands on.

**Terms (UNVERIFIED, needs a human reading before release).** Anthropic's legal page permits "an
end user … signing in to the unmodified Claude Code binary with their own Claude subscription" and
forbids third parties intermediating credentials or routing requests through plan credentials;
OpenAI says app-server auth "has never been permitted for commercial or hosted services" and
points local open-source apps at "Sign in with ChatGPT"; xAI's terms were not found. Steward's
position (vendor tool, person's own login, no credential handling) is the conservative reading of
all three; the release checklist includes a human review of the current terms and the Sign in
with ChatGPT developer programme.

---

## 5. Delegation

A governed tool, `delegate_task { agentId, task, cwd? }` (kind `write`, surface `task`):

1. The gateway decides (default: runs; a tenant may make it ask).
2. The executor starts a sub-run on the target agent through the runner (the path routines use),
   emits `SUBAGENT_STARTED { subagentRunId, name }`, forwards the child's events with
   `subagentRunId` set, and returns the child's final text as the tool result, wrapped untrusted.
3. An approval inside the child interrupts the **parent** run with `interrupts[].subagentRunId`
   set; the card says which agent is asking.
4. Limits: depth 1, two concurrent children per run, both configurable; "stop" aborts the subtree.
5. The chat shows the sub-run folded under a line "Codex is working on: <task>" with its own
   transcript on expand.

The result wording follows Happy's: "<Agent> finished working. Its answer follows, verbatim." or
"… stopped without answering. It failed with, verbatim." so the parent model never mistakes the
child's text for the person's.

---

## 6. Cost and usage

`RUN_FINISHED.usage: TokenUsage[]` from Codex `thread/tokenUsage/updated`, Claude `result.usage`,
and the AI SDK's usage for Steward's own agent; ACP agents that report nothing get
`provider: "harness:<id>"` with zeros and "usage not reported". The record shows tokens per run
per provider. Subscription-backed runs are labelled "included in your <vendor> plan"; Steward never
estimates money for them.

---

## 7. Contracts to add (`packages/shared`)

```ts
// domain.ts
interface AgentProfile { …; harness?: string }           // a harness profile id instead of a model
interface HarnessProfile {
  id: string; name: string; title: string;
  kind: "acp" | "codex";                                   // "claude-sdk" optional later
  command: string; args: string[]; env?: Record<string, string>;
  /** Shown in the picker: "via Claude Code (your login)". */
  signIn: "vendor-tool" | "api-key";
  models?: string[];
}
// tenants/<id>/harnesses.yaml declares them; Settings → Agents lists which are installed on PATH.

// governance.ts
//   GateCall.tool.source: "builtin" | `mcp:${string}` | `harness:${string}`
//   AuditType: "harness.started" | "harness.stopped" | "delegation.started" | "delegation.finished"

// tools.ts
//   delegate_task: { kind: "write", surface: "task", taints: false }

// api.ts
//   GET /api/agents → { agents: (AgentProfile & { available: boolean; signIn?: string; reason?: string })[] }
//   GET /api/harnesses → HarnessProfile[] with availability (binary found, version)
```

---

## 8. Work breakdown

| Phase | Track                    | Owns                                                                                                       | Done when                                                                                                                                      | Size   |
| ----- | ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Picker and profiles      | `apps/web` agent picker (shared with the bot directory), `/api/agents`, `xai` provider, per-profile models | Two Steward profiles on different models in one app; Grok via `api.x.ai`                                                                       | ~400   |
| 2     | ACP client               | `packages/harnesses/src/acp`                                                                               | Gemini CLI and `claude-agent-acp` run as agents; every `request_permission` parks as an approval and resumes; an ndjson fixture agent in tests | ~900   |
| 2     | HarnessAgent + host      | `packages/harnesses/src/harness-agent.ts`, `AgentHost` changes, `harnesses.yaml` loader                    | Harness profiles appear in the picker when the binary is on PATH; process per thread tied to the thread's life; usage in the record            | ~600   |
| 3     | Codex app-server client  | `packages/harnesses/src/codex` (ported from Happy)                                                         | Codex runs as an agent with approvals, interrupt, resume; types regenerated for the installed version                                          | ~1,300 |
| 4     | Delegation               | `packages/agent/src/tools/delegate.ts`, runner sub-runs, web rendering of `SUBAGENT_*`                     | Steward delegates to Codex, the chat shows the sub-run, a child approval interrupts the parent                                                 | ~700   |
| 5     | Claude direct (optional) | `packages/harnesses/src/claude`                                                                            | Only if `claude-agent-acp` proves too lossy (subagents, compaction, plan mode)                                                                 | ~500   |

Order: 1 first (it is small and shared with the directory), then 2 and 3 in parallel, then 4.
Phase 5 only after measuring the ACP adapter.

---

## 9. Verification

- **Unit:** the permission-kind mapping for every ACP `ToolKind` and Codex request type; answer
  mapping with and without `canAlways`; structured target extraction (never from titles); the
  compatibility table.
- **Integration:** a fake ACP agent (an ndjson fixture process) that asks for permission twice:
  once allowed by a rule, once parked; the resume run answers it and the agent finishes; a stopped
  run sends `cancelled` and the process exits; a leaked process test (none after the thread ends).
- **Codex:** the same against a recorded app-server transcript; a live smoke test when `codex` is
  installed, skipped otherwise.
- **Delegation:** parent → child → approval in child → parent interrupt → resume → result.
- **e2e:** pick "Steward on Grok" and "Steward on Claude" in the picker and get a reply from each
  (scripted model in CI, real keys locally).
- **Record:** every harness tool call appears with `harness:<id>` and the structured target.

---

## 10. Risks and open questions

- **Vendor terms** (§4.2): UNVERIFIED; a human must read the current Anthropic, OpenAI and xAI
  terms before this ships with "use your login". The fallback is API keys only, which already work.
- **Adapter fidelity:** `claude-agent-acp` may not forward subagents, compaction or plan mode;
  `codex-acp` lags the app-server. Hence the direct Codex client and the optional direct Claude
  path.
- **Reads are ungoverned** in every harness (§3). Documented; the workspace rule is the control.
- **Process hygiene:** app-server and ACP agents hang on unanswered requests; the parked-request
  store and generation-tied processes are the minimum.
- **Protocol drift:** Happy carries ~23k lines of harness code and a changelog of protocol chases.
  Pin versions; treat each harness upgrade as a protocol change; keep ACP as the default so Zed's
  adapters absorb most drift.
- **Rendering `SUBAGENT_*`:** whether `@copilotkit/react-core/v2` draws them is UNVERIFIED; plan
  for a Steward component.
