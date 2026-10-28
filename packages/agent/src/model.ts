import { createOpenAI } from "@ai-sdk/openai";
import type { AgentProfile, ModelConfig, TenantPackage, TextModel } from "@steward/shared";
import { generateText, type LanguageModel } from "ai";
import { startScriptedModel } from "./scripted.ts";
import { MODEL_PROVIDERS } from "./tenant.ts";

/**
 * Steward talks to every model through the OpenAI Chat Completions API: OpenRouter, NVIDIA, OpenAI,
 * Anthropic, Gemini and xAI (through their OpenAI-compatible endpoints), Ollama, or anything else
 * that speaks it. Without a key it says so and runs the scripted demo model, which needs nothing.
 */

type Provider = ModelConfig["provider"];

interface ProviderInfo {
  /** Shown in labels. */
  name: string;
  baseUrl?: string;
  /** The env var that holds the key. Absent when no key is needed. */
  keyEnv?: string;
  /** Used when the provider is chosen by env and no model is named. */
  defaultModel: string;
  headers?: Record<string, string>;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-sonnet-5.5",
    headers: { "X-Title": "Steward" },
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-5.6-terra",
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5-5",
  },
  nvidia: {
    name: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
  },
  gemini: {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-3.5-flash",
  },
  xai: {
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    keyEnv: "XAI_API_KEY",
    defaultModel: "grok-4.7",
  },
  ollama: { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "llama3.2" },
  "openai-compatible": { name: "OpenAI-compatible", defaultModel: "default" },
  scripted: { name: "Scripted demo model", defaultModel: "steward-scripted" },
};

/** The env var an `openai-compatible` endpoint's key is read from, unless model.yaml names another. */
export const COMPATIBLE_KEY_ENV = "STEWARD_MODEL_API_KEY";

export const SCRIPTED_MODEL_ID = "steward-scripted";

/** A model config plus, when Steward fell back to the scripted model, why. */
export interface ResolvedModelConfig extends ModelConfig {
  /** Set when the chosen provider could not be used: "no key for openrouter". */
  fallbackReason?: string;
}

/** Blank env values count as unset: `KEY=` in a .env file must not become an empty key or base URL. */
function envValue(env: NodeJS.ProcessEnv, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function isProvider(value: string): value is Provider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

function scripted(reason?: string): ResolvedModelConfig {
  return { provider: "scripted", model: SCRIPTED_MODEL_ID, ...(reason ? { fallbackReason: reason } : {}) };
}

/** Providers whose model ids start with a vendor name: `anthropic/claude…` on OpenRouter, `nvidia/nemotron…` on NVIDIA. */
const VENDOR_PREFIXED: ReadonlySet<Provider> = new Set(["openrouter", "nvidia"]);

/** Vendor names those providers list models under that are also Steward provider ids. */
const VENDOR_NAMES: Partial<Record<Provider, readonly string[]>> = {
  openrouter: ["anthropic", "openai", "nvidia"],
  nvidia: ["openai"],
};

/** What an agent profile's `model` names: a model id on the tenant's provider, or `provider/model`. */
export interface ProfileModel {
  /** Set when the profile named a provider of its own. */
  provider?: Provider;
  model: string;
}

/**
 * Reads an agent profile's `model`. `xai/grok-4.7` names a provider and a model; `anthropic/claude-sonnet-5.5`
 * on an OpenRouter tenant is an OpenRouter id, because OpenRouter and NVIDIA list models under
 * vendor names and three of those (`anthropic`, `openai`, `nvidia`) are also Steward providers. The
 * tenant's own provider named again is a prefix (`openrouter/anthropic/x` → `anthropic/x`), except
 * where it is the vendor name inside one of that provider's own ids (`nvidia/nemotron…`,
 * `openrouter/auto`).
 */
export function profileModel(model: string, tenantProvider: Provider): ProfileModel {
  const slash = model.indexOf("/");
  if (slash <= 0) return { model };
  const head = model.slice(0, slash);
  const rest = model.slice(slash + 1);
  if (!rest || !isProvider(head) || head === "scripted") return { model };
  if (head === tenantProvider) {
    return VENDOR_PREFIXED.has(head) && !rest.includes("/") ? { model } : { provider: head, model: rest };
  }
  if (VENDOR_NAMES[tenantProvider]?.includes(head)) return { model };
  return { provider: head, model: rest };
}

/** The provider's endpoint, key variable and the address or key name model.yaml gives for it. */
function endpointFor(
  provider: Exclude<Provider, "scripted">,
  model: string,
  tenant: TenantPackage,
  env: NodeJS.ProcessEnv,
  opts: { envAddress: boolean },
): ResolvedModelConfig {
  const sameAsTenant = provider === tenant.model.provider;
  const info = PROVIDERS[provider];
  const baseUrl =
    (opts.envAddress ? envValue(env, "STEWARD_MODEL_BASE_URL") : undefined) ??
    (sameAsTenant ? tenant.model.baseUrl : undefined) ??
    info.baseUrl;
  const apiKeyEnv =
    (sameAsTenant ? tenant.model.apiKeyEnv : undefined) ??
    info.keyEnv ??
    (provider === "openai-compatible" ? COMPATIBLE_KEY_ENV : undefined);
  if (!baseUrl) return scripted(`no base URL for ${provider}`);
  if (info.keyEnv && !envValue(env, apiKeyEnv)) return scripted(`no key for ${provider}`);
  return { provider, model, baseUrl, ...(apiKeyEnv ? { apiKeyEnv } : {}) };
}

/**
 * The model to use. `STEWARD_MODEL_PROVIDER`, `STEWARD_MODEL` and `STEWARD_MODEL_BASE_URL` override
 * the tenant's model.yaml (a choice saved in Settings arrives the same way). An agent profile with a
 * `model` of its own keeps it whatever Settings says: a bare id runs on the tenant's provider, and
 * `provider/model` (see `profileModel`) on that provider, with that provider's key. When the provider
 * needs a key and has none, this is the scripted model, with the reason kept for the label.
 */
export function resolveModelConfig(
  tenant: TenantPackage,
  env: NodeJS.ProcessEnv,
  profile?: Pick<AgentProfile, "model">,
): ResolvedModelConfig {
  const fromEnv = envValue(env, "STEWARD_MODEL_PROVIDER")?.toLowerCase();
  if (fromEnv !== undefined && !isProvider(fromEnv)) {
    throw new Error(
      `STEWARD_MODEL_PROVIDER is "${fromEnv}", which Steward does not know. Use one of: ${MODEL_PROVIDERS.join(", ")}.`,
    );
  }
  const running: Provider = fromEnv ?? tenant.model.provider;

  const own = profile?.model ? profileModel(profile.model, tenant.model.provider) : undefined;
  if (own) {
    const provider = own.provider ?? tenant.model.provider;
    if (provider === "scripted") return scripted();
    // The address the person gave belongs to the provider they chose; it applies to a profile only on that provider.
    return endpointFor(provider, own.model, tenant, env, { envAddress: provider === running });
  }

  if (running === "scripted") return scripted();
  const model =
    envValue(env, "STEWARD_MODEL") ??
    (running === tenant.model.provider ? tenant.model.model : PROVIDERS[running].defaultModel);
  return endpointFor(running, model, tenant, env, { envAddress: true });
}

export interface CreatedModel {
  model: LanguageModel;
  /** Shown on screen: "OpenRouter · anthropic/claude-sonnet-5.5", "Scripted demo model". */
  label: string;
  scripted: boolean;
  close(): Promise<void>;
}

function scriptedLabel(reason?: string): string {
  return reason ? `Scripted demo model (${reason})` : "Scripted demo model";
}

/**
 * Builds the AI SDK model. Always `.chat()`: OpenRouter, NVIDIA, Ollama and aimock speak Chat
 * Completions, and `provider(id)` would target the Responses API instead. The scripted model starts
 * an in-process aimock server on a free loopback port; `close()` stops it.
 */
export async function createModel(cfg: ModelConfig, env: NodeJS.ProcessEnv): Promise<CreatedModel> {
  const reason = (cfg as ResolvedModelConfig).fallbackReason;
  if (cfg.provider === "scripted") return startScripted(scriptedLabel(reason));

  const info = PROVIDERS[cfg.provider];
  if (!info) return startScripted(scriptedLabel(`unknown provider ${cfg.provider}`));
  const baseURL = cfg.baseUrl?.trim() || info.baseUrl;
  if (!baseURL) return startScripted(scriptedLabel(`no base URL for ${cfg.provider}`));
  const keyEnv =
    cfg.apiKeyEnv ?? info.keyEnv ?? (cfg.provider === "openai-compatible" ? COMPATIBLE_KEY_ENV : undefined);
  const apiKey = envValue(env, keyEnv);
  if (info.keyEnv && !apiKey) return startScripted(scriptedLabel(`no key for ${cfg.provider}`));

  const extraBody = cfg.provider === "nvidia" ? nvidiaExtras(env) : undefined;
  const provider = createOpenAI({
    name: cfg.provider,
    baseURL,
    // Keyless local servers still need a non-empty bearer for the client to send the request.
    apiKey: apiKey ?? "not-needed",
    ...(info.headers ? { headers: info.headers } : {}),
    ...(extraBody ? { fetch: withExtraBody(extraBody) } : {}),
  });
  return {
    model: provider.chat(cfg.model),
    label: `${info.name} · ${cfg.model}`,
    scripted: false,
    close: async () => {},
  };
}

/**
 * NVIDIA's reasoning models (Nemotron) think before every reply unless told not to, which makes each
 * tool call take about 20 s instead of 1–2 s. Thinking stays off unless STEWARD_NVIDIA_THINKING=1.
 */
function nvidiaExtras(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const thinking = env.STEWARD_NVIDIA_THINKING === "1";
  return { chat_template_kwargs: { enable_thinking: thinking } };
}

/** A fetch that adds fields to every JSON request body. Used for provider switches the AI SDK has no option for. */
export function withExtraBody(extra: Record<string, unknown>, base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        return base(input, { ...init, body: JSON.stringify({ ...extra, ...body }) });
      } catch {
        // Not JSON: send as it is.
      }
    }
    return base(input, init);
  }) as typeof fetch;
}

async function startScripted(label: string): Promise<CreatedModel> {
  const server = await startScriptedModel();
  const provider = createOpenAI({ name: "scripted", baseURL: `${server.url}/v1`, apiKey: "scripted" });
  return { model: provider.chat(SCRIPTED_MODEL_ID), label, scripted: true, close: server.close };
}

/** A short, structured completion from the configured model, for triage and the brief. */
export function createTextModel(model: LanguageModel, label: string): TextModel {
  return {
    label,
    async complete({ system, prompt, maxTokens, signal }) {
      const result = await generateText({
        model,
        system,
        prompt,
        ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
        ...(signal ? { abortSignal: signal } : {}),
        maxRetries: 1,
      });
      return result.text;
    },
  };
}
