# Models

Steward talks to every model through the OpenAI Chat Completions API, so it works with any
provider that speaks it: OpenRouter, OpenAI, Anthropic, Gemini and xAI (through their
OpenAI-compatible endpoints), NVIDIA, Ollama, or anything else you point it at. Without a key it runs a scripted demo
model, so the whole product works on first run, and says so on every page.

## Choosing one

Steward picks the model in this order, and the first that is set wins:

1. **Settings → Model** in the app. Saved in Steward's database, applied without a restart.
2. **Environment variables:** `STEWARD_MODEL_PROVIDER`, `STEWARD_MODEL` and
   `STEWARD_MODEL_BASE_URL`, usually in `.env`.
3. **The tenant package:** `tenants/<id>/model.yaml`. Steward's own asks for
   `anthropic/claude-sonnet-5.5` through OpenRouter.
4. **The provider's default model,** when a provider is chosen but no model is named.

The key always comes from the environment, from the variable named in the table below (or the one
`model.yaml` names in `apiKeyEnv`). It is never stored in the database, never in a tenant package,
and never shown in the app.

## Providers

| `STEWARD_MODEL_PROVIDER` | Key                     | Endpoint                                                  | Model if you name none              |
| ------------------------ | ----------------------- | --------------------------------------------------------- | ----------------------------------- |
| `openrouter`             | `OPENROUTER_API_KEY`    | `https://openrouter.ai/api/v1`                            | `anthropic/claude-sonnet-5.5`       |
| `openai`                 | `OPENAI_API_KEY`        | `https://api.openai.com/v1`                               | `gpt-5.6-terra`                     |
| `anthropic`              | `ANTHROPIC_API_KEY`     | `https://api.anthropic.com/v1` (OpenAI-compatible)        | `claude-sonnet-5-5`                 |
| `gemini`                 | `GEMINI_API_KEY`        | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash`                  |
| `nvidia`                 | `NVIDIA_API_KEY`        | `https://integrate.api.nvidia.com/v1`                     | `nvidia/nemotron-3-ultra-550b-a55b` |
| `xai`                    | `XAI_API_KEY`           | `https://api.x.ai/v1`                                     | `grok-4.7`                          |
| `ollama`                 | none                    | `http://127.0.0.1:11434/v1`                               | `llama3.2`                          |
| `openai-compatible`      | `STEWARD_MODEL_API_KEY` | `STEWARD_MODEL_BASE_URL` (required)                       | set `STEWARD_MODEL`                 |
| `scripted`               | none                    | in-process                                                | the scripted demo model             |

The defaults live in `PROVIDERS` in `packages/agent/src/model.ts`; check there for the current list.
`STEWARD_MODEL_BASE_URL` overrides any provider's endpoint, which is how you reach a proxy, a
regional endpoint or a self-hosted gateway.

### Examples

OpenRouter, which reaches most models with one key:

```sh
OPENROUTER_API_KEY=sk-or-...
STEWARD_MODEL_PROVIDER=openrouter
STEWARD_MODEL=anthropic/claude-sonnet-5.5
```

Ollama on this machine, with no key and nothing leaving it:

```sh
STEWARD_MODEL_PROVIDER=ollama
STEWARD_MODEL=llama3.2
```

Any other OpenAI-compatible server (vLLM, LM Studio, LiteLLM, a company gateway):

```sh
STEWARD_MODEL_PROVIDER=openai-compatible
STEWARD_MODEL_BASE_URL=http://127.0.0.1:8000/v1
STEWARD_MODEL=my-model
STEWARD_MODEL_API_KEY=...
```

## Choosing a good model

Steward leans on tool calling: it plans several steps, reads pages, fills in forms and decides what
to show. Small models answer chat well and plan poorly. For real work, use a model that is good at
tool use and follows long instructions. The demo was tuned on Claude Sonnet 5.5 through OpenRouter.

A local model through Ollama keeps everything on your machine, at the cost of planning. The
gateway does not depend on the model behaving: a weaker model makes more mistakes, but the same
calls ask, and the same calls are refused.

## One agent, another model

An agent in `agents.yaml` can name its own model with `model:`, and keeps it whatever Settings
says; Settings changes the model of the agents that name none. Useful when one agent does heavy
research and another only sorts mail, and how "Steward on Claude" and "Steward on Grok" sit side
by side in the agent picker:

```yaml
agents:
  - id: steward # the model from Settings, .env or model.yaml
    name: Steward
  - id: steward-claude
    name: Steward on Claude
    model: anthropic/claude-sonnet-5.5 # an id on the tenant's provider (OpenRouter here)
  - id: steward-grok
    name: Steward on Grok
    model: xai/grok-4.7 # provider/model: Grok straight from xAI
```

- A **bare id** (`anthropic/claude-sonnet-5.5`, `gpt-5.6-terra`) is a model on the tenant's
  provider from `model.yaml`, with that provider's key.
- **`provider/model`** names one of the providers in the table above and a model on it:
  `xai/grok-4.7`, `gemini/gemini-3.5-flash`, `ollama/llama3.2`, `openai/gpt-5.6-terra`. The key
  comes from that provider's variable.
- OpenRouter and NVIDIA list models under vendor names, and three of those (`anthropic`,
  `openai`, `nvidia`) are also Steward providers. On an OpenRouter or NVIDIA tenant such an id
  stays on the tenant's provider: `anthropic/claude-sonnet-5.5` is an OpenRouter id, and
  `nvidia/nemotron-3-ultra-550b-a55b` an NVIDIA one. On any other tenant it names the provider.
  Naming the tenant's own provider again is a prefix (`openrouter/anthropic/claude-sonnet-5.5`).
- An installed bot whose pack names a model reads it the same way, but as a preference rather
  than a pin: it runs on that model when the provider has a key, and on the default model
  otherwise. On the scripted demo model, bots run on the demo model too.

An agent whose provider has no key is still listed, greyed out, with the reason ("No xAI key is
set"), and answers with that sentence if a conversation reaches it anyway. Add the key to `.env`
and restart, and it can take a conversation. `GET /api/agents` says the same for every agent:
its provider, its model, whether it can answer, and why not.

## What a run cost

Every finished run gets a "Finished work" entry in the record with how it ended and the tokens it
used, per provider and model, as the provider reported them (AG-UI `RUN_FINISHED.usage`). Steward
counts tokens; it never guesses money.

## The scripted demo model

With `STEWARD_MODEL_PROVIDER=scripted`, or with no key for the chosen provider, Steward starts a
small scripted model in-process (built on `@copilotkit/aimock`, on a random loopback port). It answers like a model would, calls real tools, and reads their results, so the
brief, the computer, approvals, rules and the record all work for real. It does not understand
language: it recognises a handful of requests and says so.

| Try                                                    | What it does                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| "hello"                                                | Says hello, says it is the scripted demo model, and suggests what to try. |
| "What needs me today?"                                 | Calls `brief_today` on the demo inbox and summarises it.                  |
| "Open news.ycombinator.com and tell me the top story." | Opens the page on the agent's computer and reads the first headline.      |
| "Email sam@example.com about Friday: see you at 10"    | Calls `mail_send`, which asks you first.                                  |
| "Remember that I prefer morning meetings"              | Calls `memory_remember`.                                                  |
| "Every weekday at 8, check my mail"                    | Calls `routine_create` with a cron schedule.                              |
| "Search the web for …"                                 | Calls `web_search`.                                                       |
| "Compare …" or "Show me a table"                       | Draws a comparison or a table.                                            |

Everything it says ends by saying it is the scripted model, and the app shows "Scripted model" in
the demo ribbon on every page. When there was a key problem, the model's label says why, such as
"Scripted demo model (no key for openrouter)".

Triage and the brief summary ask the model for a short structured answer. The scripted model has
none to give, so they fall back to rules and say so; nothing is guessed.

The script is `packages/agent/fixtures/scripted.json`, in aimock's fixture format, plus the request
matching in `packages/agent/src/scripted.ts`. The end-to-end tests run against it.

## The triage eval

`pnpm eval:triage` measures how well a model sorts mail into "needs you" and "can wait", against a
labelled set of invented messages in `evals/triage`. It reads its own variables, so it never uses
the model your Steward is running on by accident:

| Variable                                                              | What it does                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `STEWARD_EVAL_BASE_URL`, `STEWARD_EVAL_MODEL`, `STEWARD_EVAL_API_KEY` | Any OpenAI-compatible endpoint.                      |
| `OPENROUTER_API_KEY`, optional `STEWARD_EVAL_MODEL`                   | OpenRouter, `anthropic/claude-haiku-5.5` by default. |

With neither, only the rules run. See [`evals/triage/README.md`](../evals/triage/README.md).

## Privacy

Steward sends nothing anywhere except to the model provider you chose. There is no telemetry: the
server switches CopilotKit's off at boot. What reaches the provider is the conversation, Steward's
instructions, the tool definitions and tool results, which can include your mail and pages the
agent read. Secrets typed into the secret box never do. If that matters, use Ollama or another
model you run yourself.

## Provider notes

- **NVIDIA.** Nemotron models think before every reply unless told not to, which makes each tool
  call take about 20 seconds. Steward turns thinking off (`chat_template_kwargs.enable_thinking`);
  set `STEWARD_NVIDIA_THINKING=1` to turn it back on.
- **Credit.** Some providers judge an account's balance against the most a reply may write, not
  what it does write. Steward reserves 4096 tokens per reply (`STEWARD_MODEL_MAX_TOKENS`). If
  replies fail with "out of credit", add credit or lower that number. The setup checklist makes the
  same reservation, so it says "needs credit" before a conversation does.
- **Gemini.** Gemini's OpenAI-compatible endpoint returns "thought signatures" with tool calls that
  must be sent back on the next turn. Steward's OpenAI-shaped client does not keep them yet, so
  long tool loops on Gemini may fail; prefer OpenRouter, NVIDIA or OpenAI for now.
