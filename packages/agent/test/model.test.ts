import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenAI } from "@ai-sdk/openai";
import type { TenantPackage } from "@steward/shared";
import { jsonSchema, type ModelMessage, streamText, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createModel,
  createTextModel,
  profileModel,
  resolveModelConfig,
  SCRIPTED_MODEL_ID,
  SKIP_THOUGHT_SIGNATURE,
  withThoughtSignatures,
} from "../src/model.ts";
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
      [
        "xai",
        { XAI_API_KEY: "k" },
        { baseUrl: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", model: "grok-4.7" },
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

  it("lets an agent profile keep its own model whatever the environment or Settings names", () => {
    expect(
      resolveModelConfig(OPENROUTER, { OPENROUTER_API_KEY: "k" }, { model: "openai/gpt-5-mini" }).model,
    ).toBe("openai/gpt-5-mini");
    // Settings (which arrives as STEWARD_MODEL) changes the agents without a model, not this one.
    expect(
      resolveModelConfig(
        OPENROUTER,
        { OPENROUTER_API_KEY: "k", STEWARD_MODEL: "x/env" },
        { model: "openai/gpt-5-mini" },
      ).model,
    ).toBe("openai/gpt-5-mini");
    expect(resolveModelConfig(OPENROUTER, { OPENROUTER_API_KEY: "k", STEWARD_MODEL: "x/env" }).model).toBe(
      "x/env",
    );
  });

  it("keeps a bare profile model on the tenant's provider, even when Settings chose another", () => {
    const env = { STEWARD_MODEL_PROVIDER: "nvidia", NVIDIA_API_KEY: "n", OPENROUTER_API_KEY: "k" };
    expect(resolveModelConfig(OPENROUTER, env, { model: "anthropic/claude-sonnet-5.5" })).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
    // Without the tenant provider's key, that agent has no model; the scripted fallback says why.
    expect(
      resolveModelConfig(
        OPENROUTER,
        { STEWARD_MODEL_PROVIDER: "nvidia", NVIDIA_API_KEY: "n" },
        { model: "x/y" },
      ),
    ).toEqual({ provider: "scripted", model: SCRIPTED_MODEL_ID, fallbackReason: "no key for openrouter" });
  });

  it("lets a profile name a provider of its own with provider/model, keyed by that provider", () => {
    expect(
      resolveModelConfig(
        OPENROUTER,
        { OPENROUTER_API_KEY: "k", XAI_API_KEY: "x" },
        { model: "xai/grok-4.7" },
      ),
    ).toEqual({
      provider: "xai",
      model: "grok-4.7",
      baseUrl: "https://api.x.ai/v1",
      apiKeyEnv: "XAI_API_KEY",
    });
    expect(resolveModelConfig(OPENROUTER, { OPENROUTER_API_KEY: "k" }, { model: "xai/grok-4.7" })).toEqual({
      provider: "scripted",
      model: SCRIPTED_MODEL_ID,
      fallbackReason: "no key for xai",
    });
    // The address someone gave belongs to the provider they chose, never to another provider's profile.
    expect(
      resolveModelConfig(
        OPENROUTER,
        { OPENROUTER_API_KEY: "k", STEWARD_MODEL_BASE_URL: "https://proxy.example.com/v1", XAI_API_KEY: "x" },
        { model: "xai/grok-4.7" },
      ).baseUrl,
    ).toBe("https://api.x.ai/v1");
    // `scripted/` is never a prefix: a profile cannot opt into the demo model by name.
    expect(profileModel("scripted/anything", "openrouter")).toEqual({ model: "scripted/anything" });
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

describe("profileModel", () => {
  it("reads provider/model, and leaves a bare id on the tenant's provider", () => {
    expect(profileModel("xai/grok-4.7", "openrouter")).toEqual({ provider: "xai", model: "grok-4.7" });
    expect(profileModel("gemini/gemini-3.5-flash", "openrouter")).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash",
    });
    expect(profileModel("ollama/llama3.2:latest", "openrouter")).toEqual({
      provider: "ollama",
      model: "llama3.2:latest",
    });
    expect(profileModel("gpt-5.6-terra", "openai")).toEqual({ model: "gpt-5.6-terra" });
    expect(profileModel("meta-llama/llama-4", "openrouter")).toEqual({ model: "meta-llama/llama-4" });
    expect(profileModel("/x", "openrouter")).toEqual({ model: "/x" });
    expect(profileModel("xai/", "openrouter")).toEqual({ model: "xai/" });
  });

  it("keeps OpenRouter's and NVIDIA's vendor-named ids on the tenant's provider", () => {
    // OpenRouter lists models as vendor/model; three vendors are also Steward providers.
    expect(profileModel("anthropic/claude-sonnet-5.5", "openrouter")).toEqual({
      model: "anthropic/claude-sonnet-5.5",
    });
    expect(profileModel("openai/gpt-5-mini", "openrouter")).toEqual({ model: "openai/gpt-5-mini" });
    expect(profileModel("nvidia/nemotron-3-ultra-550b-a55b", "openrouter")).toEqual({
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    });
    expect(profileModel("openrouter/auto", "openrouter")).toEqual({ model: "openrouter/auto" });
    expect(profileModel("nvidia/nemotron-3-ultra-550b-a55b", "nvidia")).toEqual({
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    });
    expect(profileModel("openai/gpt-oss-120b", "nvidia")).toEqual({ model: "openai/gpt-oss-120b" });
    // On any other tenant those names are providers.
    expect(profileModel("anthropic/claude-sonnet-5-5", "gemini")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(profileModel("openai/gpt-5.6-terra", "anthropic")).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    // The tenant's own provider named again is a prefix.
    expect(profileModel("openrouter/anthropic/claude-sonnet-5.5", "openrouter")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
    });
    expect(profileModel("nvidia/nvidia/nemotron-3-ultra-550b-a55b", "nvidia")).toEqual({
      provider: "nvidia",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    });
    expect(profileModel("anthropic/claude-sonnet-5-5", "anthropic")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
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

  it("builds an xAI model against api.x.ai, named so the record knows the provider", async () => {
    const created = await createModel(
      { provider: "xai", model: "grok-4.7", baseUrl: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY" },
      { XAI_API_KEY: "k" },
    );
    expect(created.label).toBe("xAI · grok-4.7");
    const model = created.model as { provider: string; modelId: string };
    expect(model.provider).toBe("xai.chat");
    expect(model.modelId).toBe("grok-4.7");
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

describe("createTextModel", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });

  /** A provider that takes the request and never answers. */
  async function silentProvider() {
    server = createServer(() => {});
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const model = createOpenAI({ name: "silent", baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "k" }).chat(
      "m",
    );
    return { model };
  }

  it("gives up on a model that never answers, with a TimeoutError the callers know", async () => {
    const { model } = await silentProvider();
    const text = createTextModel(model, "Silent", { timeoutMs: 300 });
    const started = Date.now();
    const error = await text.complete({ system: "Sort this email.", prompt: "Hi" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    // Not refused, which would fail at once: it waited, then gave up at the limit.
    expect(error).toMatchObject({
      name: "TimeoutError",
      message: "The model did not answer within 1 second.",
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("still stops when the caller stops it, as the caller's own stop", async () => {
    const { model } = await silentProvider();
    const text = createTextModel(model, "Silent", { timeoutMs: 30_000 });
    const stop = new AbortController();
    const pending = text.complete({ system: "s", prompt: "p", signal: stop.signal }).catch((e: unknown) => e);
    setTimeout(() => stop.abort(), 100);
    const error = await pending;
    expect((error as Error).name).not.toBe("TimeoutError");
    expect(stop.signal.aborted).toBe(true);
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

describe("withThoughtSignatures", () => {
  const SIGNATURE = { google: { thought_signature: "CvcQAdHN2OekY10ClPFkYA==" } };

  /** Gemini's streamed reply: one tool call with its signature, split mid-line across chunks. */
  function geminiStream(): Response {
    const chunks = [
      { choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_g1",
                  type: "function",
                  function: { name: "file_list", arguments: "{}" },
                  extra_content: SIGNATURE,
                },
              ],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const text = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(text);
    const cut = Math.floor(bytes.length / 2);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }

  it("keeps each tool call's signature as the reply streams past, and sends it back after", async () => {
    const sent: Record<string, unknown>[] = [];
    const base = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sent.length === 1
        ? geminiStream()
        : new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    });
    const model = createOpenAI({
      name: "gemini",
      baseURL: "https://gemini.test/v1beta/openai",
      apiKey: "k",
      fetch: withThoughtSignatures(base as unknown as typeof fetch),
    }).chat("gemini-3.5-flash");
    const tools = { file_list: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }) }) };

    const first = streamText({ model, prompt: "list my files", tools });
    const calls = await first.toolCalls;
    expect(calls.map((c) => c.toolCallId)).toEqual(["call_g1"]);

    const messages: ModelMessage[] = [
      { role: "user", content: "list my files" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_g1", toolName: "file_list", input: {} }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_g1",
            toolName: "file_list",
            output: { type: "text", value: "[]" },
          },
        ],
      },
    ];
    await streamText({ model, messages, tools }).consumeStream();
    const assistant = ((sent[1]?.messages ?? []) as Record<string, unknown>[]).find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.tool_calls).toEqual([
      {
        id: "call_g1",
        type: "function",
        function: { name: "file_list", arguments: "{}" },
        extra_content: SIGNATURE,
      },
    ]);
  });

  it("gives a step it never saw the placeholder Google documents, on its first call only", async () => {
    let body = "";
    const base = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const f = withThoughtSignatures(base);
    const call = (id: string) => ({ id, type: "function", function: { name: "file_list", arguments: "{}" } });
    await f("https://gemini.test", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", tool_calls: [call("old_1"), call("old_2")] },
          { role: "assistant", content: "Done." },
        ],
      }),
    });
    const [, assistant, words] = (JSON.parse(body) as { messages: Record<string, unknown>[] }).messages;
    expect(assistant?.tool_calls).toEqual([
      { ...call("old_1"), extra_content: { google: { thought_signature: SKIP_THOUGHT_SIGNATURE } } },
      call("old_2"),
    ]);
    expect(words).toEqual({ role: "assistant", content: "Done." });

    await f("https://gemini.test", { method: "POST", body: "not json" });
    expect(body).toBe("not json");
  });

  it("reads signatures from a whole reply too, and keeps no more than 500", async () => {
    let n = 0;
    let body = "";
    const base = (async (_url: unknown, init?: RequestInit) => {
      body = String(init?.body);
      const id = `call_${n++}`;
      return Response.json({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id,
                  type: "function",
                  function: { name: "f", arguments: "{}" },
                  extra_content: { google: { thought_signature: id } },
                },
              ],
            },
          },
        ],
      });
    }) as typeof fetch;
    const f = withThoughtSignatures(base);
    for (let i = 0; i < 501; i++) await f("https://gemini.test", { method: "POST", body: "{}" });
    const ask = (id: string) =>
      f("https://gemini.test", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              role: "assistant",
              tool_calls: [{ id, type: "function", function: { name: "f", arguments: "{}" } }],
            },
          ],
        }),
      }).then(
        () =>
          (JSON.parse(body) as { messages: { tool_calls: { extra_content: unknown }[] }[] }).messages[0]
            ?.tool_calls[0]?.extra_content,
      );
    expect(await ask("call_500")).toEqual({ google: { thought_signature: "call_500" } });
    expect(await ask("call_0")).toEqual({ google: { thought_signature: SKIP_THOUGHT_SIGNATURE } });
  });

  it("is used for Gemini only", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      seen.push(String(init?.body));
      return Response.json({
        choices: [{ index: 0, message: { role: "assistant", content: "Hi." }, finish_reason: "stop" }],
      });
    });
    try {
      const messages: ModelMessage[] = [
        { role: "user", content: "list" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "c1", toolName: "file_list", input: {} }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              toolName: "file_list",
              output: { type: "text", value: "[]" },
            },
          ],
        },
      ];
      for (const provider of ["gemini", "openai"] as const) {
        const created = await createModel(
          { provider, model: "m" },
          { GEMINI_API_KEY: "k", OPENAI_API_KEY: "k" },
        );
        const text = createTextModel(created.model, created.label);
        await text.complete({ system: "s", prompt: "p" });
        const { generateText } = await import("ai");
        await generateText({ model: created.model, messages });
      }
    } finally {
      vi.unstubAllGlobals();
    }
    const withTools = seen.filter((b) => b.includes("tool_calls"));
    expect(withTools).toHaveLength(2);
    expect(withTools[0]).toContain(SKIP_THOUGHT_SIGNATURE);
    expect(withTools[1]).not.toContain("extra_content");
  });
});
