import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseEvent, Message, RunAgentInput, RunFinishedEvent } from "@ag-ui/client";
import { type ChatCompletionRequest, type FixtureResponse, LLMock } from "@copilotkit/aimock";
import type { Approval, ApprovalInterruptMetadata, AuditPage, ThreadSummary } from "@steward/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { missingPackages, parseSse, waitFor } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const FAKE_CODEX = fileURLToPath(
  new URL("../../../packages/harnesses/test/fixtures/fake-codex-app-server.mjs", import.meta.url),
);

const missing = await missingPackages();
if (missing.length > 0) it.todo(`delegation end to end (waiting for ${missing.join(", ")})`);

/** What the scripted parent and helper models say, by who is asking and what came before. */
type Script = (req: ChatCompletionRequest, who: "parent" | "helper") => FixtureResponse;

describe.runIf(missing.length === 0)("handing a task to another agent, end to end", () => {
  let t: TestServer;
  let llm: LLMock;
  let script: Script;
  let codexLog = "";
  const seen: { who: "parent" | "helper"; req: ChatCompletionRequest }[] = [];

  beforeAll(async () => {
    llm = new LLMock({ port: 0, host: "127.0.0.1", logLevel: "silent" });
    const url = await llm.start();
    llm.on({ predicate: () => true }, (req) => {
      const system = req.messages
        .filter((m) => m.role === "system")
        .map((m) => String(m.content))
        .join("\n");
      const who = system.includes("You are the helper.") ? "helper" : "parent";
      seen.push({ who, req });
      return script(req, who);
    });
    t = await startTestServer(
      {
        STEWARD_MODEL_PROVIDER: "openai-compatible",
        STEWARD_MODEL_BASE_URL: `${url}/v1`,
        STEWARD_MODEL: "test-model",
      },
      {},
      ({ tenantDir, root }) => {
        codexLog = join(root, "codex.jsonl");
        writeFileSync(
          join(tenantDir, "agents.yaml"),
          [
            "agents:",
            "  - id: steward",
            "    name: Steward",
            "    instructions: You are the parent.",
            "  - id: helper",
            "    name: Helper",
            "    title: Summarises things",
            "    instructions: You are the helper.",
          ].join("\n"),
        );
        writeFileSync(
          join(tenantDir, "harnesses.yaml"),
          [
            "harnesses:",
            "  - id: codex",
            "    name: Codex",
            "    title: OpenAI's coding agent",
            "    kind: codex",
            `    command: ${JSON.stringify(process.execPath)}`,
            `    args: [${JSON.stringify(FAKE_CODEX)}]`,
            `    env: { FAKE_CODEX_LOG: ${JSON.stringify(codexLog)} }`,
            "    signIn: vendor-tool",
          ].join("\n"),
        );
      },
    );
  });
  afterAll(async () => {
    await t?.close();
    await llm?.stop();
  });
  beforeEach(() => {
    seen.length = 0;
  });

  const user = (content: string): Message => ({ id: randomUUID(), role: "user", content });
  const lastText = (req: ChatCompletionRequest) => String(req.messages.at(-1)?.content ?? "");
  const lastIsTool = (req: ChatCompletionRequest) => req.messages.at(-1)?.role === "tool";
  const delegate = (agentId: string, task: string, n = 1): FixtureResponse => ({
    toolCalls: Array.from({ length: n }, () => ({
      name: "delegate_task",
      arguments: JSON.stringify({ agentId, task }),
    })),
  });
  const finished = (events: BaseEvent[]) =>
    events.findLast((e) => e.type === "RUN_FINISHED") as RunFinishedEvent;
  const ofType = (events: BaseEvent[], type: string) =>
    events.filter((e) => e.type === type) as (BaseEvent & Record<string, unknown>)[];
  const answers = () =>
    existsSync(codexLog)
      ? readFileSync(codexLog, "utf8")
          .trim()
          .split("\n")
          .map((l) => (JSON.parse(l) as { received: Record<string, unknown> }).received)
          .filter((m) => m.method === undefined && m.result !== undefined)
      : [];

  async function run(input: Partial<RunAgentInput> & { threadId: string; messages: Message[] }) {
    const res = await fetch(`${t.base}/api/copilotkit/agent/steward/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        runId: randomUUID(),
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
        ...input,
      }),
    });
    expect(res.status).toBe(200);
    return parseSse(await res.text());
  }

  /** The parent hands "run the tests" to Codex; Codex's command waits for the person. */
  function codexScript(): Script {
    return (req) => {
      if (lastIsTool(req)) {
        const result = String(req.messages.at(-1)?.content ?? "");
        return {
          content: result.includes("All tests pass.")
            ? "Codex says all tests pass."
            : "Codex could not do it.",
        };
      }
      return delegate("codex", "run the tests");
    };
  }

  async function parkedOnCodex(threadId: string) {
    script = codexScript();
    const ask = user("Ask Codex to run the tests");
    const events = await run({ threadId, messages: [ask] });
    const outcome = finished(events).outcome;
    expect(outcome?.type).toBe("interrupt");
    const interrupt = outcome?.type === "interrupt" ? outcome.interrupts[0]! : undefined!;
    return { events, interrupt, ask, meta: interrupt.metadata as unknown as ApprovalInterruptMetadata };
  }

  it("offers delegate_task with the other agents, and never to a child", async () => {
    script = (req, who) =>
      who === "helper"
        ? { content: "Helper summary." }
        : lastIsTool(req)
          ? { content: "Done." }
          : delegate("helper", "Summarise the plan");
    await run({ threadId: randomUUID(), messages: [user("Get the helper to summarise the plan")] });
    const parent = seen.find((s) => s.who === "parent")!.req;
    const tool = parent.tools?.find((t) => t.function.name === "delegate_task");
    const parameters = tool?.function.parameters as
      | { properties?: { agentId?: { enum?: string[] } } }
      | undefined;
    expect(parameters?.properties?.agentId?.enum).toEqual(["helper", "codex"]);
    const helper = seen.find((s) => s.who === "helper")!.req;
    expect(lastText(helper)).toBe("Summarise the plan");
    // Depth 1: the child cannot hand the task on again.
    expect(helper.tools?.some((t) => t.function.name === "delegate_task")).toBe(false);
    // The parent reads the child's answer as untrusted words, with Happy's wording.
    const result = String(
      seen
        .filter((s) => s.who === "parent")
        .at(-1)!
        .req.messages.at(-1)?.content,
    );
    expect(result).toContain("Helper finished working. Its answer follows, verbatim.");
    expect(result).toContain("Helper summary.");
    expect(result).toContain("untrusted");
  });

  it("a child's approval interrupts the parent; the answer resumes the child, then the parent", async () => {
    const threadId = randomUUID();
    const { events, interrupt, meta, ask } = await parkedOnCodex(threadId);
    const started = ofType(events, "SUBAGENT_STARTED")[0];
    expect(started).toMatchObject({ name: "Codex", description: "run the tests" });
    const subagentRunId = started?.subagentRunId as string;
    expect(interrupt.subagentRunId).toBe(subagentRunId);
    expect(meta).toMatchObject({
      summary: "Run a command: npm test",
      askedBy: { agentId: "codex", name: "Codex", subagentRunId },
    });
    // The child's work is in the parent's stream, tagged as the child's.
    expect(
      ofType(events, "TOOL_CALL_START").some(
        (e) => e.subagentRunId === subagentRunId && e.toolCallId === interrupt.toolCallId,
      ),
    ).toBe(true);
    expect(ofType(events, "SUBAGENT_FINISHED")[0]).toMatchObject({
      subagentRunId,
      outcome: { type: "suspended", interruptIds: [interrupt.id] },
    });
    const approval = (await t.api<Approval>(`/api/approvals/${meta.approvalId}`)).body;
    expect(approval).toMatchObject({ status: "pending", agentId: "codex" });

    await t.api(`/api/approvals/${meta.approvalId}/decision`, { method: "POST", json: { answer: "once" } });
    seen.length = 0;
    const resumed = await run({
      threadId,
      // The browser sends the conversation it has; the server fills in what only it saw.
      messages: [ask],
      resume: [{ interruptId: interrupt.id, status: "resolved", payload: { answer: "once" } }],
    });
    expect(finished(resumed).outcome).toBeUndefined();
    expect(answers().at(-1)?.result).toEqual({ decision: "accept" });
    expect(ofType(resumed, "SUBAGENT_FINISHED").at(-1)).toMatchObject({
      subagentRunId,
      result: "All tests pass.",
    });
    const childText = ofType(resumed, "TEXT_MESSAGE_CONTENT")
      .filter((e) => e.subagentRunId === subagentRunId)
      .map((e) => e.delta)
      .join("");
    expect(childText).toBe("All tests pass.");
    const parentText = ofType(resumed, "TEXT_MESSAGE_CONTENT")
      .filter((e) => !e.subagentRunId)
      .map((e) => e.delta)
      .join("");
    expect(parentText).toBe("Codex says all tests pass.");
    // The parent's model saw its own call and its result, never the child's messages.
    const req = seen.find((s) => s.who === "parent")!.req;
    expect(req.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);

    // The child's conversation is not in the list; the record says a task was handed on and finished.
    const threads = (await t.api<ThreadSummary[]>("/api/threads")).body;
    expect(threads.some((th) => th.id.startsWith("sub_"))).toBe(false);
    const record = (await t.api<AuditPage>("/api/audit?type=delegation.started,delegation.finished")).body
      .events;
    expect(
      record
        .filter((e) => e.threadId === threadId)
        .map((e) => e.type)
        .sort(),
    ).toEqual(["delegation.finished", "delegation.started"]);
  });

  it("when nobody resumes in the browser, the sweep resumes the parent, which resumes the child", async () => {
    const threadId = randomUUID();
    const { meta } = await parkedOnCodex(threadId);
    await t.api(`/api/approvals/${meta.approvalId}/decision`, { method: "POST", json: { answer: "once" } });
    const runner = t.server.services.runner;
    await waitFor(() => {
      const last = runner.getThreadMessages(threadId).at(-1);
      return last?.role === "assistant" &&
        String(last.content) === "Codex says all tests pass." &&
        !runner.isThreadBusy(threadId)
        ? true
        : undefined;
    }, 20_000);
    expect((await t.api<Approval>(`/api/approvals/${meta.approvalId}`)).body.claimedAt).toBeTruthy();
  });

  it("runs at most two handed-on tasks at once, and says so for the third", async () => {
    script = (req, who) =>
      who === "helper"
        ? { content: "Helper summary." }
        : lastIsTool(req)
          ? { content: "Done." }
          : delegate("helper", "Summarise", 3);
    const events = await run({ threadId: randomUUID(), messages: [user("Three summaries, please")] });
    const parentResults = ofType(events, "TOOL_CALL_RESULT")
      .filter((e) => !e.subagentRunId)
      .map((e) => String(e.content));
    expect(parentResults).toHaveLength(3);
    expect(parentResults.filter((c) => c.includes("Helper finished working"))).toHaveLength(2);
    expect(parentResults.filter((c) => c.includes("At most 2 handed-on tasks can run at once"))).toHaveLength(
      1,
    );
  });

  it("stop stops the child too", async () => {
    script = (req) => (lastIsTool(req) ? { content: "Stopped." } : delegate("codex", "wait"));
    const threadId = randomUUID();
    const runner = t.server.services.runner;
    const pending = run({ threadId, messages: [user("Ask Codex to wait")] });
    const child = await waitFor(() => {
      const record = t.server.services.delegations.childrenOf(threadId)[0];
      return record && runner.isThreadBusy(record.childThreadId) ? record : undefined;
    }, 10_000);
    await new Promise((r) => setTimeout(r, 300));
    await runner.stop({ threadId });
    const events = await pending;
    expect(ofType(events, "SUBAGENT_ERROR")[0]).toMatchObject({ code: "cancelled" });
    await waitFor(() => !runner.isThreadBusy(child.childThreadId) || undefined, 10_000);
    expect(t.server.services.delegations.get(child.subagentRunId)?.status).toBe("stopped");
  });
});
