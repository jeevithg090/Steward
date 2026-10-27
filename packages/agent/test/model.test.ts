import type { TenantPackage } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { createModel, createTextModel, resolveModelConfig, SCRIPTED_MODEL_ID } from "../src/model.ts";
import { TENANT } from "./fakes.ts";

function tenantWith(model: TenantPackage["model"]): TenantPackage {
  return { ...TENANT, model };
}

const OPENROUTER = tenantWith({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5" });

describe("resolveModelConfig", () => {
  it("uses model.yaml when the key is there", () => {
    expect(resolveModelConfig(OPENROUTER, { OPENROUTER_API_KEY: "k" })).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
  });

  it("falls back to the scripted model, and says why, when the key is missing or blank", () => {
    for (const env of [{}, { OPENROUTER_API_KEY: "" }, { OPENROUTER_API_KEY: "   " }]) {
      expect(resolveModelConfig(OPENROUTER, env)).toEqual({
        provider: "scripted",
        model: SCRIPTED_MODEL_ID,
        fallbackReason: "no key for openrouter",
      });
    }
  });

  it("lets the environment choose the provider, model and base URL", () => {
    const cfg = resolveModelConfig(OPENROUTER, {
      STEWARD_MODEL_PROVIDER: "nvidia",
      NVIDIA_API_KEY: "n",
    });
    expect(cfg).toEqual({
      provider: "nvidia",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKeyEnv: "NVIDIA_API_KEY",
    });
    expect(
      resolveModelConfig(OPENROUTER, {
        STEWARD_MODEL: "openai/gpt-5-mini",
        STEWARD_MODEL_BASE_URL: "https://proxy.example.com/v1",
        OPENROUTER_API_KEY: "k",
      }),
    ).toMatchObject({
      provider: "openrouter",
      model: "openai/gpt-5-mini",
      baseUrl: "https://proxy.example.com/v1",
    });
  });

  it("ignores blank overrides", () => {
    expect(
      resolveModelConfig(OPENROUTER, {
        STEWARD_MODEL_PROVIDER: "",
        STEWARD_MODEL: " ",
        STEWARD_MODEL_BASE_URL: "",
        OPENROUTER_API_KEY: "k",
      }),
    ).toMatchObject({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("knows every provider's endpoint and key", () => {
    const cases: [string, Record<string, string>, Record<string, unknown>][] = [
      [
        "openai",
        { OPENAI_API_KEY: "k" },
        { baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
      ],
      [
        "anthropic",
        { ANTHROPIC_API_KEY: "k" },
        { baseUrl: "https://api.anthropic.com/v1", apiKeyEnv: "ANTHROPIC_API_KEY" },
      ],
      [
        "gemini",
        { GEMINI_API_KEY: "k" },
        { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY" },
      ],
      ["ollama", {}, { baseUrl: "http://127.0.0.1:11434/v1" }],
      [
        "openai-compatible",
        { STEWARD_MODEL_BASE_URL: "http://10.0.0.5:8000/v1" },
        { baseUrl: "http://10.0.0.5:8000/v1" },
      ],
    ];
    for (const [provider, env, expected] of cases) {
      expect(resolveModelConfig(OPENROUTER, { STEWARD_MODEL_PROVIDER: provider, ...env })).toMatchObject({
        provider,
        ...expected,
      });
    }
  });

  it("needs a base URL for an OpenAI-compatible server", () => {
    expect(resolveModelConfig(OPENROUTER, { STEWARD_MODEL_PROVIDER: "openai-compatible" })).toEqual({
      provider: "scripted",
      model: SCRIPTED_MODEL_ID,
      fallbackReason: "no base URL for openai-compatible",
    });
  });

  it("uses the key variable model.yaml names", () => {
    const tenant = tenantWith({ provider: "openrouter", model: "x/y", apiKeyEnv: "ACME_KEY" });
    expect(resolveModelConfig(tenant, { ACME_KEY: "k" })).toMatchObject({
      provider: "openrouter",
      apiKeyEnv: "ACME_KEY",
    });
    expect(resolveModelConfig(tenant, { OPENROUTER_API_KEY: "k" }).provider).toBe("scripted");
  });

  it("lets an agent profile name its own model, unless the environment names one", () => {
    expect(
      resolveModelConfig(OPENROUTER, { OPENROUTER_API_KEY: "k" }, { model: "openai/gpt-5-mini" }).model,
    ).toBe("openai/gpt-5-mini");
    expect(
      resolveModelConfig(
        OPENROUTER,
        { OPENROUTER_API_KEY: "k", STEWARD_MODEL: "x/env" },
        { model: "openai/gpt-5-mini" },
      ).model,
    ).toBe("x/env");
  });

  it("refuses a provider it does not know, by name", () => {
    expect(() => resolveModelConfig(OPENROUTER, { STEWARD_MODEL_PROVIDER: "skynet" })).toThrow(
      /STEWARD_MODEL_PROVIDER is "skynet"/,
    );
  });

  it("returns scripted when scripted is asked for", () => {
    expect(resolveModelConfig(OPENROUTER, { STEWARD_MODEL_PROVIDER: "scripted" })).toEqual({
      provider: "scripted",
      model: SCRIPTED_MODEL_ID,
    });
  });
});

describe("createModel", () => {
  it("builds a Chat Completions model for a real provider without calling it", async () => {
    const created = await createModel(
      {
        provider: "openrouter",
        model: "anthropic/claude-sonnet-5.5",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
      { OPENROUTER_API_KEY: "k" },
    );
    expect(created.label).toBe("OpenRouter · anthropic/claude-sonnet-5.5");
    expect(created.scripted).toBe(false);
    const model = created.model as { provider: string; modelId: string };
    expect(model.modelId).toBe("anthropic/claude-sonnet-5.5");
    expect(model.provider).toBe("openrouter.chat");
    await created.close();
  });

  it("labels the fallback with its reason", async () => {
    const created = await createModel(resolveModelConfig(OPENROUTER, {}), {});
    try {
      expect(created.scripted).toBe(true);
      expect(created.label).toBe("Scripted demo model (no key for openrouter)");
    } finally {
      await created.close();
    }
  });

  it("falls back when the key disappeared since the config was resolved", async () => {
    const created = await createModel({ provider: "gemini", model: "gemini-2.5-flash" }, {});
    try {
      expect(created.label).toBe("Scripted demo model (no key for gemini)");
    } finally {
      await created.close();
    }
  });

  it("answers a greeting with the scripted model, on loopback only, and closes cleanly", async () => {
    const created = await createModel({ provider: "scripted", model: SCRIPTED_MODEL_ID }, {});
    expect(created.label).toBe("Scripted demo model");
    const text = createTextModel(created.model, created.label);
    expect(text.label).toBe("Scripted demo model");
    // No tools offered: the scripted model gives no made-up verdict, so callers fall back to rules.
    expect(await text.complete({ system: "Sort this email.", prompt: "Hi" })).toMatch(/Scripted demo model/);
    await created.close();
    await created.close();
  });
});

describe("withExtraBody", () => {
  it("adds provider switches to JSON bodies and leaves the rest alone", async () => {
    const { withExtraBody } = await import("../src/model.ts");
    const seen: unknown[] = [];
    const base = (async (_url: unknown, init?: RequestInit) => {
      seen.push(init?.body);
      return new Response("{}");
    }) as typeof fetch;
    const f = withExtraBody({ chat_template_kwargs: { enable_thinking: false } }, base);
    await f("https://x.test", { method: "POST", body: JSON.stringify({ model: "m" }) });
    await f("https://x.test", { method: "POST", body: "not json" });
    expect(JSON.parse(seen[0] as string)).toEqual({
      model: "m",
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(seen[1]).toBe("not json");
  });
});
