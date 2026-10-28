import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { type AbstractAgent, EventType } from "@ag-ui/client";
import { StewardAgent } from "@steward/agent";
import { HarnessAgent } from "@steward/harnesses";
import type { AgentProfile, BotPack, HarnessProfile, TenantPackage } from "@steward/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentHost,
  modelEnv,
  modelIdFrom,
  NOTICE_NO_KEY,
  noticeNoKeyFor,
  type SharedAgentDeps,
  UnconfiguredAgent,
} from "../src/runtime/agents.ts";
import { summariseRun } from "../src/runtime/run-summary.ts";
import { collect, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

function profile(id: string, name: string, model?: string): AgentProfile {
  return {
    id,
    name,
    title: `${name} here`,
    instructions: "",
    skills: [],
    tools: ["*"],
    ...(model ? { model } : {}),
  };
}

const PROFILES = [
  profile("steward", "Steward"),
  profile("steward-claude", "Steward on Claude", "anthropic/claude-sonnet-5.5"),
  profile("steward-grok", "Steward on Grok", "xai/grok-4.7"),
];

const TENANT: TenantPackage = {
  id: "steward",
  brand: { name: "Steward", tagline: "", accent: "#0f6e66", voice: "" },
  agents: PROFILES,
  skills: [],
  rules: [],
  model: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5", apiKeyEnv: "OPENROUTER_API_KEY" },
  starters: [],
};

/** Nothing here is called while the agents are built; the tools read it per run. */
const SHARED = {
  governance: {},
  computers: {},
  mail: () => undefined,
  web: {},
  mcp: {},
  stores: {},
  settings: () => ({ plainLanguage: false, timezone: "Europe/London" }),
  actorId: "local",
} as unknown as SharedAgentDeps;

/** Only what `profileFromPack` and the host read. */
function botPack(model: string): BotPack {
  return {
    id: "rent-scout",
    name: "Rent Scout",
    pitch: "Finds flats",
    instructions: "",
    skills: [],
    needs: { tools: [], model },
  } as unknown as BotPack;
}

const hosts: AgentHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
});

async function host(env: NodeJS.ProcessEnv, tenant = TENANT): Promise<AgentHost> {
  const h = new AgentHost({ tenant, env, serverRunToken: "tok", shared: SHARED });
  hosts.push(h);
  await h.configure();
  return h;
}

describe("AgentHost with agents on models of their own", () => {
  it("builds each profile on its own provider and model, and lists what each runs on", async () => {
    const h = await host({ OPENROUTER_API_KEY: "k", XAI_API_KEY: "x" });
    expect(h.agent("steward")).toBeInstanceOf(StewardAgent);
    expect(h.agent("steward-claude")).toBeInstanceOf(StewardAgent);
    expect(h.agent("steward-grok")).toBeInstanceOf(StewardAgent);
    expect(
      h.agentInfos().map(({ id, provider, model, available, signIn, reason }) => ({
        id,
        provider,
        model,
        available,
        signIn,
        reason,
      })),
    ).toEqual([
      {
        id: "steward",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-5.5",
        available: true,
        signIn: "api-key",
        reason: undefined,
      },
      {
        id: "steward-claude",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-5.5",
        available: true,
        signIn: "api-key",
        reason: undefined,
      },
      {
        id: "steward-grok",
        provider: "xai",
        model: "grok-4.7",
        available: true,
        signIn: "api-key",
        reason: undefined,
      },
    ]);
    expect(h.agentInfos()[2]).toMatchObject({
      name: "Steward on Grok",
      title: "Steward on Grok here",
      source: "tenant",
    });
    expect(h.info).toMatchObject({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      scripted: false,
    });
  });

  it("makes only the agent whose provider has no key a notice, and says which key", async () => {
    const h = await host({ OPENROUTER_API_KEY: "k" });
    expect(h.agent("steward")).toBeInstanceOf(StewardAgent);
    expect(h.agent("steward-claude")).toBeInstanceOf(StewardAgent);
    const grok = h.agent("steward-grok");
    expect(grok).toBeInstanceOf(UnconfiguredAgent);
    expect(h.agentInfos()[2]).toMatchObject({
      id: "steward-grok",
      provider: "xai",
      model: "grok-4.7",
      available: false,
      signIn: "api-key",
      reason: "No xAI key is set. Add one in .env, then restart Steward.",
    });

    const { runner } = runnerOnMemoryDb();
    const events = await collect(startRun(runner, grok!, runInput("t1", "r1", "hello")));
    expect(summariseRun(events)).toMatchObject({ outcome: "success", text: noticeNoKeyFor("xai") });
    expect(noticeNoKeyFor("xai")).toBe(
      "I can't answer yet: this agent runs on xAI, and no xAI key is set. Add one in .env, then restart Steward.",
    );
  });

  it("keeps a pinned agent on its own provider when Settings chooses another, and on the demo model it is unavailable", async () => {
    const h = await host({ OPENROUTER_API_KEY: "k", NVIDIA_API_KEY: "n" });
    await h.configure({ provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" });
    expect(h.info).toMatchObject({ provider: "nvidia", model: "nvidia/nemotron-3-ultra-550b-a55b" });
    const infos = h.agentInfos();
    expect(infos[0]).toMatchObject({
      id: "steward",
      provider: "nvidia",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      available: true,
    });
    expect(infos[1]).toMatchObject({
      id: "steward-claude",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      available: true,
    });
    expect(infos[2]).toMatchObject({ id: "steward-grok", provider: "xai", available: false });

    await h.configure({ provider: "scripted", model: "steward-scripted" });
    const demo = h.agentInfos();
    expect(demo[0]).toMatchObject({
      id: "steward",
      provider: "scripted",
      model: "steward-scripted",
      available: true,
      signIn: "scripted",
    });
    expect(demo[1]).toMatchObject({
      id: "steward-claude",
      provider: "openrouter",
      available: true,
      signIn: "api-key",
    });
    expect(h.agent("steward-claude")).toBeInstanceOf(StewardAgent);
    expect(demo[2]).toMatchObject({ id: "steward-grok", available: false, reason: /xAI key/ });
  });

  it("lists every pinned agent as unavailable on a keyless demo run, with the key each needs", async () => {
    const h = await host({ STEWARD_MODEL_PROVIDER: "scripted" });
    expect(h.agentInfos().map((a) => [a.id, a.available, a.reason])).toEqual([
      ["steward", true, undefined],
      ["steward-claude", false, "No OpenRouter key is set. Add one in .env, then restart Steward."],
      ["steward-grok", false, "No xAI key is set. Add one in .env, then restart Steward."],
    ]);
  });
});

describe("AgentHost with an installed bot that names a model", () => {
  async function botHost(env: NodeJS.ProcessEnv, model: string): Promise<AgentHost> {
    const tenant: TenantPackage = { ...TENANT, agents: [profile("steward", "Steward")] };
    const h = new AgentHost({
      tenant,
      env,
      serverRunToken: "tok",
      shared: SHARED,
      bots: () => [{ pack: botPack(model), skills: [] }],
    });
    hosts.push(h);
    await h.configure();
    return h;
  }

  it("runs the bot on the model it asks for when that provider has a key", async () => {
    const h = await botHost({ OPENROUTER_API_KEY: "k", XAI_API_KEY: "x" }, "xai/grok-4.7");
    expect(h.agentInfos().find((a) => a.id === "rent-scout")).toMatchObject({
      provider: "xai",
      model: "grok-4.7",
      available: true,
      source: "bot:rent-scout",
    });
  });

  it("runs the bot on the default model when its own has no key, rather than leaving it unusable", async () => {
    const h = await botHost({ OPENROUTER_API_KEY: "k" }, "xai/grok-4.7");
    expect(h.agent("rent-scout")).toBeInstanceOf(StewardAgent);
    expect(h.agentInfos().find((a) => a.id === "rent-scout")).toMatchObject({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      available: true,
    });
  });

  it("keeps the bot on the scripted demo model in a demo, whatever it asks for", async () => {
    const h = await botHost({ STEWARD_MODEL_PROVIDER: "scripted", XAI_API_KEY: "x" }, "xai/grok-4.7");
    expect(h.agentInfos().find((a) => a.id === "rent-scout")).toMatchObject({
      provider: "scripted",
      available: true,
      signIn: "scripted",
    });
  });
});

describe("AgentHost with external coding agents", () => {
  const harness = (command: string): HarnessProfile => ({
    id: "claude-code",
    name: "Claude Code",
    title: "Anthropic's coding agent",
    kind: "acp",
    command,
    args: [],
    signIn: "vendor-tool",
  });

  async function harnessHost(profiles: HarnessProfile[]): Promise<AgentHost> {
    const h = new AgentHost({
      tenant: { ...TENANT, agents: [profile("steward", "Steward")] },
      env: { STEWARD_MODEL_PROVIDER: "scripted", PATH: process.env.PATH ?? "" },
      serverRunToken: "tok",
      shared: SHARED,
      harnesses: { profiles, dataDir: tmpdir() },
    });
    hosts.push(h);
    await h.configure();
    return h;
  }

  it("offers an installed coding agent with how it signs in, whatever the model", async () => {
    const h = await harnessHost([harness(process.execPath)]);
    expect(h.agent("claude-code")).toBeInstanceOf(HarnessAgent);
    expect(h.agentInfos().find((a) => a.id === "claude-code")).toMatchObject({
      name: "Claude Code",
      harness: "claude-code",
      provider: "harness:claude-code",
      model: "Claude Code",
      signIn: "vendor-tool",
      available: true,
      skills: [],
      tools: [],
    });
    expect(h.harnessInfos()).toMatchObject([{ id: "claude-code", available: true, path: process.execPath }]);
  });

  it("greys out one whose program is not installed, and its chat says what to install", async () => {
    const h = await harnessHost([harness("steward-no-such-coding-agent")]);
    expect(h.agent("claude-code")).toBeInstanceOf(UnconfiguredAgent);
    expect(h.agentInfos().find((a) => a.id === "claude-code")).toMatchObject({
      available: false,
      reason: expect.stringMatching(/^Claude Code is not installed on this computer/),
    });
  });

  it("keeps a coding agent's processes across rebuilds while its profile is unchanged", async () => {
    const h = await harnessHost([harness(process.execPath)]);
    const before = (h.agent("claude-code") as unknown as { deps: { threads: unknown } }).deps.threads;
    await h.rebuild();
    const after = (h.agent("claude-code") as unknown as { deps: { threads: unknown } }).deps.threads;
    expect(after).toBe(before);
  });

  it("runs a codex profile on the Codex app-server client", async () => {
    const fake = fileURLToPath(
      new URL("../../../packages/harnesses/test/fixtures/fake-codex-app-server.mjs", import.meta.url),
    );
    const h = await harnessHost([
      { ...harness(process.execPath), id: "codex", name: "Codex", kind: "codex", args: [fake] },
    ]);
    const agent = h.agent("codex")!;
    const clone = agent.clone() as AbstractAgent;
    clone.setMessages([{ id: "u1", role: "user", content: "hello" }]);
    clone.threadId = "thr_codex_host";
    let text = "";
    await clone.runAgent(
      { runId: "r1" },
      {
        onEvent: ({ event }) => {
          if (event.type === "TEXT_MESSAGE_CONTENT") text += (event as unknown as { delta: string }).delta;
        },
      },
    );
    expect(text).toBe("Hello from Codex.");
  });

  it("leaves out a coding agent whose id a tenant agent already has", async () => {
    const h = await harnessHost([{ ...harness(process.execPath), id: "steward" }]);
    expect(h.agentInfos().filter((a) => a.id === "steward")).toHaveLength(1);
    expect(h.agent("steward")).not.toBeInstanceOf(HarnessAgent);
  });
});

describe("UnconfiguredAgent", () => {
  it("answers every run with one honest sentence, and survives cloning", async () => {
    const { runner } = runnerOnMemoryDb();
    const agent = new UnconfiguredAgent(NOTICE_NO_KEY, { agentId: "steward" });
    const events = await collect(startRun(runner, agent, runInput("t1", "r1", "hello")));
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(summariseRun(events)).toMatchObject({ outcome: "success", text: NOTICE_NO_KEY });
    expect(NOTICE_NO_KEY).toMatch(/Add a model key in \.env/);
    expect(runner.getThreadMessages("t1").at(-1)?.content).toBe(NOTICE_NO_KEY);
  });
});

describe("modelIdFrom", () => {
  it("keeps a bot on the tenant's model unless its pack names a model id", () => {
    expect(modelIdFrom(undefined)).toBeUndefined();
    expect(modelIdFrom("any")).toBeUndefined();
    expect(modelIdFrom("Any ")).toBeUndefined();
    expect(modelIdFrom("a model that uses tools well")).toBeUndefined();
    expect(modelIdFrom("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(modelIdFrom("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(modelIdFrom("llama3.2:latest")).toBe("llama3.2:latest");
    expect(modelIdFrom("123")).toBeUndefined();
  });
});

describe("modelEnv", () => {
  it("lets the person's choice in Settings beat the environment", () => {
    const env = {
      STEWARD_MODEL_PROVIDER: "openrouter",
      STEWARD_MODEL: "a",
      STEWARD_MODEL_BASE_URL: "http://x/v1",
    };
    expect(modelEnv(env)).toBe(env);
    expect(modelEnv(env, { provider: "nvidia", model: "b" })).toEqual({
      STEWARD_MODEL_PROVIDER: "nvidia",
      STEWARD_MODEL: "b",
    });
    expect(modelEnv(env, { provider: "openrouter", model: "c" }).STEWARD_MODEL_BASE_URL).toBe("http://x/v1");
    expect(
      modelEnv(env, { provider: "ollama", model: "d", baseUrl: "http://127.0.0.1:11434/v1" }),
    ).toMatchObject({
      STEWARD_MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
    });
  });

  it("never pairs a provider's key with an address chosen for another", () => {
    const env = { STEWARD_MODEL_PROVIDER: "openrouter", OPENAI_API_KEY: "sk-openai" };
    // A choice saved with the previous provider's address in it.
    const out = modelEnv(env, { provider: "openai", model: "g", baseUrl: "https://openrouter.ai/api/v1" });
    expect(out.STEWARD_MODEL_PROVIDER).toBe("openai");
    expect(out.STEWARD_MODEL_BASE_URL).toBeUndefined();
  });
});
