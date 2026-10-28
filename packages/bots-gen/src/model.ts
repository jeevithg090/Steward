import type { TextModel } from "@steward/shared";

/**
 * The model the seed CLI writes bots with: any OpenAI-compatible Chat Completions endpoint, with
 * nothing but `fetch`. The pattern is `packages/proactive/src/eval/model.ts`; this copy adds a
 * temperature and an extra request body, which NVIDIA's reasoning models need to answer without
 * thinking out loud.
 *
 * Errors name the status and never echo the response body: provider errors can repeat parts of
 * the key, and seed output gets committed.
 */

export interface OpenAICompatibleOptions {
  /** The API root, such as `https://integrate.api.nvidia.com/v1`. `/chat/completions` is added. */
  baseUrl: string;
  /** Sent as a bearer token. Optional for local servers such as Ollama. */
  apiKey?: string;
  model: string;
  /** Per request. Default 180 seconds: a large model writing a whole pack takes a while. */
  timeoutMs?: number;
  /** 0 for the judge, a little above for variety when writing. Default 0. */
  temperature?: number;
  /** Merged into the request body, such as `chat_template_kwargs`. */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** For tests. */
  fetch?: typeof fetch;
}

export function createOpenAICompatibleModel(opts: OpenAICompatibleOptions): TextModel {
  const url = `${opts.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetch ?? fetch;

  return {
    label: opts.model,
    async complete({ system, prompt, maxTokens, signal }) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
          ...opts.headers,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          max_tokens: maxTokens ?? 4096,
          temperature: opts.temperature ?? 0,
          ...opts.extraBody,
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`The model endpoint answered ${response.status}.`);
      const data = (await response.json()) as {
        choices?: { message?: { content?: string | { type?: string; text?: string }[] | null } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        const text = content.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
        if (text.trim()) return text;
      }
      throw new Error("The model endpoint returned no text.");
    },
  };
}

export interface SeedModelConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Where the settings came from, for the report. Never the key. */
  via: string;
}

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NVIDIA_SEED_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

/**
 * The model the seed run should use, from the environment, or undefined for the template
 * generator. `STEWARD_SEED_BASE_URL` + `STEWARD_SEED_MODEL` (+ `STEWARD_SEED_API_KEY`) win;
 * otherwise `NVIDIA_API_KEY` uses NVIDIA with `STEWARD_SEED_MODEL` or Nemotron 3 Ultra. Blank
 * values count as unset.
 */
export function seedModelConfig(env: Record<string, string | undefined>): SeedModelConfig | undefined {
  const value = (name: string) => env[name]?.trim() || undefined;
  const baseUrl = value("STEWARD_SEED_BASE_URL");
  const model = value("STEWARD_SEED_MODEL");
  const apiKey = value("STEWARD_SEED_API_KEY");
  if (baseUrl && model) {
    return { baseUrl, model, via: "STEWARD_SEED_BASE_URL", ...(apiKey ? { apiKey } : {}) };
  }
  const nvidiaKey = value("NVIDIA_API_KEY");
  if (nvidiaKey) {
    return {
      baseUrl: NVIDIA_BASE_URL,
      model: model ?? DEFAULT_NVIDIA_SEED_MODEL,
      apiKey: nvidiaKey,
      via: "NVIDIA_API_KEY",
    };
  }
  return undefined;
}

/** NVIDIA's reasoning models think out loud unless told not to; other endpoints get a plain body. */
export function createSeedModel(
  cfg: SeedModelConfig,
  opts: { temperature?: number; fetch?: typeof fetch } = {},
): TextModel {
  const nvidia = /nvidia\.com/i.test(cfg.baseUrl);
  return createOpenAICompatibleModel({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature,
    fetch: opts.fetch,
    ...(nvidia ? { extraBody: { chat_template_kwargs: { enable_thinking: false } } } : {}),
  });
}
