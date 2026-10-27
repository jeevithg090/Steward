import type {
  ComputerManager,
  MailCalendar,
  McpManager,
  McpServerInfo,
  SetupCheck,
  TextModel,
} from "@steward/shared";
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../src/runtime/agents.ts";
import { SetupService } from "../src/setup/checks.ts";

const realModel: ModelInfo = {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-5.5",
  label: "OpenRouter",
  scripted: false,
};

function service(opts: {
  info?: ModelInfo;
  complete?: TextModel["complete"];
  mail?: Partial<MailCalendar>;
  running?: boolean;
  mcp?: McpServerInfo[];
  now?: () => number;
}) {
  const calls = { complete: 0 };
  const text: TextModel | undefined = opts.complete
    ? {
        label: "test",
        complete: (o) => {
          calls.complete++;
          return opts.complete!(o);
        },
      }
    : undefined;
  const setup = new SetupService({
    model: () => ({ info: opts.info ?? realModel, ...(text ? { text } : {}), version: 1 }),
    mail: () =>
      opts.mail
        ? ({
            id: "demo",
            label: "Demo inbox",
            isDemo: true,
            listEmails: async () => [],
            listEvents: async () => [],
            ...opts.mail,
          } as MailCalendar)
        : undefined,
    computers: { status: () => ({ running: opts.running ?? false }) } as unknown as ComputerManager,
    agentId: "steward",
    mcp: { list: () => opts.mcp ?? [] } as unknown as McpManager,
    brandName: "Steward",
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { setup, calls };
}

const byId = (checks: SetupCheck[], id: SetupCheck["id"]) => checks.find((c) => c.id === id)!;
const ENV_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

describe("SetupService", () => {
  it("is ready only when the model actually answers, and caches the answer", async () => {
    const { setup, calls } = service({ complete: async () => "OK", mail: {} });
    const checks = await setup.list();
    expect(byId(checks, "model")).toMatchObject({ status: "ready", optional: false });
    expect(byId(checks, "mail")).toMatchObject({
      status: "ready",
      detail: expect.stringContaining("demo inbox"),
    });
    expect(byId(checks, "calendar").status).toBe("ready");
    await setup.list();
    expect(calls.complete).toBe(1);
  });

  it("re-asks on Check again, at most every ten seconds", async () => {
    let t = 1_000_000;
    const { setup, calls } = service({ complete: async () => "OK", now: () => t });
    await setup.list();
    await setup.recheck();
    expect(calls.complete).toBe(2);
    await setup.recheck();
    expect(calls.complete).toBe(2);
    t += 11_000;
    await setup.recheck();
    expect(calls.complete).toBe(3);
  });

  it("says plainly what is wrong with the model, without naming settings", async () => {
    const refused = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const cases: [ModelInfo, TextModel["complete"] | undefined, RegExp][] = [
      [
        { ...realModel, provider: "scripted", model: "steward-scripted", scripted: true },
        async () => "",
        /scripted demo model/,
      ],
      [realModel, async () => Promise.reject(refused), /refused the key/],
      [
        realModel,
        async () => Promise.reject(Object.assign(new Error("nf"), { statusCode: 404 })),
        /doesn't offer/,
      ],
      [{ ...realModel, problem: "no_key" }, undefined, /Without a model key/],
    ];
    for (const [info, complete, detail] of cases) {
      const { setup } = service({ info, ...(complete ? { complete } : {}) });
      const model = byId(await setup.list(), "model");
      expect(model.status).toBe("needs_setup");
      expect(model.detail).toMatch(detail);
      expect(`${model.detail} ${model.fix ?? ""}`).not.toMatch(ENV_NAME);
    }
    const busy = service({
      complete: async () => Promise.reject(Object.assign(new Error("slow"), { statusCode: 429 })),
    });
    expect(byId(await busy.setup.list(), "model").status).toBe("not_checked");
  });

  it("covers mail, the computer, notifications, voice and tool servers", async () => {
    const { setup } = service({
      complete: async () => "OK",
      mail: { listEmails: async () => Promise.reject(new Error("down")) },
      mcp: [
        { id: "a", name: "A", transport: "http", status: "connected", tools: [] },
        { id: "b", name: "B", transport: "stdio", status: "error", error: "spawn failed", tools: [] },
      ],
    });
    const checks = await setup.list();
    expect(checks.map((c) => c.id)).toEqual([
      "model",
      "mail",
      "calendar",
      "computer",
      "notifications",
      "voice",
      "mcp",
    ]);
    expect(byId(checks, "mail").status).toBe("needs_setup");
    expect(byId(checks, "computer")).toMatchObject({
      status: "not_checked",
      detail: expect.stringContaining("first time"),
    });
    expect(byId(checks, "notifications")).toMatchObject({ status: "not_checked", optional: true });
    expect(byId(checks, "mcp")).toMatchObject({
      status: "needs_setup",
      detail: "1 of 2 tool servers isn't answering.",
    });
    for (const c of checks) expect(`${c.detail} ${c.fix ?? ""}`).not.toMatch(ENV_NAME);

    const none = service({ complete: async () => "OK", running: true });
    const quiet = await none.setup.list();
    expect(byId(quiet, "mail").status).toBe("needs_setup");
    expect(byId(quiet, "computer").status).toBe("ready");
    expect(byId(quiet, "mcp").status).toBe("ready");
  });
});
