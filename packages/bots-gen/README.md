# @steward/bots-gen

The generator behind the directory's AI-made bots and the app's **Make a bot**
(docs/plans/bot-directory.md §4), the quality judge, and the converters for the seeds we take from
other open-source catalogues. Every pack it makes goes through `validatePack` from `@steward/bots`
and is labelled AI-made; nothing here can loosen the gateway.

```ts
import { generateBot, judgeBot, dedupe, convertLobeAgent, convertOpenBotCoworker } from "@steward/bots-gen";

const { pack, problems, madeBy } = await generateBot(
  { job: "chase the invoice that is 30 days late" },
  { model, tools: Object.keys(TOOLS), validateRule: (when) => engine.validate(when) },
);
```

## Exports

| Export                                                                    | What it does                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generateBot(input, ctx)`                                                 | One job in, one pack out. With `ctx.model`: one call carrying Steward's writing rules, parsed robustly (fences, prose, trailing commas), validated, retried once with the problems appended. Without a model, or when the model's answer cannot pass: a deterministic template pack. |
| `templatePack(input, ctx)`                                                | The template path on its own: name from the job, pitch = the job sentence, tools from the job's words (or `ctx.hints`), two starters, one example. Same input, same pack.                                                                                                            |
| `judgeBot(pack, model)`                                                   | A second call scoring usefulness, honesty and clarity 1–5 with one sentence each. `{ score, notes, scores }`; the batch runner drops anything under `JUDGE_BAR` (3.5).                                                                                                               |
| `dedupe(packs, existing?)`                                                | Drops a pack whose name + pitch tokens overlap an earlier one (or one on the shelf) by more than 0.8. `{ kept, dropped: [{ id, duplicateOf }] }`.                                                                                                                                    |
| `convertLobeAgent(json, { file? })`                                       | A LobeChat agent file → `{ ok: true, pack }` or `{ ok: false, reason }` (not English, under 80 characters, over 20,000, or fails the injection scan). Chat-only; a research tag adds web search. Category from `LOBE_TAG_MAP` then `LOBE_CATEGORY_MAP`.                              |
| `convertOpenBotCoworker(yaml)`                                            | An OpenBot coworker YAML → a `work` pack with a deny-send rule, credited to OpenBot.                                                                                                                                                                                                 |
| `loadJobs()`, `parseJobs(text)`, `interleaveByCategory(jobs)`             | The taxonomy in `src/jobs.yaml`: about 220 jobs across the 19 categories, each with the tools and connectors it probably needs.                                                                                                                                                      |
| `seedModelConfig(env)`, `createSeedModel(cfg)`                            | An OpenAI-compatible `TextModel` from `STEWARD_SEED_BASE_URL` / `STEWARD_SEED_API_KEY` / `STEWARD_SEED_MODEL`, or `NVIDIA_API_KEY` with Nemotron 3 Ultra (thinking off).                                                                                                             |
| `buildGenerateSystem`, `buildGeneratePrompt`, `RULE_MENU`, `isPackTool`   | The prompts, the `when` conditions a generated rule may use, and which tools a pack may hold (never `request_secret`; of the `show_*` tools only `show_table` and `show_comparison`).                                                                                                |
| `generateBatch(opts)`                                                     | One run over many jobs: model, judge, validators and the near-duplicate check, writing each pack the moment it passes. The CLI and the directory's retirement task both use it.                                                                                                      |
| `semanticDedupe(packs, existing, opts)`, `nearDuplicates`, `similarPairs` | Near-duplicates by meaning (see below). Falls back to the word-overlap `dedupe` when there is no embedder or it fails, and says which ran.                                                                                                                                           |
| `createEmbedder(cfg)`, `embedderConfig(env)`, `EmbeddingCache`            | Any OpenAI-compatible `/embeddings` endpoint; NVIDIA's Nemotron 3.5 Embed 1B by default with `NVIDIA_API_KEY`. Vectors are cached by text hash in `.steward-data/seeds/embeddings/<model>.jsonl`.                                                                                    |
| `proposeJobs`, `readAiJobs`, `writeAiJobs`                                | Growing the taxonomy: a model proposes jobs per category, checked against the listed jobs and retired bots, written to `src/jobs-ai.yaml` (marked not yet read by a person). `loadJobs()` reads both files.                                                                          |
| `planRetirement`, `runRetirement`, `readRetired`                          | Retirement (plan §4.6): AI-made bots nobody installed or used in 90 days leave the shelf for `directory/retired.json`; categories that lost bots and fell under the floor are topped up.                                                                                             |
| `fetchWithRetry`, `createPace`, `sharedPace`                              | Retries 429 and 5xx answers (honouring `Retry-After`) and spaces requests evenly, shared by everything calling one endpoint with one key.                                                                                                                                            |

`ctx.validateRule` is the gateway's `CelEngine.validate`. The seed CLI does not depend on
`@steward/gateway`, so it uses `src/compat/rules.ts`, a conservative subset check; `seed build`
runs every rule through the real engine via `buildIndex`.

## Near-duplicates by meaning

"Plans a week of dinners" and "Writes a weekly meal plan" share almost no words, so the word
check misses them. Each pack's `name. pitch` is embedded and compared by cosine similarity, in a
band chosen on the 28 Oct 2026 shelf with fourteen hand-labelled pairs:

| Similarity   | What happens                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 0.90 and up  | A duplicate.                                                                                                         |
| 0.80 to 0.90 | The judge model is asked one word, SAME or DIFFERENT. It got all fourteen pairs right. With no model, both are kept. |
| Under 0.80   | Different.                                                                                                           |

No single line works on its own: two meeting-notes bots that do the same job sat at 0.85, while
translators for two different languages sat at 0.87. `STEWARD_EMBED_SURE` and
`STEWARD_EMBED_MAYBE` move the band for another embedding model; `STEWARD_EMBED_BASE_URL` +
`STEWARD_EMBED_MODEL` (+ `STEWARD_EMBED_API_KEY`) name another endpoint.

## The seed CLI

```
pnpm --filter @steward/bots-gen seed convert-openbot            # seeds/openbot/*.yaml → directory/bots/openbot-*
pnpm --filter @steward/bots-gen seed convert-lobe [--limit N]   # downloads lobe-chat-agents/src to .steward-data/seeds/lobe/
pnpm --filter @steward/bots-gen seed jobs [--target 115] [--category food] [--per-call 25]   # grows src/jobs-ai.yaml
pnpm --filter @steward/bots-gen seed generate --limit 60 [--category money] [--concurrency 4] [--template] [--no-judge] [--retry-dropped]
pnpm --filter @steward/bots-gen seed dedupe [--confirm]                # near-twins on the shelf; changes nothing
pnpm --filter @steward/bots-gen seed retire [--now 2027-02-01] [--apply] [--regenerate]
pnpm --filter @steward/bots-gen seed build [--site https://…]   # directory/index.json and directory/packs/<id>.json
pnpm --filter @steward/bots-gen seed report [--write]           # counts by category and author; problems; what was dropped and why
pnpm biome check --write directory                             # biome formats the written Markdown and JSON; content and hashes are unchanged
```

`STEWARD_SEED_JUDGE_MODEL` puts the judge (and the duplicate check's one-word question) on another
model at the same endpoint. On NVIDIA's hosted API on 28 Oct 2026, Nemotron 3 Ultra writing took
a median of about two minutes a bot for one worker; Nemotron 3.5 Lightning writing with Ultra
judging took under one, at the same bar. The writer is recorded in each pack's `author.model`.

Every model and embedding call is paced to `STEWARD_SEED_RPM` requests a minute (35 by default
for NVIDIA's hosted API, whose limit is 40; 0 for no pacing) and retried on 429 and 5xx with a
backoff of up to about four minutes. A rerun of `generate` skips jobs that have a bot and jobs
dropped for a reason that would repeat (a duplicate, below the bar, retired, failed validation);
`--retry-dropped` tries those again. Jobs dropped because the model failed are always retried.

`generate` reads the model from the environment (never from a file): export `NVIDIA_API_KEY`, or
`STEWARD_SEED_BASE_URL` + `STEWARD_SEED_MODEL` (+ `STEWARD_SEED_API_KEY`) for any other
OpenAI-compatible endpoint. With no key, or a key that fails a probe call, it says so and uses the
template generator. Each run appends to `directory/generate-log.jsonl` (committed with the packs,
so a run resumes from any checkout) and skips jobs
that already have a bot. Packs are written with `writeBotFolder` to `directory/bots/<id>/`; a
clash of ids gets `-2`, `-3`.

## Tests

`pnpm vitest run packages/bots-gen`: template generation yields a valid pack; the model path with
a fake model returning fenced JSON with trailing commas; an allow rule is refused, retried and
falls back; judge parsing; dedupe; the LobeChat converter on a real file; the OpenBot converter on
a real YAML; `jobs.yaml` parses and names only tools that exist. With a fake embedder and a fixed
clock: the embedding cache, the band and its model question, the word-overlap fallback, job
proposals and `jobs-ai.yaml`, retries and pacing, retirement (90 days, installs and votes keep a
bot, people's bots are never retired, the retired list, top-up of thinned categories) and
`generateBatch`.

## Licences and credit

- `seeds/openbot/`: CopilotKit OpenBot, MIT.
- `.steward-data/seeds/lobe/` (downloaded, not committed) and `test/fixtures/lobe/`: LobeHub's
  agent index, MIT; each converted pack credits its author.
- Generated packs: MIT, `author: { kind: ai, model, generated }`.
