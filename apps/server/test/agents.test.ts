import { EventType } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { modelEnv, NOTICE_NO_KEY, UnconfiguredAgent } from "../src/runtime/agents.ts";
import { summariseRun } from "../src/runtime/run-summary.ts";
import { collect, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

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
