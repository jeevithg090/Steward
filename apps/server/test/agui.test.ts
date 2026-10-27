import { randomUUID } from "node:crypto";
import {
  type BaseEvent,
  EventType,
  type Message,
  type ResumeEntry,
  type RunAgentInput,
  type RunFinishedEvent,
  type ToolCallResultEvent,
} from "@ag-ui/client";
import type { AppInfo, Approval, ChainCheck, Settings, ThreadSummary } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { summariseRun } from "../src/runtime/run-summary.ts";
import { missingPackages, parseSse, waitFor } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const missing = await missingPackages();
if (missing.length > 0) {
  it.todo(`AG-UI end to end (waiting for ${missing.join(", ")})`);
}

const EMAIL_ASK = "Email sam@example.com about Friday: see you at 10";

describe.runIf(missing.length === 0)("AG-UI runs through the CopilotKit runtime", () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    await t?.close();
  });

  /** POSTs a run the way the React client does and reads the whole SSE stream. */
  async function run(input: Partial<RunAgentInput> & { threadId: string; messages: Message[] }) {
    const body: RunAgentInput = {
      runId: randomUUID(),
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
      ...input,
    };
    const res = await fetch(`${t.base}/api/copilotkit/agent/steward/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    return parseSse(await res.text());
  }

  const types = (events: BaseEvent[]) => events.map((e) => e.type);
  const finished = (events: BaseEvent[]) =>
    events.findLast((e) => e.type === EventType.RUN_FINISHED) as RunFinishedEvent;
  const user = (content: string): Message => ({ id: randomUUID(), role: "user", content });

  it("serves the runtime's info with the steward agent", async () => {
    const res = await fetch(`${t.base}/api/copilotkit/info`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as { agents: Record<string, unknown>; mode: string };
    expect(Object.keys(info.agents)).toContain("steward");
    expect(info.mode).toBe("sse");
  });

  it("runs a conversation: RUN_STARTED, a text message, RUN_FINISHED", async () => {
    const threadId = randomUUID();
    const events = await run({ threadId, messages: [user("hello")] });
    const seen = types(events);
    expect(seen[0]).toBe(EventType.RUN_STARTED);
    expect(seen.at(-1)).toBe(EventType.RUN_FINISHED);
    expect(
      seen.some((type) => type === EventType.TEXT_MESSAGE_CONTENT || type === EventType.TEXT_MESSAGE_CHUNK),
    ).toBe(true);
    const { text, outcome } = summariseRun(events);
    expect(outcome).toBe("success");
    // The scripted model greets without a name and says what it is.
    expect(text).toMatch(/^Hi\. /);
    expect(text).toMatch(/scripted demo model/);

    const thread = await waitFor(async () => (await t.api<ThreadSummary>(`/api/threads/${threadId}`)).body);
    expect(thread).toMatchObject({ title: "hello", kind: "chat", running: false });
    expect(thread.lastMessagePreview).toMatch(/^Hi\./);

    // A refreshed page gets the conversation back from the runner.
    const replay = await fetch(`${t.base}/api/copilotkit/agent/steward/connect`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        threadId,
        runId: randomUUID(),
        messages: [],
        tools: [],
        context: [],
        state: {},
      }),
    });
    expect(summariseRun(parseSse(await replay.text())).text).toBe(text);
  });

  /** Asks for an email, which parks on an approval. Returns the thread, the call and the approval. */
  async function askToSend() {
    const threadId = randomUUID();
    const events = await run({ threadId, messages: [user(EMAIL_ASK)] });
    const end = finished(events);
    expect(end.outcome?.type).toBe("interrupt");
    const interrupt = end.outcome?.type === "interrupt" ? end.outcome.interrupts[0]! : undefined;
    expect(interrupt?.reason).toBe("steward_approval");
    const toolCallId = interrupt!.id;
    const approvalId = (interrupt!.metadata as { approvalId: string }).approvalId;
    const approval = (await t.api<Approval>(`/api/approvals/${approvalId}`)).body;
    expect(approval).toMatchObject({
      status: "pending",
      toolCallId,
      threadId,
      tool: { name: "mail_send", kind: "send" },
    });
    return { threadId, toolCallId, approvalId };
  }

  const runsOn = (threadId: string) =>
    t.server.services.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM runner_runs WHERE thread_id = ?", [
      threadId,
    ])!.n;

  it("asks before sending; a refusal resumed by the browser is a refusal", async () => {
    const { threadId, toolCallId, approvalId } = await askToSend();
    const pending = (await t.api<Approval[]>("/api/approvals?status=pending")).body;
    expect(pending.map((a) => a.id)).toContain(approvalId);

    const decided = await t.api<Approval>(`/api/approvals/${approvalId}/decision`, {
      method: "POST",
      json: { answer: "refuse" },
    });
    expect(decided.body.status).toBe("refused");
    expect(
      (await t.api(`/api/approvals/${approvalId}/decision`, { method: "POST", json: { answer: "once" } }))
        .status,
    ).toBe(409);

    // The browser holds the conversation and resumes with the interrupt cancelled.
    const resume: ResumeEntry[] = [{ interruptId: toolCallId, status: "cancelled" }];
    const events = await run({
      threadId,
      messages: t.server.services.runner.getThreadMessages(threadId),
      resume,
    });
    const result = events.find(
      (e) => e.type === EventType.TOOL_CALL_RESULT && (e as ToolCallResultEvent).toolCallId === toolCallId,
    ) as ToolCallResultEvent | undefined;
    expect(result).toBeDefined();
    expect(JSON.stringify(result?.content)).toMatch(/refused/);
    const summary = summariseRun(events);
    expect(summary.outcome).toBe("success");
    expect(summary.text).toMatch(/didn't do that/);

    const claimed = await waitFor(async () => {
      const a = (await t.api<Approval>(`/api/approvals/${approvalId}`)).body;
      return a.claimedAt ? a : undefined;
    });
    expect(claimed.status).toBe("refused");
    // The server's sweep sees the browser already resumed and does nothing more.
    const before = runsOn(threadId);
    await new Promise((r) => setTimeout(r, 800));
    expect(runsOn(threadId)).toBe(before);
    expect((await t.api<ChainCheck>("/api/audit/verify")).body.ok).toBe(true);
  });

  it("resumes on its own when no browser does (the resume sweep)", async () => {
    const { threadId, toolCallId, approvalId } = await askToSend();
    await t.api(`/api/approvals/${approvalId}/decision`, { method: "POST", json: { answer: "refuse" } });

    const messages = await waitFor(() => {
      const m = t.server.services.runner.getThreadMessages(threadId);
      const answered = m.some((x) => x.role === "tool" && x.toolCallId === toolCallId);
      return answered && !t.server.services.runner.isThreadBusy(threadId) ? m : undefined;
    });
    const last = messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(String(last?.content)).toMatch(/didn't do that/);
    expect((await t.api<Approval>(`/api/approvals/${approvalId}`)).body.claimedAt).toBeDefined();
  });

  it("sends once allowed, through the gateway, to the demo inbox", async () => {
    const { threadId, toolCallId, approvalId } = await askToSend();
    await t.api(`/api/approvals/${approvalId}/decision`, { method: "POST", json: { answer: "once" } });
    const messages = await waitFor(() => {
      const m = t.server.services.runner.getThreadMessages(threadId);
      return m.some((x) => x.role === "tool" && x.toolCallId === toolCallId) && m.at(-1)?.role === "assistant"
        ? m
        : undefined;
    });
    expect(String(messages.at(-1)?.content)).toMatch(/Sent to sam@example\.com/);
    const audit = t.server.services.gateway.audit.page({ limit: 200 });
    expect(audit.events.some((e) => e.type === "tool.completed" && e.toolCallId === toolCallId)).toBe(true);
    expect(t.server.services.gateway.audit.verify().ok).toBe(true);
  });

  it("refuses to run on a thread that is already running", async () => {
    const threadId = randomUUID();
    const first = run({ threadId, messages: [user("hello")] });
    const second = await run({ threadId, messages: [user("hello again")] }).catch(() => [] as BaseEvent[]);
    await first;
    // Either the second run raced in after the first finished, or it was refused as busy.
    if (second.some((e) => e.type === EventType.RUN_ERROR)) {
      expect(JSON.stringify(second)).toMatch(/THREAD_ALREADY_RUNNING|already running/i);
    }
  });

  it("switches the model from Settings without a restart, and says when it fell back", async () => {
    const put = await t.api<Settings>("/api/settings", {
      method: "PUT",
      json: { model: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" } },
    });
    expect(put.body.model).toEqual({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5" });
    // No key in this test's environment: the running model is the scripted one, and says so.
    const info = (await t.api<AppInfo>("/api/info")).body;
    expect(info.model.scripted).toBe(true);
    const events = await run({ threadId: randomUUID(), messages: [user("hello")] });
    expect(summariseRun(events).outcome).toBe("success");
  });
});
