import type { TextModel } from "@steward/shared";

export interface OpenAICompatibleOptions {
  /** The API root, such as `https://openrouter.ai/api/v1`. `/chat/completions` is added. */
  baseUrl: string;
  /** Sent as a bearer token. Optional for local servers such as Ollama. */
  apiKey?: string;
  model: string;
  /** Per request. Default 60 seconds. */
  timeoutMs?: number;
  /** Extra headers, such as OpenRouter's `X-Title`. */
  headers?: Record<string, string>;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * A minimal `TextModel` over any OpenAI-compatible Chat Completions endpoint, with nothing but
 * `fetch`. Used only by the triage eval, so it can run without the agent package. Temperature is 0
 * so a re-run measures the change, not the dice.
 *
 * Errors name the status and never echo the response body: provider errors can repeat parts of
 * the key, and eval output gets committed.
 */
export function createOpenAICompatibleModel(opts: OpenAICompatibleOptions): TextModel {
  const url = `${opts.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetch ?? fetch;

  return {
    label: opts.model,
    async complete({ system, prompt, maxTokens, signal }) {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000);
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
          max_tokens: maxTokens ?? 300,
          temperature: 0,
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

export interface EvalModelConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Where the settings came from, for the results file. Never the key. */
  via: string;
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_EVAL_MODEL = "anthropic/claude-haiku-5.5";

/**
 * The model the eval should use, from the environment, or undefined for rules only.
 * `STEWARD_EVAL_BASE_URL` + `STEWARD_EVAL_MODEL` (+ `STEWARD_EVAL_API_KEY`) win; otherwise
 * `OPENROUTER_API_KEY` uses OpenRouter with `STEWARD_EVAL_MODEL` or Claude Haiku 5.5. Blank values
 * count as unset.
 */
export function evalModelConfig(env: Record<string, string | undefined>): EvalModelConfig | undefined {
  const value = (name: string) => env[name]?.trim() || undefined;
  const baseUrl = value("STEWARD_EVAL_BASE_URL");
  const model = value("STEWARD_EVAL_MODEL");
  const apiKey = value("STEWARD_EVAL_API_KEY");
  if (baseUrl && model) {
    return { baseUrl, model, via: "STEWARD_EVAL_BASE_URL", ...(apiKey ? { apiKey } : {}) };
  }
  const openRouterKey = value("OPENROUTER_API_KEY");
  if (openRouterKey) {
    return {
      baseUrl: OPENROUTER_BASE_URL,
      model: model ?? DEFAULT_OPENROUTER_EVAL_MODEL,
      apiKey: openRouterKey,
      via: "OPENROUTER_API_KEY",
    };
  }
  return undefined;
}
