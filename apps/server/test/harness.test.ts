import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseEvent, Message, RunAgentInput, RunFinishedEvent } from "@ag-ui/client";
import type {
  AgentsResponse,
  Approval,
  ApprovalInterruptMetadata,
  AuditPage,
  HarnessInfo,
} from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missingPackages, parseSse, waitFor } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const FIXTURE = fileURLToPath(
  new URL("../../../packages/harnesses/test/fixtures/fake-acp-agent.mjs", import.meta.url),
);

const missing = await missingPackages();
if (missing.length > 0) it.todo(`harness agents end to end (waiting for ${missing.join(", ")})`);

describe.runIf(missing.length === 0)("an external coding agent, end to end over HTTP", () => {
  let t: TestServer;
  let logFile = "";

  beforeAll(async () => {
    t = await startTestServer({}, {}, ({ tenantDir, root }) => {
      logFile = join(root, "fake-acp.jsonl");
      writeFileSync(
        join(tenantDir, "harnesses.yaml"),
        [
          "harnesses:",
          "  - id: fake",
          "    name: Fake Agent",
          "    title: A fake coding agent",
          "    kind: acp",
          `    command: ${JSON.stringify(process.execPath)}`,
          `    args: [${JSON.stringify(FIXTURE)}]`,
          `    env: { FAKE_ACP_LOG: ${JSON.stringify(logFile)} }`,
          "    signIn: vendor-tool",
          "  - id: not-here",
          "    name: Not Here",
          "    kind: acp",
          "    command: steward-no-such-coding-agent",
          "    signIn: vendor-tool",
        ].join("\n"),
      );
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  const user = (content: string): Message => ({ id: randomUUID(), role: "user", content });
  const finished = (events: BaseEvent[]) =>
    events.findLast((e) => e.type === "RUN_FINISHED") as RunFinishedEvent;
  const text = (events: BaseEvent[]) =>
    events
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => (e as unknown as { delta: string }).delta)
      .join("");
  const permissions = () =>
    existsSync(logFile)
      ? readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as Record<string, unknown>)
          .filter((e) => e.event === "permission")
      : [];

  async function run(input: Partial<RunAgentInput> & { threadId: string; messages: Message[] }) {
    const res = await fetch(`${t.base}/api/copilotkit/agent/fake/run`, {
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

  /** Starts a "work" turn: the project edit is allowed by a rule, the test run parks. */
  async function parkedWork(threadId: string) {
    const events = await run({ threadId, messages: [user("work")] });
    const outcome = finished(events).outcome;
    expect(outcome?.type).toBe("interrupt");
    const interrupt = outcome?.type === "interrupt" ? outcome.interrupts[0]! : undefined;
    return {
      events,
      interrupt: interrupt!,
      approvalId: (interrupt!.metadata as unknown as ApprovalInterruptMetadata).approvalId,
    };
  }

  it("lists the coding agents with how they sign in, greying out the one not installed", async () => {
    const { body } = await t.api<AgentsResponse>("/api/agents");
    expect(body.agents.find((a) => a.id === "fake")).toMatchObject({
      name: "Fake Agent",
      harness: "fake",
      provider: "harness:fake",
      signIn: "vendor-tool",
      available: true,
      skills: [],
      tools: [],
    });
    expect(body.agents.find((a) => a.id === "not-here")).toMatchObject({
      available: false,
      reason: expect.stringContaining("Not Here is not installed on this computer"),
    });
    const harnesses = (await t.api<HarnessInfo[]>("/api/harnesses")).body;
    expect(harnesses.map((h) => [h.id, h.available])).toEqual([
      ["fake", true],
      ["not-here", false],
    ]);
  });

  it("parks a command for the person and resumes the same turn when the browser answers", async () => {
    await t.api("/api/rules", {
      method: "POST",
      json: {
        name: "The fake agent may work on the project",
        effect: "allow",
        when: 'tool.source == "harness:fake" && startsWith(target.path, "/srv/project/")',
        description: "",
      },
    });
    const threadId = randomUUID();
    const { events, interrupt, approvalId } = await parkedWork(threadId);
    expect(events.some((e) => e.type === "CUSTOM")).toBe(true);
    const pending = (await t.api<Approval>(`/api/approvals/${approvalId}`)).body;
    expect(pending).toMatchObject({ status: "pending", summary: "Run a command: npm test", agentId: "fake" });

    await t.api(`/api/approvals/${approvalId}/decision`, { method: "POST", json: { answer: "once" } });
    const resumed = await run({
      threadId,
      messages: [user("work")],
      resume: [{ interruptId: interrupt.id, status: "resolved", payload: { answer: "once" } }],
    });
    expect(text(resumed)).toBe("All tests pass.");
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_test",
      outcome: { outcome: "selected", optionId: "yes" },
    });
  });

  it("resumes it from the server when nobody resumes in the browser (the sweep)", async () => {
    const threadId = randomUUID();
    const { interrupt, approvalId } = await parkedWork(threadId);
    await t.api(`/api/approvals/${approvalId}/decision`, { method: "POST", json: { answer: "once" } });
    // The sweep finds the parked call in the conversation and resumes it through the runner.
    const runner = t.server.services.runner;
    const messages = await waitFor(() => {
      const m = runner.getThreadMessages(threadId);
      const answered = m.some((x) => x.role === "tool" && x.toolCallId === interrupt.toolCallId);
      return answered && !runner.isThreadBusy(threadId) ? m : undefined;
    }, 15_000).catch(() => {
      throw new Error(`not resumed: ${JSON.stringify(runner.getThreadMessages(threadId)).slice(0, 1500)}`);
    });
    expect(String(messages.at(-1)?.content)).toBe("All tests pass.");
    expect(permissions().at(-1)).toMatchObject({
      toolCallId: "call_test",
      outcome: { outcome: "selected", optionId: "yes" },
    });
    expect((await t.api<Approval>(`/api/approvals/${approvalId}`)).body.claimedAt).toBeTruthy();
  });

  it("stops the conversation's process when the conversation is deleted", async () => {
    const created = await t.api<{ id: string }>("/api/threads", {
      method: "POST",
      json: { agentId: "fake" },
    });
    expect(created.status).toBe(201);
    const threadId = created.body.id;
    await run({ threadId, messages: [user("hello")] });
    const started = (await t.api<AuditPage>(`/api/audit?type=harness.started`)).body.events.find(
      (e) => e.threadId === threadId,
    );
    const pid = started?.detail.pid as number;
    expect(pid).toBeGreaterThan(0);
    expect((await t.api(`/api/threads/${threadId}`, { method: "DELETE" })).status).toBe(200);
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 5_000);
  });

  it("answers with a plain notice when its program is not installed", async () => {
    const res = await fetch(`${t.base}/api/copilotkit/agent/not-here/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: randomUUID(),
        runId: randomUUID(),
        messages: [user("hello")],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      }),
    });
    expect(text(parseSse(await res.text()))).toMatch(
      /^I can't start: Not Here is not installed on this computer/,
    );
  });
});
