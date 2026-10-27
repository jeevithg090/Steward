# @steward/agent

The heart of Steward: the model, the tools, the system prompt and the AG-UI agent that runs them.
Every tool call it makes goes through the gateway (the `Governance` contract in `@steward/shared`,
implemented by `@steward/gateway`), and nothing in this package can act any other way.

```ts
import {
  loadTenant,
  resolveModelConfig,
  createModel,
  createTextModel,
  createStewardAgent,
} from "@steward/agent";

const tenant = loadTenant("tenants/steward");
const created = await createModel(resolveModelConfig(tenant, process.env), process.env);
const agent = createStewardAgent({
  profile: tenant.agents[0],
  tenant,
  model: created.model,
  governance,
  computers,
  mail: () => mail,
  web,
  mcp,
  stores,
  settings: () => settings,
  actorId: "local",
  serverRunToken,
});
// new CopilotRuntime({ agents: { [profile.id]: agent }, runner })
// Proactive gets a TextModel: createTextModel(created.model, created.label)
```

## Exports

| Export                                                                              | What it does                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadTenant(dir)`                                                                   | Reads `brand.yaml`, `agents.yaml`, `skills.yaml`, `rules.yaml`, `model.yaml`; validates with zod; fills defaults for missing files; throws `TenantError` naming the file and the field.                           |
| `resolveModelConfig(tenant, env, profile?)`                                         | Picks the provider, model and endpoint. `STEWARD_MODEL_PROVIDER`, `STEWARD_MODEL`, `STEWARD_MODEL_BASE_URL` override model.yaml; blank values count as unset. No key → the scripted model, with `fallbackReason`. |
| `createModel(cfg, env)`                                                             | Builds the AI SDK model with `createOpenAI(...).chat(id)` (always Chat Completions). For `scripted`, starts the in-process aimock server. Returns `{ model, label, scripted, close }`.                            |
| `createTextModel(model, label)`                                                     | A `TextModel` for triage and the brief, on `generateText`.                                                                                                                                                        |
| `createStewardAgent(deps)`                                                          | A `StewardAgent` (a `BuiltInAgent` that survives `clone()`) with the `GovernedToolsMiddleware`.                                                                                                                   |
| `GovernedToolsMiddleware`                                                           | The governed tool loop described below. Exported for the server and tests.                                                                                                                                        |
| `buildToolCatalogue`, `BUILTIN_TOOLS`, `grantedBuiltins`, `mcpTool`, `toAgUiTool`   | The tool catalogue.                                                                                                                                                                                               |
| `buildSystemPrompt`, `buildRunContext`                                              | The prompt and the per-run context.                                                                                                                                                                               |
| `startScriptedModel`, `scriptedReply`                                               | The scripted demo model, for e2e tests and demos.                                                                                                                                                                 |
| `sanitizeHistory`, `isTainted`, `envelopeFor`, `wrapUntrusted`, `modelErrorMessage` | Helpers the server and web may want.                                                                                                                                                                              |

## How a turn flows

```
browser / routine ──RunAgentInput──► runtime ──clone()──► StewardAgent.runAgent
                                                          │
                                         GovernedToolsMiddleware.run
                                                          │
  1. RUN_STARTED
  2. resume entries? ──► governance.resume(call)  (the database decides, never the payload)
  3. add per-run context (date, memory, skill, plain language, mailbox, who started it)
  4. loop, at most 24 model calls:
       BuiltInAgent (maxSteps 1, no tools of its own) streams text and tool calls
       for each new call to a Steward tool:
          toGateCall(args)  → target (url/host, element, path, command, recipients, mcp) + outbound text
          GateCall          → initiator, intent, tainted
          governance.execute(call, () => tool.execute(args))
             done     → TOOL_CALL_RESULT { ok: true, data }   (untrusted results wrapped)
             refused  → TOOL_CALL_RESULT { ok: false, refused: true, rule?, message }
             failed   → TOOL_CALL_RESULT { ok: false, error }
             parked   → CUSTOM steward.approval.requested { approval }
                        RUN_FINISHED { outcome: interrupt, interrupts: [{ id: toolCallId, reason: "steward_approval", metadata }] }
       no new calls → RUN_FINISHED
```

- **Tools are offered, never registered.** Every Steward tool goes to the model as an AG-UI
  client-style tool with no executor, so the AI SDK stops at each call and hands it to the
  middleware. Nothing goes in `BuiltInAgent.tools`, where it would run ungoverned.
- **Approvals are interrupts.** A parked call ends the run. The approval card posts the answer to
  `POST /api/approvals/:id/decision`, then resumes with `resume: [{ interruptId: toolCallId, ... }]`.
  The middleware calls `governance.resume`, which claims the answer once. `status: "cancelled"` is
  a refusal, but still goes to `resume` so the approval closes. If every resume entry is already
  answered in the history (a double resume), the run finishes without calling the model.
- **Taint.** `GateCall.tainted` is true once any tool whose catalogue entry says `taints: true`
  (or any MCP tool) has a result in the conversation, counting this run. A result that says the
  call was refused does not count: it read nothing.
- **Initiator.** `person` unless `forwardedProps.steward` is `{ token: serverRunToken, initiator }`,
  compared in constant time. The token is stripped before the model run.
- **History.** Dangling tool calls (an interrupted turn, an approval nobody answered before the
  person wrote again) are dropped before every model call, so one never breaks the conversation.
- **Stop.** `StewardAgent.abortRun()` also aborts the tool that is running, not only the model stream.
- **Never throws.** Model errors become one `RUN_ERROR` in plain words; gateway errors become a
  refusal (fail closed); anything else becomes `RUN_ERROR` with code `STEWARD_AGENT_ERROR`.

## Tool results

What the model reads, and what the web app receives in `TOOL_CALL_RESULT.content` (JSON):

```ts
{ ok: true, data }                                   // data from tools with taints: false
{ ok: true, data: { untrusted: true, notice, data } } // pages, mail, files, shell output, MCP, the brief
{ ok: false, refused: true, rule?: string, message } // a rule or the person said no
{ ok: false, error: string }                          // it failed, or the arguments were wrong
```

Display tools (`show_*`) return `{ shown: true }`; the web app draws them from the call's arguments.

## The tools

| Tool                                                                  | Kind             | Surface  | Taints    | Target the gateway sees                                                 |
| --------------------------------------------------------------------- | ---------------- | -------- | --------- | ----------------------------------------------------------------------- |
| `browser_navigate`                                                    | read             | browser  | yes       | `url`, `host` (https added if missing)                                  |
| `browser_snapshot`, `browser_scroll`, `browser_back`, `browser_press` | read/write       | browser  | yes       | current page `url`, `host`                                              |
| `browser_click`                                                       | write            | browser  | yes       | page + `element { ref, role, name }` from the computer, never the model |
| `browser_type`                                                        | write            | browser  | yes       | page + element; `outbound` = the text                                   |
| `request_help`                                                        | ui               | browser  | no        | current page                                                            |
| `request_secret`                                                      | write            | browser  | no        | page + element; the result is only `{ filled, characters }`             |
| `file_list`, `file_read`, `file_write`                                | read/write       | file     | read only | `path`                                                                  |
| `shell_run`                                                           | shell            | shell    | yes       | `command`                                                               |
| `mail_list`, `mail_read`                                              | read             | mail     | yes       | none                                                                    |
| `mail_send`                                                           | send             | mail     | no        | `recipients`; `outbound` = subject + body                               |
| `calendar_list`                                                       | read             | calendar | yes       | none                                                                    |
| `calendar_create`                                                     | write            | calendar | no        | `recipients` = attendees; `outbound` when there are any                 |
| `web_fetch`                                                           | read             | web      | yes       | `url`, `host`                                                           |
| `web_search`                                                          | read             | web      | yes       | none                                                                    |
| `memory_remember`                                                     | write            | memory   | no        | none                                                                    |
| `task_create`, `task_update`, `routine_create`                        | write            | task     | no        | none                                                                    |
| `brief_today`, `triage_inbox`                                         | read             | mail     | yes       | none                                                                    |
| `show_table`, `show_chart`, `show_comparison`, `show_choices`         | ui               | ui       | no        | none                                                                    |
| `make_page`                                                           | write            | file     | no        | `path` = `made/<slug>.md` or `.html`                                    |
| `mcp__<server>__<tool>`                                               | from the manager | mcp      | yes       | `mcp { server, tool }`; `outbound` for writes                           |

Kinds, surfaces and taint come from `TOOLS` in `@steward/shared`; this package never restates them.

## Adding a tool

1. Add its name, kind, surface and `taints` to `TOOLS` in `packages/shared/src/tools.ts` (the lead
   owns that file). The gateway's defaults and presets key off this entry.
2. Declare it with `builtin(name, { description, parameters, toGateCall, execute })` in the right
   file under `src/tools/`. Write the description for the model: when to use it, what comes back,
   and what never to do with it. Parameters are a JSON Schema object built with the helpers in
   `src/tools/schema.ts`; give every property a description.
3. `toGateCall` must resolve everything the gateway decides on (what it touches, what text leaves)
   and must not act. Throw an `ArgumentError` for arguments that can never work: the model hears
   at once and the person is never asked about a call that would fail.
4. `execute` acts. Return plain data; the middleware wraps it in the envelope and marks it untrusted
   when the tool taints.
5. Add it to the file's exported list. `test/tools.test.ts` fails until every `TOOLS` entry has
   exactly one tool with a portable schema.

## Models

| Provider            | Endpoint                                                  | Key                               |
| ------------------- | --------------------------------------------------------- | --------------------------------- |
| `openrouter`        | `https://openrouter.ai/api/v1`                            | `OPENROUTER_API_KEY`              |
| `openai`            | `https://api.openai.com/v1`                               | `OPENAI_API_KEY`                  |
| `anthropic`         | `https://api.anthropic.com/v1` (OpenAI-compatible)        | `ANTHROPIC_API_KEY`               |
| `nvidia`            | `https://integrate.api.nvidia.com/v1`                     | `NVIDIA_API_KEY`                  |
| `gemini`            | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY`                  |
| `ollama`            | `http://127.0.0.1:11434/v1`                               | none                              |
| `openai-compatible` | `STEWARD_MODEL_BASE_URL`                                  | `STEWARD_MODEL_API_KEY`, optional |
| `scripted`          | in-process aimock on a free loopback port                 | none                              |

model.yaml may name a different key variable with `apiKeyEnv` (the name, never the key).

**The scripted demo model** answers from `fixtures/scripted.json` (aimock's fixture shape, matched
ignoring case and only before a tool has returned in the turn) and from `src/scripted.ts`:
greetings, "What needs me today?", "Open <site>" and "top story", "Email <address> about …",
"Remember that …", "Every weekday at 8, …", "search for …", "table", "compare". After a tool returns
it answers from the result in a sentence or two and says it is the scripted demo model. It never
calls a tool it was not offered and never addresses the person by name.

## Tenant packages

```
tenants/<id>/brand.yaml   name, tagline, accent, voice, starters
tenants/<id>/agents.yaml  agents: [{ id, name, title, instructions, skills, tools, model? }]
tenants/<id>/skills.yaml  skills: [{ name, description, instructions, tools }]
tenants/<id>/rules.yaml   rules: [{ name, effect: allow|ask|deny, when, description }]
tenants/<id>/model.yaml   provider, model, baseUrl?, apiKeyEnv?
```

Unknown fields are errors, so a typo never silently does nothing. Tool names must be built-in
names, `*`, or `mcp__…`; an agent's skills must exist in skills.yaml.

## Tests

```sh
pnpm vitest run --root packages/agent      # aimock as the model, in-memory fakes for everything else
pnpm --filter @steward/agent typecheck
pnpm biome check packages/agent
```
