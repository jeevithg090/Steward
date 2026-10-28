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
import { HarnessThreads } from "../src/session.ts";
import { HarnessSessionStore, migrations } from "../src/store.ts";

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

function build(opts: { idleMs?: number } = {}) {
  threads = new HarnessThreads({
    profile: profile(),
    agentId: "fake",
    workspace,
    store,
    audit: gateway.audit,
    actorId: "local",
    ...(opts.idleMs ? { idleMs: opts.idleMs } : {}),
    backend: ({ cwd, events }) =>
      new AcpBackend({
        profile: profile(),
        cwd,
        events,
        env: { ...process.env, OPENROUTER_API_KEY: "sk-or-must-not-leak" },
      }),
  });
  agent = new HarnessAgent({
    agentId: "fake",
    title: "A fake ACP agent",
    harness: profile(),
    threads,
    governance: gateway.governance,
    approvals: gateway.approvals,
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
  opts: { resume?: ResumeEntry[]; threadId?: string; stopAfter?: (e: BaseEvent) => boolean } = {},
): Promise<Turn> {
  const clone = agent.clone();
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

  it("answers Always allow with allow_always, only where Steward offers it", async () => {
    const first = await run([user("edit")]);
    const interrupt = interruptOf(first);
    const meta = interrupt.metadata as unknown as ApprovalInterruptMetadata;
    // A change outside the workspace asks, even though writes in it run.
    expect(meta.tool).toMatchObject({ kind: "write", surface: "system" });
    expect(meta.summary).toBe("Use harness_edit on /etc/hosts");
    expect(meta.canAlways).toBe(true);
    gateway.approvals.decide(meta.approvalId, "always", "local");
    await run(first.messages, { resume: [{ interruptId: interrupt.id, status: "resolved" }] });
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_edit",
      outcome: { outcome: "selected", optionId: "always" },
    });
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
    expect(turn.error).toMatch(/Fake Agent could not be started/);
  });
});
