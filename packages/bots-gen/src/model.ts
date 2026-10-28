import { createHash } from "node:crypto";
import type { TextModel } from "@steward/shared";

/** A short fingerprint of a key, so paces can be told apart without the key in a map. */
export function hashKey(key: string | undefined): string {
  return key ? createHash("sha256").update(key).digest("hex").slice(0, 12) : "none";
}

/**
 * The model the seed CLI writes bots with: any OpenAI-compatible Chat Completions endpoint, with
 * nothing but `fetch`. The pattern is `packages/proactive/src/eval/model.ts`; this copy adds a
 * temperature and an extra request body, which NVIDIA's reasoning models need to answer without
 * thinking out loud.
 *
 * Errors name the status and never echo the response body: provider errors can repeat parts of
 * the key, and seed output gets committed.
 */

/**
 * Requests per minute, shared by everything that calls one endpoint with one key: the writer, the
 * judge and the embedder take turns, so a long seed run stays under the provider's limit instead
 * of meeting it as a wall of 429s.
 */
export interface Pace {
  wait(): Promise<void>;
}

const paces = new Map<string, Pace>();

export function createPace(rpm: number, now: () => number = Date.now): Pace {
  const gap = rpm > 0 ? 60_000 / rpm : 0;
  let next = 0;
  return {
    async wait() {
      if (gap === 0) return;
      const at = Math.max(now(), next);
      next = at + gap;
      const delay = at - now();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    },
  };
}

/** One pace per endpoint and key in this process. `rpm` 0 means no pacing. */
export function sharedPace(key: string, rpm: number): Pace {
  const id = `${key}|${rpm}`;
  let pace = paces.get(id);
  if (!pace) {
    pace = createPace(rpm);
    paces.set(id, pace);
  }
  return pace;
}

export interface RetryOptions {
  /** Attempts after the first. Default 8: a busy provider can refuse for a few minutes. */
  retries?: number;
  /** The first wait when the provider gives no Retry-After. Default 3 seconds, doubling, at most 90. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * `fetch` again on a rate limit or a server error, waiting as the provider asks (`Retry-After`) or
 * doubling from `baseDelayMs`. Any other answer is returned as it is.
 */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: RetryOptions & { pace?: Pace } = {},
): Promise<Response> {
  const retries = opts.retries ?? 8;
  const base = opts.baseDelayMs ?? 3_000;
  const max = opts.maxDelayMs ?? 90_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    await opts.pace?.wait();
    const response = await doFetch();
    if (!RETRY_STATUSES.has(response.status) || attempt >= retries) return response;
    const after = Number.parseFloat(response.headers.get("retry-after") ?? "");
    const wait = Number.isFinite(after) && after >= 0 ? after * 1000 : base * 2 ** attempt;
    await response.body?.cancel().catch(() => {});
    await sleep(Math.min(max, wait) + Math.floor(Math.random() * 250));
  }
}

/** Requests per minute for an endpoint: `STEWARD_SEED_RPM`, or 35 for NVIDIA's hosted API (its limit is 40). */
export function rpmFor(baseUrl: string, env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.STEWARD_SEED_RPM ?? "", 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return /nvidia\.com/i.test(baseUrl) ? 35 : 0;
}

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
  pace?: Pace;
  retry?: RetryOptions;
}

export function createOpenAICompatibleModel(opts: OpenAICompatibleOptions): TextModel {
  const url = `${opts.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetch ?? fetch;

  return {
    label: opts.model,
    async complete({ system, prompt, maxTokens, signal }) {
      const response = await fetchWithRetry(
        () => {
          const timeout = AbortSignal.timeout(opts.timeoutMs ?? 180_000);
          return doFetch(url, {
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
        },
        { ...opts.retry, ...(opts.pace ? { pace: opts.pace } : {}) },
      );
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
  opts: { temperature?: number; fetch?: typeof fetch; pace?: Pace; retry?: RetryOptions } = {},
): TextModel {
  const nvidia = /nvidia\.com/i.test(cfg.baseUrl);
  return createOpenAICompatibleModel({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature,
    fetch: opts.fetch,
    pace: opts.pace ?? sharedPace(`${cfg.baseUrl}|${hashKey(cfg.apiKey)}`, rpmFor(cfg.baseUrl)),
    ...(opts.retry ? { retry: opts.retry } : {}),
    ...(nvidia ? { extraBody: { chat_template_kwargs: { enable_thinking: false } } } : {}),
  });
}
