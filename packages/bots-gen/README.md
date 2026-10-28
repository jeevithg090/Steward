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

| Export                                                                  | What it does                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generateBot(input, ctx)`                                               | One job in, one pack out. With `ctx.model`: one call carrying Steward's writing rules, parsed robustly (fences, prose, trailing commas), validated, retried once with the problems appended. Without a model, or when the model's answer cannot pass: a deterministic template pack. |
| `templatePack(input, ctx)`                                              | The template path on its own: name from the job, pitch = the job sentence, tools from the job's words (or `ctx.hints`), two starters, one example. Same input, same pack.                                                                                                            |
| `judgeBot(pack, model)`                                                 | A second call scoring usefulness, honesty and clarity 1–5 with one sentence each. `{ score, notes, scores }`; the batch runner drops anything under `JUDGE_BAR` (3.5).                                                                                                               |
| `dedupe(packs, existing?)`                                              | Drops a pack whose name + pitch tokens overlap an earlier one (or one on the shelf) by more than 0.8. `{ kept, dropped: [{ id, duplicateOf }] }`.                                                                                                                                    |
| `convertLobeAgent(json, { file? })`                                     | A LobeChat agent file → `{ ok: true, pack }` or `{ ok: false, reason }` (not English, under 80 characters, over 20,000, or fails the injection scan). Chat-only; a research tag adds web search. Category from `LOBE_TAG_MAP` then `LOBE_CATEGORY_MAP`.                              |
| `convertOpenBotCoworker(yaml)`                                          | An OpenBot coworker YAML → a `work` pack with a deny-send rule, credited to OpenBot.                                                                                                                                                                                                 |
| `loadJobs()`, `parseJobs(text)`, `interleaveByCategory(jobs)`           | The taxonomy in `src/jobs.yaml`: about 220 jobs across the 19 categories, each with the tools and connectors it probably needs.                                                                                                                                                      |
| `seedModelConfig(env)`, `createSeedModel(cfg)`                          | An OpenAI-compatible `TextModel` from `STEWARD_SEED_BASE_URL` / `STEWARD_SEED_API_KEY` / `STEWARD_SEED_MODEL`, or `NVIDIA_API_KEY` with Nemotron 3 Ultra (thinking off).                                                                                                             |
| `buildGenerateSystem`, `buildGeneratePrompt`, `RULE_MENU`, `isPackTool` | The prompts, the `when` conditions a generated rule may use, and which tools a pack may hold (never `request_secret`; of the `show_*` tools only `show_table` and `show_comparison`).                                                                                                |

`ctx.validateRule` is the gateway's `CelEngine.validate`. The seed CLI does not depend on
`@steward/gateway`, so it uses `src/compat/rules.ts`, a conservative subset check; `seed build`
runs every rule through the real engine via `buildIndex`.

## The seed CLI

```
pnpm --filter @steward/bots-gen seed convert-openbot            # seeds/openbot/*.yaml → directory/bots/openbot-*
pnpm --filter @steward/bots-gen seed convert-lobe [--limit N]   # downloads lobe-chat-agents/src to .steward-data/seeds/lobe/
pnpm --filter @steward/bots-gen seed generate --limit 60 [--category money] [--concurrency 4] [--template] [--no-judge]
pnpm --filter @steward/bots-gen seed build [--site https://…]   # directory/index.json and directory/packs/<id>.json
pnpm --filter @steward/bots-gen seed report [--write]           # counts by category and author; problems; what was dropped and why
pnpm biome check --write directory                             # biome formats the written Markdown and JSON; content and hashes are unchanged
```

`generate` reads the model from the environment (never from a file): export `NVIDIA_API_KEY`, or
`STEWARD_SEED_BASE_URL` + `STEWARD_SEED_MODEL` (+ `STEWARD_SEED_API_KEY`) for any other
OpenAI-compatible endpoint. With no key, or a key that fails a probe call, it says so and uses the
template generator. Each run appends to `.steward-data/seeds/generate-log.jsonl` and skips jobs
that already have a bot. Packs are written with `writeBotFolder` to `directory/bots/<id>/`; a
clash of ids gets `-2`, `-3`.

## Tests

`pnpm vitest run packages/bots-gen`: template generation yields a valid pack; the model path with
a fake model returning fenced JSON with trailing commas; an allow rule is refused, retried and
falls back; judge parsing; dedupe; the LobeChat converter on a real file; the OpenBot converter on
a real YAML; `jobs.yaml` parses and names only tools that exist.

## Licences and credit

- `seeds/openbot/`: CopilotKit OpenBot, MIT.
- `.steward-data/seeds/lobe/` (downloaded, not committed) and `test/fixtures/lobe/`: LobeHub's
  agent index, MIT; each converted pack credits its author.
- Generated packs: MIT, `author: { kind: ai, model, generated }`.
