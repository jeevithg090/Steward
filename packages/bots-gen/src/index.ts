/**
 * @steward/bots-gen: the generator behind the directory's AI-made bots and the app's Make a bot
 * (docs/plans/bot-directory.md §4), the quality judge, and the converters for the seeds we take
 * from LobeChat and OpenBot. The CLI in `cli.ts` runs them: `pnpm --filter @steward/bots-gen seed`.
 */

export { type BatchOptions, freeId, generateBatch, type LogRow } from "./batch.ts";
export {
  convertLobeAgent,
  isEnglishLobeFile,
  LOBE_CATEGORY_MAP,
  LOBE_TAG_MAP,
  type LobeConversion,
  lobeCategory,
} from "./convert/lobe.ts";
export { convertOpenBotCoworker, OPENBOT_SKILL_TOOLS, OPENBOT_STARTERS } from "./convert/openbot.ts";
export {
  bandFrom,
  type ConfirmSame,
  confirmWithModel,
  cosine,
  createEmbedder,
  DEFAULT_NVIDIA_EMBED_MODEL,
  type Embedder,
  type EmbedderConfig,
  EmbeddingCache,
  embedderConfig,
  MAYBE_DUPLICATE,
  type NearDuplicate,
  type NearItem,
  nearDuplicates,
  normalise,
  packCard,
  packText,
  type SemanticDedupeResult,
  SURE_DUPLICATE,
  semanticDedupe,
  similarPairs,
} from "./embed.ts";
export {
  assembleCandidate,
  type GenerateContext,
  type GenerateInput,
  type GenerateResult,
  generateBot,
  guessCategory,
  type Problem,
  templatePack,
  toolsForJob,
} from "./generate.ts";
export {
  AI_JOBS_PATH,
  interleaveByCategory,
  JOBS_FILE,
  type Job,
  JobSchema,
  loadJobs,
  parseJobs,
} from "./jobs.ts";
export { ModelJsonError, parseJsonObject, repairTrailingCommas, stripFences } from "./json.ts";
export {
  type DedupeResult,
  DUPLICATE_OVERLAP,
  dedupe,
  JUDGE_BAR,
  type Judgement,
  judgeBot,
  parseJudgement,
} from "./judge.ts";
export {
  createOpenAICompatibleModel,
  createSeedModel,
  DEFAULT_NVIDIA_SEED_MODEL,
  NVIDIA_BASE_URL,
  type OpenAICompatibleOptions,
  type SeedModelConfig,
  seedModelConfig,
} from "./model.ts";
export {
  buildGeneratePrompt,
  buildGenerateSystem,
  buildJudgePrompt,
  type GenerateHints,
  isPackTool,
  RULE_MENU,
  WRITING_RULES,
} from "./prompt.ts";
export {
  applyRetirement,
  CATEGORY_FLOOR,
  type Counts,
  type PlanOptions,
  planRetirement,
  RETIRE_AFTER_DAYS,
  RETIRED_FILE,
  type RegenerateOptions,
  type RetiredEntry,
  RetiredEntrySchema,
  type RetirementPlan,
  type RetirementRun,
  type RunRetirementOptions,
  readCounts,
  readRetired,
  runRetirement,
  writeRetired,
} from "./retire.ts";
export {
  AI_JOBS_FILE,
  buildJobsPrompt,
  buildJobsSystem,
  type Proposal,
  parseProposedJobs,
  proposeJobs,
  readAiJobs,
  writeAiJobs,
} from "./taxonomy.ts";
export { nameFromJob, slugify } from "./text.ts";
