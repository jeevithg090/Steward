import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseEvent, Message, ResumeEntry, RunFinishedEvent } from "@ag-ui/client";
import { memoryDb } from "@steward/db";
import { createGateway, type StewardGateway } from "@steward/gateway";
import type { ApprovalInterruptMetadata, HarnessProfile } from "@steward/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexBackend } from "../src/codex/backend.ts";
import {
  changedFiles,
  commandPermission,
  decisionFor,
  elicitationPermission,
  elicitationResponse,
  fileChangePermission,
  itemCompleted,
  usageFrom,
} from "../src/codex/mapping.ts";
import { HarnessAgent } from "../src/harness-agent.ts";
import { findProgram } from "../src/profiles.ts";
import { HarnessThreads } from "../src/session.ts";
import { HarnessSessionStore, migrations } from "../src/store.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));
const CWD = "/data/computers/codex/workspace";

describe("Codex approvals in Steward's terms (plan §3)", () => {
  it("makes a command request a shell call with its command as the target", () => {
    expect(commandPermission({ command: ["npm", "test"], cwd: "/w", reason: "Run it" }, "t:1")).toEqual({
      callId: "t:1",
      toolName: "shell",
      kind: "shell",
      surface: "shell",
      args: { command: "npm test", cwd: "/w", reason: "Run it" },
      target: { command: "npm test" },
    });
  });

  it("lists every file a change touches, asks outside the workspace, and treats a pure delete as a delete", () => {
    const inside = fileChangePermission(
      { fileChanges: { [`${CWD}/a.md`]: { type: "update" }, [`${CWD}/b.md`]: { type: "add" } } },
      "t:2",
      CWD,
    );
    // Judged by the folder that holds every file, so a folder rule allows it only when all are in it.
    expect(inside).toMatchObject({
      kind: "write",
      surface: "file",
      target: { path: "./" },
      args: { files: ["a.md", "b.md"] },
    });
    expect(
      fileChangePermission(
        {
          fileChanges: {
            "/srv/project/a.ts": { type: "update" },
            "/Users/me/.ssh/config": { type: "update" },
          },
        },
        "t:2b",
        CWD,
      ),
    ).toMatchObject({ surface: "system", target: { path: "/" } });
    expect(
      fileChangePermission({ fileChanges: { "/etc/hosts": { type: "update" } } }, "t:3", CWD),
    ).toMatchObject({
      surface: "system",
      // Outside the workspace, where it really is (on macOS /etc is a link to /private/etc).
      target: { path: join(realpathSync("/etc"), "hosts") },
    });
    expect(
      fileChangePermission({ fileChanges: { "a.md": { type: "update" } }, grantRoot: "/srv" }, "t:4", CWD)
        .surface,
    ).toBe("system");
    expect(fileChangePermission({ fileChanges: { "old.md": { type: "delete" } } }, "t:5", CWD).kind).toBe(
      "delete",
    );
    // Deleting any file makes the whole change a delete, so a tainted one always asks.
    expect(
      fileChangePermission(
        {
          fileChanges: {
            "src/a.ts": { type: "delete" },
            "src/b.ts": { type: "delete" },
            "README.md": { type: "update" },
          },
        },
        "t:5b",
        CWD,
      ),
    ).toMatchObject({ kind: "delete", surface: "file" });
    // So does moving one: it is gone from where it was.
    expect(
      fileChangePermission({ fileChanges: { "a.md": { type: "update", move_path: "b.md" } } }, "t:5c", CWD)
        .kind,
    ).toBe("delete");
    expect(
      fileChangePermission({}, "t:5d", CWD, [
        { path: "a.md", kind: { type: "update", move_path: "/tmp/a.md" } },
      ]),
    ).toMatchObject({
      kind: "delete",
      surface: "system",
      args: { files: ["a.md", join(realpathSync("/tmp"), "a.md")] },
    });
    // A change that lists no file, or one to a vendor tool's own settings, asks.
    expect(fileChangePermission({}, "t:5e", CWD).surface).toBe("system");
    expect(
      fileChangePermission({ fileChanges: { ".codex/config.toml": { type: "update" } } }, "t:5f", CWD)
        .surface,
    ).toBe("system");
    // A request that does not list its files uses the ones its item started with.
    expect(fileChangePermission({}, "t:6", CWD, [{ path: "c.md", kind: { type: "update" } }]).target).toEqual(
      { path: "c.md" },
    );
    expect(changedFiles({ "a.md": { type: "update", move_path: "b.md" } })).toEqual([
      { path: "a.md", kind: "move" },
      { path: "b.md", kind: "add" },
    ]);
  });

  it("makes an MCP elicitation an mcp call on its server and tool", () => {
    expect(
      elicitationPermission(
        { serverName: "notion", message: "Allow tool `search`?", _meta: { tool_params: { q: "x" } } },
        "t:7",
      ),
    ).toMatchObject({
      kind: "write",
      surface: "mcp",
      target: { mcp: { server: "notion", tool: "search" } },
      args: { q: "x" },
    });
  });

  it("answers accept, decline or cancel, never acceptForSession", () => {
    expect(decisionFor("allow_once")).toBe("accept");
    expect(decisionFor("reject")).toBe("decline");
    expect(decisionFor("cancelled")).toBe("cancel");
    expect(elicitationResponse("allow_once")).toEqual({ action: "accept", content: null, _meta: null });
    expect(elicitationResponse("cancelled").action).toBe("cancel");
  });

  it("reads token usage, and a declined command as not run", () => {
    expect(
      usageFrom(
        { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, totalTokens: 12 },
        "gpt-5.6-terra",
        "harness:codex",
      ),
    ).toEqual({
      provider: "harness:codex",
      model: "gpt-5.6-terra",
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cachedInputTokens: 4,
    });
    expect(usageFrom({}, "m", "p")).toBeUndefined();
    expect(
      itemCompleted({ type: "commandExecution", id: "c", command: "ls", status: "declined" }, "t:c", false),
    ).toEqual([{ type: "tool_end", callId: "t:c", ok: false, output: "Not run." }]);
    expect(itemCompleted({ type: "agentMessage", id: "m", text: "Hi" }, "t:m", true)).toEqual([]);
  });
});

const root = mkdtempSync(join(tmpdir(), "steward-codex-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
let gateway: StewardGateway;
let threads: HarnessThreads;
let agent: HarnessAgent;
let logFile: string;
let store: HarnessSessionStore;

function profile(): HarnessProfile {
  return {
    id: "codex",
    name: "Codex",
    title: "OpenAI's coding agent",
    kind: "codex",
    command: process.execPath,
    args: [FAKE],
    env: { FAKE_CODEX_LOG: logFile },
    signIn: "vendor-tool",
  };
}

beforeEach(() => {
  n += 1;
  const db = memoryDb();
  db.migrate(migrations);
  gateway = createGateway({ db });
  store = new HarnessSessionStore(db);
  logFile = join(root, `codex-${n}.jsonl`);
  threads = new HarnessThreads({
    profile: profile(),
    agentId: "codex",
    workspace: join(root, `computers-${n}`, "codex", "workspace"),
    store,
    audit: gateway.audit,
    backend: ({ cwd, events }) =>
      new CodexBackend({ profile: profile(), cwd, events, env: process.env, interruptGraceMs: 400 }),
  });
  agent = new HarnessAgent({
    agentId: "codex",
    title: "OpenAI's coding agent",
    harness: profile(),
    threads,
    governance: gateway.governance,
    actorId: "local",
    serverRunToken: "tok",
  });
});

afterEach(async () => {
  await threads.closeAll();
});

const user = (content: string): Message => ({
  id: `u_${Math.random().toString(36).slice(2)}`,
  role: "user",
  content,
});

async function run(
  messages: Message[],
  opts: { resume?: ResumeEntry[]; stopAfter?: (e: BaseEvent) => boolean } = {},
) {
  const clone = agent.clone();
  clone.setMessages(messages);
  clone.threadId = "thr_codex";
  const events: BaseEvent[] = [];
  await clone.runAgent(
    { runId: `run_${Math.random().toString(36).slice(2)}`, ...(opts.resume ? { resume: opts.resume } : {}) },
    {
      onEvent: ({ event }) => {
        events.push(event);
        if (opts.stopAfter?.(event)) setTimeout(() => clone.abortRun(), 0);
      },
    },
  );
  const text = events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => (e as unknown as { delta: string }).delta)
    .join("");
  return {
    events,
    messages: clone.messages,
    text,
    finished: events.findLast((e) => e.type === "RUN_FINISHED") as RunFinishedEvent,
  };
}

function received(): Record<string, unknown>[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => (JSON.parse(l) as { received: Record<string, unknown> }).received);
}
const requests = (method: string) => received().filter((m) => m.method === method);
const answers = () => received().filter((m) => m.method === undefined && m.result !== undefined);

function interruptOf(turn: { finished: RunFinishedEvent }) {
  const outcome = turn.finished.outcome;
  expect(outcome?.type).toBe("interrupt");
  return outcome?.type === "interrupt" ? outcome.interrupts[0]! : undefined!;
}

describe("Codex as a Steward agent, against the app-server transcript", () => {
  it("starts its thread asking before anything leaves the sandbox, and answers with tokens counted", async () => {
    const turn = await run([user("hello")]);
    expect(turn.text).toBe("Hello from Codex.");
    expect(turn.events.some((e) => e.type === "REASONING_MESSAGE_CONTENT")).toBe(true);
    const [start] = requests("thread/start");
    expect(start?.params as Record<string, unknown>).toMatchObject({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
    expect(requests("turn/start")[0]?.params as Record<string, unknown>).toMatchObject({
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "workspaceWrite" },
    });
    expect(requests("initialized")).toHaveLength(1);
    expect(turn.finished.usage).toEqual([
      {
        provider: "harness:codex",
        model: "gpt-5.6-terra",
        inputTokens: 1200,
        outputTokens: 40,
        totalTokens: 1240,
        cachedInputTokens: 800,
        reasoningTokens: 12,
      },
    ]);
  });

  it("parks a command for the person, answers accept on resume, and sums the turn's tokens", async () => {
    const first = await run([user("run the tests")]);
    const interrupt = interruptOf(first);
    const meta = interrupt.metadata as unknown as ApprovalInterruptMetadata;
    expect(meta).toMatchObject({
      summary: "Run a command: npm test",
      tool: { kind: "shell", source: "harness:codex" },
      canAlways: false,
    });
    // The command was shown before it was asked about, under the same id the approval uses.
    const started = first.events
      .filter((e) => e.type === "TOOL_CALL_START")
      .map((e) => (e as { toolCallId?: string }).toolCallId);
    expect(started).toContain(interrupt.toolCallId);
    gateway.approvals.decide(meta.approvalId, "once", "local");
    const resumed = await run(first.messages, {
      resume: [{ interruptId: interrupt.id, status: "resolved" }],
    });
    expect(resumed.text).toBe("All tests pass.");
    expect(answers().at(-1)?.result).toEqual({ decision: "accept" });
    expect(resumed.finished.usage).toEqual([
      expect.objectContaining({
        provider: "harness:codex",
        inputTokens: 4100,
        outputTokens: 50,
        totalTokens: 4150,
      }),
    ]);
  });

  it("answers a refusal with decline", async () => {
    const first = await run([user("run the tests")]);
    const interrupt = interruptOf(first);
    gateway.approvals.decide(
      (interrupt.metadata as unknown as ApprovalInterruptMetadata).approvalId,
      "refuse",
      "local",
    );
    const resumed = await run(first.messages, {
      resume: [{ interruptId: interrupt.id, status: "cancelled" }],
    });
    expect(resumed.text).toBe("I did not run the tests.");
    expect(answers().at(-1)?.result).toEqual({ decision: "decline" });
  });

  it("lets a change inside the workspace run, and answers Always allow outside it with accept, never for the session", async () => {
    const inside = await run([user("edit the readme")]);
    expect(inside.text).toBe("Updated the README.");
    expect(answers().at(-1)?.result).toEqual({ decision: "accept" });

    const outside = await run([...inside.messages, user("edit the project")]);
    const interrupt = interruptOf(outside);
    const meta = interrupt.metadata as unknown as ApprovalInterruptMetadata;
    expect(meta).toMatchObject({ tool: { kind: "write", surface: "system" }, canAlways: true });
    gateway.approvals.decide(meta.approvalId, "always", "local");
    const resumed = await run(outside.messages, {
      resume: [{ interruptId: interrupt.id, status: "resolved" }],
    });
    expect(resumed.text).toBe("Changed it once.");
    // Always allow is Steward's rule: Codex is told yes this once, so it asks again next time,
    // and that ask reaches the gateway and the record.
    expect(answers().at(-1)?.result).toEqual({ decision: "accept" });
    expect(answers().some((a) => JSON.stringify(a.result).includes("acceptForSession"))).toBe(false);
  });

  it("asks before a tool on one of Codex's MCP servers, and refuses grants Steward does not make", async () => {
    const tool = await run([user("use a tool")]);
    const meta = interruptOf(tool).metadata as unknown as ApprovalInterruptMetadata;
    expect(meta.tool).toMatchObject({ surface: "mcp", source: "harness:codex" });
    await run([...tool.messages, user("widen")]);
    const refusedGrant = received().find((m) => m.error !== undefined);
    expect(refusedGrant).toMatchObject({ error: { code: -32601 } });
  });

  it("stop interrupts the turn, and the run ends cancelled", async () => {
    const turn = await run([user("wait")], { stopAfter: (e) => e.type === "TEXT_MESSAGE_CONTENT" });
    expect(turn.text).toBe("Working on it.");
    expect(requests("turn/interrupt")).toHaveLength(1);
    expect(turn.events.at(-1)?.type).toBe("RUN_FINISHED");
    const after = await run([...turn.messages, user("hello")]);
    expect(after.text).toBe("Hello from Codex.");
  });

  it("restarts a wedged app-server, and the next message resumes its thread", async () => {
    const pidsInLog = () =>
      new Set(
        readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => (JSON.parse(line) as { pid: number }).pid),
      );
    const first = await run([user("hello")]);
    const turn = await run([...first.messages, user("wedged")], {
      stopAfter: (e) => e.type === "TEXT_MESSAGE_CONTENT",
    });
    expect(turn.text).toBe("Stuck.");
    const before = [...pidsInLog()];
    expect(before).toHaveLength(1);
    const after = await run([...turn.messages, user("hello")]);
    expect(after.text).toBe("Hello from Codex.");
    const resumes = requests("thread/resume");
    expect(resumes).toHaveLength(1);
    const resumed = resumes[0]?.params as { threadId?: string } | undefined;
    expect(resumed?.threadId).toBe("019a7c3e-codex-thread-1");
    expect(pidsInLog().size).toBe(2);
    for (const pid of before) expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("Codex that does not start", () => {
  const events = { update: () => {}, permission: async () => "reject" as const, exited: () => {} };
  const backend = (args: string[], extra: { command?: string; startTimeoutMs?: number } = {}) =>
    new CodexBackend({
      profile: { ...profile(), args, ...(extra.command ? { command: extra.command } : {}) },
      cwd: root,
      env: process.env,
      events,
      ...(extra.startTimeoutMs ? { startTimeoutMs: extra.startTimeoutMs } : {}),
    });

  it("says why it stopped, in its own last words", async () => {
    const crashing = backend([
      "-e",
      "process.stderr.write('Error: not logged in. Run `codex login`.\\n'); process.exit(2)",
    ]);
    await expect(crashing.start({})).rejects.toThrow(
      "Codex stopped before it was ready (exit code 2): Error: not logged in. Run `codex login`.",
    );
    await expect(backend([], { command: join(root, "no-codex-here") }).start({})).rejects.toThrow(
      /^Codex is not installed here/,
    );
  });

  it("gives up on one that never answers, and stops it", async () => {
    const silent = backend(["-e", "setInterval(() => {}, 1e9)"], { startTimeoutMs: 300 });
    await expect(silent.start({})).rejects.toThrow(
      "Codex did not answer within 1 second. Check that 'node -e setInterval(() => {}, 1e9)' starts the Codex app-server.",
    );
    expect(silent.pid).toBeUndefined();
  });
});

// A live check against the real `codex`, only when it is installed AND the person asks for it:
// starting it uses their own Codex sign-in, which no test should do by default.
const live = Boolean(findProgram("codex", process.env)) && process.env.STEWARD_LIVE_CODEX === "1";
describe.skipIf(!live)("Codex app-server, live", () => {
  it("initialises and opens a thread with Steward's policy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "steward-codex-live-"));
    const backend = new CodexBackend({
      profile: { ...profile(), command: "codex", args: ["app-server", "--listen", "stdio://"], env: {} },
      cwd: dir,
      env: process.env,
      events: { update: () => {}, permission: async () => "reject", exited: () => {} },
    });
    try {
      const opened = await backend.start({});
      expect(opened.handle).toMatch(/\S/);
    } finally {
      await backend.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
