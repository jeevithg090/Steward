import { createOpenAI } from "@ai-sdk/openai";
import type { AgentProfile, ModelConfig, TenantPackage, TextModel } from "@steward/shared";
import { generateText, type LanguageModel } from "ai";
import { startScriptedModel } from "./scripted.ts";
import { MODEL_PROVIDERS } from "./tenant.ts";

/**
 * Steward talks to every model through the OpenAI Chat Completions API: OpenRouter, NVIDIA, OpenAI,
 * Anthropic and Gemini (through their OpenAI-compatible endpoints), Ollama, or anything else that
 * speaks it. Without a key it says so and runs the scripted demo model, which needs nothing.
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
    defaultModel: "gpt-5-mini",
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
  },
  nvidia: {
    name: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    defaultModel: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  },
  gemini: {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
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

/**
 * The model to use. `STEWARD_MODEL_PROVIDER`, `STEWARD_MODEL` and `STEWARD_MODEL_BASE_URL` override
 * the tenant's model.yaml; an agent profile's own `model` overrides model.yaml's model name. When the
 * provider needs a key and has none, this is the scripted model, with the reason kept for the label.
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
  const provider: Provider = fromEnv ?? tenant.model.provider;
  if (provider === "scripted") return scripted();

  const sameAsTenant = provider === tenant.model.provider;
  const info = PROVIDERS[provider];
  const model =
    envValue(env, "STEWARD_MODEL") ??
    (sameAsTenant ? (profile?.model ?? tenant.model.model) : info.defaultModel);
  const baseUrl =
    envValue(env, "STEWARD_MODEL_BASE_URL") ??
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

  const provider = createOpenAI({
    name: cfg.provider,
    baseURL,
    // Keyless local servers still need a non-empty bearer for the client to send the request.
    apiKey: apiKey ?? "not-needed",
    ...(info.headers ? { headers: info.headers } : {}),
  });
  return {
    model: provider.chat(cfg.model),
    label: `${info.name} · ${cfg.model}`,
    scripted: false,
    close: async () => {},
  };
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
