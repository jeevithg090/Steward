import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseEvent, Message, ResumeEntry, RunFinishedEvent } from "@ag-ui/client";
import { memoryDb } from "@steward/db";
import { createGateway, type StewardGateway } from "@steward/gateway";
import {
  APPROVAL_INTERRUPT_REASON,
  type ApprovalInterruptMetadata,
  type HarnessProfile,
} from "@steward/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AcpBackend } from "../src/acp/backend.ts";
import { HarnessAgent } from "../src/harness-agent.ts";
import { HarnessStartStopped, HarnessThreads } from "../src/session.ts";
import { HarnessSessionStore, migrations } from "../src/store.ts";
import type { HarnessBackend } from "../src/types.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-acp-agent.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "steward-harness-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
let gateway: StewardGateway;
let threads: HarnessThreads;
let agent: HarnessAgent;
let logFile: string;
let store: HarnessSessionStore;
let workspace: string;

function profile(): HarnessProfile {
  return {
    id: "fake",
    name: "Fake Agent",
    title: "A fake ACP agent",
    kind: "acp",
    command: process.execPath,
    args: [FIXTURE],
    env: { FAKE_ACP_LOG: logFile },
    signIn: "vendor-tool",
  };
}

/** A program that starts and then never says a word, as an agent run without its ACP flag does. */
function silent(): HarnessProfile {
  return { ...profile(), command: process.execPath, args: ["-e", "setInterval(() => {}, 1e9)"] };
}

function build(opts: { idleMs?: number; profile?: HarnessProfile; startTimeoutMs?: number } = {}) {
  const chosen = opts.profile ?? profile();
  threads = new HarnessThreads({
    profile: chosen,
    agentId: "fake",
    workspace,
    store,
    audit: gateway.audit,
    actorId: "local",
    ...(opts.idleMs ? { idleMs: opts.idleMs } : {}),
    backend: ({ cwd, events }) =>
      new AcpBackend({
        profile: chosen,
        cwd,
        events,
        env: { ...process.env, OPENROUTER_API_KEY: "sk-or-must-not-leak" },
        ...(opts.startTimeoutMs ? { startTimeoutMs: opts.startTimeoutMs } : {}),
      }),
  });
  agent = new HarnessAgent({
    agentId: "fake",
    title: "A fake ACP agent",
    harness: chosen,
    threads,
    governance: gateway.governance,
    actorId: "local",
    serverRunToken: "tok",
  });
}

beforeEach(() => {
  n += 1;
  const db = memoryDb();
  db.migrate(migrations);
  gateway = createGateway({ db });
  store = new HarnessSessionStore(db);
  logFile = join(root, `log-${n}.jsonl`);
  workspace = join(root, `computers-${n}`, "fake", "workspace");
  build();
});

afterEach(async () => {
  await threads.closeAll();
});

interface Turn {
  events: BaseEvent[];
  messages: Message[];
  finished?: RunFinishedEvent;
  text: string;
  error?: string;
}

const user = (content: string): Message => ({
  id: `u_${Math.random().toString(36).slice(2)}`,
  role: "user",
  content,
});

async function run(
  messages: Message[],
  opts: {
    resume?: ResumeEntry[];
    threadId?: string;
    stopAfter?: (e: BaseEvent) => boolean;
    stopAfterMs?: number;
  } = {},
): Promise<Turn> {
  const clone = agent.clone();
  if (opts.stopAfterMs !== undefined) setTimeout(() => clone.abortRun(), opts.stopAfterMs);
  clone.setMessages(messages);
  clone.threadId = opts.threadId ?? "thr_1";
  const events: BaseEvent[] = [];
  let error: string | undefined;
  try {
    await clone.runAgent(
      {
        runId: `run_${Math.random().toString(36).slice(2)}`,
        ...(opts.resume ? { resume: opts.resume } : {}),
      },
      {
        onEvent: ({ event }) => {
          events.push(event);
          if (opts.stopAfter?.(event)) setTimeout(() => clone.abortRun(), 0);
        },
      },
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const finished = events.findLast((e) => e.type === "RUN_FINISHED") as RunFinishedEvent | undefined;
  const runError = events.find((e) => e.type === "RUN_ERROR") as { message?: string } | undefined;
  const text = events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => (e as unknown as { delta: string }).delta)
    .join("");
  return {
    events,
    messages: clone.messages,
    ...(finished ? { finished } : {}),
    text,
    ...(error || runError?.message ? { error: error ?? runError?.message } : {}),
  };
}

function log(): Record<string, unknown>[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const permissions = () => log().filter((e) => e.event === "permission");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 200 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}

function interruptOf(turn: Turn) {
  const outcome = turn.finished?.outcome;
  expect(outcome?.type).toBe("interrupt");
  const interrupt = outcome?.type === "interrupt" ? outcome.interrupts[0] : undefined;
  expect(interrupt?.reason).toBe(APPROVAL_INTERRUPT_REASON);
  return interrupt!;
}

/** A rule of the person's, as someone would write on /rules. */
function rule(effect: "allow" | "deny", when: string): void {
  gateway.rules.create({
    name: `The fake agent: ${effect} ${when}`,
    effect,
    when,
    description: "",
    source: "person",
    enabled: true,
  });
}

/** Lets the fake agent work on a project folder outside its workspace. */
function allowProject(): void {
  rule("allow", 'tool.source == "harness:fake" && startsWith(target.path, "/srv/project/")');
}

describe("a harness agent over ACP", () => {
  it("answers in words, through the stdout filter, in a process of its own in the workspace", async () => {
    const turn = await run([user("hello")]);
    expect(turn.error).toBeUndefined();
    expect(turn.text).toBe("Hi from the fake agent.");
    expect(turn.events[0]?.type).toBe("RUN_STARTED");
    expect(turn.finished?.outcome).toBeUndefined();
    const [start] = log();
    expect(start).toMatchObject({ event: "start", cwd: expect.stringContaining(join("fake", "workspace")) });
    // The real HOME, so the vendor tool finds its own sign-in; never Steward's keys.
    expect(start?.home).toBe(process.env.HOME ?? null);
    expect(start?.secret).toBeNull();
    // The second message goes to the same process and session.
    const [pid] = threads.pids();
    const again = await run([...turn.messages, user("hello")]);
    expect(again.text).toBe("Hi from the fake agent.");
    expect(threads.pids()).toEqual([pid]);
    expect(log().filter((e) => e.event === "new")).toHaveLength(1);
    // The record says when a coding agent started.
    expect(gateway.audit.page({ type: "harness.started" }).events).toHaveLength(1);
  });

  it("shows thinking as reasoning, closed before the answer", async () => {
    const turn = await run([user("think")]);
    const types: string[] = turn.events.map((e) => e.type);
    expect(types).toContain("REASONING_MESSAGE_CONTENT");
    expect(types.indexOf("REASONING_END")).toBeLessThan(types.indexOf("TEXT_MESSAGE_START"));
    expect(turn.text).toBe("Thought it through.");
  });

  it("asks twice: a rule allows the first, the second parks for the person and resumes the same turn", async () => {
    allowProject();
    const first = await run([user("work")]);
    expect(first.error).toBeUndefined();
    const interrupt = interruptOf(first);
    const meta = interrupt.metadata as unknown as ApprovalInterruptMetadata;
    expect(meta.summary).toBe("Run a command: npm test");
    expect(meta.tool).toMatchObject({ kind: "shell", surface: "shell", source: "harness:fake" });
    expect(meta.canAlways).toBe(false);
    // The person's rule allowed the change to their project; the harness was answered allow once.
    expect(permissions()).toEqual([
      expect.objectContaining({
        toolCallId: "call_readme",
        outcome: { outcome: "selected", optionId: "yes" },
      }),
    ]);
    // The interrupt is keyed by the call shown in the conversation, so the card and the sweep find it.
    const shown = first.events
      .filter((e) => e.type === "TOOL_CALL_START")
      .map((e) => (e as { toolCallId?: string }).toolCallId);
    expect(shown).toContain(interrupt.toolCallId);
    // The process and its open request wait for the answer.
    expect(threads.pids()).toHaveLength(1);

    gateway.approvals.decide(meta.approvalId, "once", "local");
    const resumed = await run(first.messages, {
      resume: [{ interruptId: interrupt.id, status: "resolved" }],
    });
    expect(resumed.error).toBeUndefined();
    expect(resumed.text).toBe("All tests pass.");
    expect(resumed.finished?.outcome).toBeUndefined();
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_test",
      outcome: { outcome: "selected", optionId: "yes" },
    });
    // The same turn carried on: the parked call gets its result, and is not shown twice.
    const results = resumed.events
      .filter((e) => e.type === "TOOL_CALL_RESULT")
      .map((e) => (e as { toolCallId?: string }).toolCallId);
    expect(results).toContain(interrupt.toolCallId);
    expect(resumed.events.filter((e) => e.type === "TOOL_CALL_START")).toHaveLength(0);
    expect(log().filter((e) => e.event === "prompt")).toHaveLength(1);

    // The record keeps every decision, under the harness, without the title.
    const decided = gateway.audit.page({ type: "tool.decided" }).events;
    expect(
      decided.map((e) => [e.tool?.source, e.target?.command ?? e.target?.path, e.effect, e.rule?.source]),
    ).toEqual(
      expect.arrayContaining([
        ["harness:fake", "/srv/project/README.md", "allow", "person"],
        ["harness:fake", "npm test", "ask", "preset"],
        ["harness:fake", "npm test", "allow", "person"],
      ]),
    );
    expect(JSON.stringify(decided)).not.toContain("a title that lies");
  });

  it("asks before every command, even one a rule allows, and refuses what a rule refuses", async () => {
    // Everything a coding agent saw is untrusted, so its commands always ask (PLAN §4.5).
    rule("allow", 'tool.source == "harness:fake" && target.command == "ls"');
    const asked = await run([user("list")]);
    expect((interruptOf(asked).metadata as unknown as ApprovalInterruptMetadata).summary).toBe(
      "Run a command: ls",
    );
    await threads.closeAll();
    build();
    rule("deny", 'tool.source == "harness:fake" && target.command == "ls"');
    const refused = await run([user("list")], { threadId: "thr_2" });
    expect(refused.finished?.outcome).toBeUndefined();
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_ls",
      outcome: { outcome: "selected", optionId: "no" },
    });
  });

  it("answers a refusal with the reject option, and the harness carries on without it", async () => {
    allowProject();
    const first = await run([user("work")]);
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
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_test",
      outcome: { outcome: "selected", optionId: "no" },
    });
  });

  it("answers Always allow with allow once, so the harness keeps asking and every call is recorded", async () => {
    const first = await run([user("edit")]);
    const interrupt = interruptOf(first);
    const meta = interrupt.metadata as unknown as ApprovalInterruptMetadata;
    // A change outside the workspace asks, even though writes in it run.
    expect(meta.tool).toMatchObject({ kind: "write", surface: "system" });
    expect(meta.canAlways).toBe(true);
    gateway.approvals.decide(meta.approvalId, "always", "local");
    await run(first.messages, { resume: [{ interruptId: interrupt.id, status: "resolved" }] });
    // Never the harness's own "always": that would stop it asking, and Steward from seeing.
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_edit",
      outcome: { outcome: "selected", optionId: "yes" },
    });
    // The next time it asks, Steward's rule answers at once, and the record has it.
    const again = await run([...first.messages, user("edit")]);
    expect(again.finished?.outcome).toBeUndefined();
    expect(permissions().filter((e) => e.toolCallId === "call_edit")).toHaveLength(2);
    expect(permissions().some((e) => JSON.stringify(e.outcome).includes("always"))).toBe(false);
    const allowed = gateway.audit
      .page({ type: "tool.decided" })
      .events.filter((e) => e.target?.path === "/etc/hosts" && e.effect === "allow");
    // Once for the answer itself, once for the call the rule then let through.
    expect(allowed.map((e) => e.rule?.source)).toEqual(["always", "always"]);
  });

  it("stop cancels the turn, and the conversation can go on", async () => {
    const turn = await run([user("slow")], {
      stopAfter: (e) => e.type === "TEXT_MESSAGE_CONTENT",
    });
    expect(turn.text).toBe("Working on it.");
    expect(log().some((e) => e.event === "cancel")).toBe(true);
    expect(turn.events.at(-1)?.type).toBe("RUN_FINISHED");
    const after = await run([...turn.messages, user("hello")]);
    expect(after.text).toBe("Hi from the fake agent.");
    expect(threads.pids()).toHaveLength(1);
  });

  it("a new message while a request waits cancels the request and starts a new turn", async () => {
    allowProject();
    const first = await run([user("work")]);
    const interrupt = interruptOf(first);
    const next = await run([...first.messages, user("hello")]);
    expect(next.text).toBe("Hi from the fake agent.");
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_test",
      outcome: { outcome: "cancelled" },
    });
    expect(gateway.approvals.byToolCall(interrupt.toolCallId!)?.status).toBe("cancelled");
    // The parked call is closed in the conversation, so nothing waits on it.
    expect(
      next.events.some(
        (e) =>
          e.type === "TOOL_CALL_RESULT" && (e as { toolCallId?: string }).toolCallId === interrupt.toolCallId,
      ),
    ).toBe(true);
  });

  it("reopens the session after its process stopped, without showing the replayed history", async () => {
    const first = await run([user("hello")]);
    const [pid] = threads.pids();
    await threads.close("thr_1");
    expect(await gone(pid!)).toBe(true);
    const again = await run([...first.messages, user("hello")]);
    expect(again.text).toBe("Hi from the fake agent.");
    expect(again.text).not.toContain("replayed");
    const sessionId = log().find((e) => e.event === "new")?.sessionId;
    expect(log().find((e) => e.event === "load")).toMatchObject({ sessionId });
  });

  it("closes an answer whose harness stopped while it waited, and says so", async () => {
    allowProject();
    const first = await run([user("work")]);
    const interrupt = interruptOf(first);
    const meta = interrupt.metadata as unknown as ApprovalInterruptMetadata;
    await threads.close("thr_1");
    gateway.approvals.decide(meta.approvalId, "once", "local");
    const resumed = await run(first.messages, {
      resume: [{ interruptId: interrupt.id, status: "resolved" }],
    });
    expect(resumed.text).toMatch(/Fake Agent stopped while it waited for your answer, so nothing was done/);
    // Claimed, so the resume sweep does not try it again and nothing can act on it later.
    expect(gateway.approvals.byToolCall(interrupt.toolCallId!)?.claimedAt).toBeTruthy();
    expect(permissions().filter((e) => e.toolCallId === "call_test")).toHaveLength(1);
  });

  it("stops an idle process, and leaves no process behind", async () => {
    await threads.closeAll();
    build({ idleMs: 300 });
    await run([user("hello")], { threadId: "thr_a" });
    await run([user("hello")], { threadId: "thr_b" });
    const started = gateway.audit
      .page({ type: "harness.started" })
      .events.filter((e) => e.threadId === "thr_a" || e.threadId === "thr_b");
    const pids = started.map((e) => e.detail.pid as number);
    expect(pids).toHaveLength(2);
    for (const pid of pids) expect(await gone(pid)).toBe(true);
    expect(threads.pids()).toEqual([]);
    expect(gateway.audit.page({ type: "harness.stopped" }).events.map((e) => e.detail.reason)).toContain(
      "idle",
    );
  });

  it("says plainly when the program cannot be started", async () => {
    threads = new HarnessThreads({
      profile: { ...profile(), command: join(root, "no-such-program") },
      agentId: "fake",
      workspace,
      backend: ({ cwd, events }) =>
        new AcpBackend({
          profile: { ...profile(), command: join(root, "no-such-program") },
          cwd,
          events,
          env: process.env,
        }),
    });
    agent = new HarnessAgent({
      agentId: "fake",
      title: "",
      harness: profile(),
      threads,
      governance: gateway.governance,
      actorId: "local",
      serverRunToken: "tok",
    });
    const turn = await run([user("hello")]);
    // A missing program is "not installed", never "spawn /path ENOENT".
    expect(turn.error).toMatch(/^Fake Agent is not installed here/);
    expect(turn.error).not.toMatch(/ENOENT|spawn/);
  });
});

describe("a harness that does not start, or stops", () => {
  it("gives up on a program that never answers, in plain words, and leaves no process", async () => {
    await threads.closeAll();
    build({ profile: silent(), startTimeoutMs: 400 });
    const started = Date.now();
    const turn = await run([user("hello")]);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(turn.error).toBe(
      "Fake Agent did not answer within 1 second. Check that 'node -e setInterval(() => {}, 1e9)' starts its Agent Client Protocol mode.",
    );
    expect(threads.pids()).toEqual([]);
    // Nothing waits on it: the next message tries again.
    const again = await run([user("hello")]);
    expect(again.error).toMatch(/did not answer/);
  });

  it("stop while it starts ends the run cancelled and stops the process", async () => {
    await threads.closeAll();
    build({ profile: silent() });
    const pending = run([user("hello")], { stopAfterMs: 400 });
    const pid = await waitForPid();
    const turn = await pending;
    expect(turn.error).toBeUndefined();
    expect(turn.events.at(-1)?.type).toBe("RUN_FINISHED");
    expect(await gone(pid)).toBe(true);
    expect(threads.pids()).toEqual([]);
  });

  it("closeAll and close reach a process that is still starting, and keep nothing of it", async () => {
    await threads.closeAll();
    build({ profile: silent() });
    const pending = run([user("hello")]);
    const pid = await waitForPid();
    await threads.closeAll();
    const turn = await pending;
    expect(turn.error).toBe("Fake Agent was stopped before it was ready.");
    expect(await gone(pid)).toBe(true);

    // A conversation deleted while its process starts: the session is never written back.
    let opened: (value: { handle: string; resumed: boolean }) => void = () => {};
    let closed = 0;
    const stub: HarnessBackend = {
      start: () => new Promise((resolve) => (opened = resolve)),
      prompt: async () => ({ stopReason: "end_turn" }),
      cancel: async () => {},
      close: async () => {
        closed += 1;
      },
      pid: undefined,
    };
    const stubbed = new HarnessThreads({
      profile: profile(),
      agentId: "fake",
      workspace,
      store,
      backend: () => stub,
    });
    const starting = stubbed.thread("thr_deleted");
    await new Promise((r) => setTimeout(r, 20));
    await stubbed.close("thr_deleted", true);
    opened({ handle: "sess_late", resumed: false });
    await expect(starting).rejects.toBeInstanceOf(HarnessStartStopped);
    expect(store.get("thr_deleted", "fake")).toBeUndefined();
    expect(stubbed.running("thr_deleted")).toBeUndefined();
    expect(closed).toBeGreaterThan(0);
  });

  it("stops what the agent started too, not only the agent", async () => {
    const turn = await run([user("spawn")]);
    expect(turn.text).toBe("Started a helper.");
    const helperPid = log().find((e) => e.event === "spawned")?.helperPid as number;
    expect(alive(helperPid)).toBe(true);
    const [pid] = threads.pids();
    await threads.close("thr_1");
    expect(await gone(pid!)).toBe(true);
    expect(await gone(helperPid)).toBe(true);
  });

  it("says why it stopped, in the tool's own last words, with keys masked", async () => {
    const turn = await run([user("crash")]);
    expect(turn.error).toBe(
      "Fake Agent stopped (exit code 3): Error: you are not signed in (key •••• expired). Run `crashy login` first.",
    );
    expect(JSON.stringify(turn.events)).not.toContain("sk-proj-");
    expect(threads.pids()).toEqual([]);
  });

  it("does not count a process killed by a signal as running", async () => {
    const events = { update: () => {}, permission: async () => "cancelled" as const, exited: () => {} };
    const backend = new AcpBackend({ profile: profile(), cwd: root, events, env: process.env });
    await backend.start({});
    const pid = backend.pid!;
    process.kill(pid, "SIGKILL");
    expect(await gone(pid)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(backend.pid).toBeUndefined();
    await backend.close();
  });
});

/** The pid of the process the current threads are starting, once it has one. */
async function waitForPid(): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const [pid] = threads.pids();
    if (pid) return pid;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no process started");
}
