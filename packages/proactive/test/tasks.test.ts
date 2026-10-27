import type { Approval, ApprovalStatus } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { ProactiveError } from "../src/errors.ts";
import { TASK_STATES } from "../src/tasks.ts";
import { setup } from "./helpers.ts";

function approval(id: string, threadId: string, status: ApprovalStatus): Approval {
  return {
    id,
    toolCallId: `call_${id}`,
    runId: "run_1",
    threadId,
    agentId: "steward",
    status,
    summary: "Send an email to sam@example.com",
    tool: { name: "mail_send", kind: "send", surface: "mail", source: "builtin" },
    args: {},
    target: {},
    decision: { effect: "ask", reason: "Sending asks first.", findings: [] },
    canAlways: true,
    createdAt: "2026-10-22T08:00:00Z",
    expiresAt: "2026-10-23T08:00:00Z",
  };
}

describe("tasks", () => {
  it("creates with a sensible state for each source, and announces every change", () => {
    const { tasks, bus } = setup();
    const fromTriage = tasks.create({ title: "Answer Ana", detail: "Ship date.", source: "triage" });
    const fromChat = tasks.create({ title: "Draft the price list", detail: "", source: "chat" });
    const fromSuggestion = tasks.create({ title: "Reply to Leah", detail: "", source: "suggestion" });
    expect([fromTriage.state, fromChat.state, fromSuggestion.state]).toEqual([
      "needs_you",
      "working",
      "suggested",
    ]);
    expect(fromTriage.id).toMatch(/^tsk_/);
    const updated = tasks.update(fromChat.id, { state: "ready_for_review", nextStep: "Read the draft." });
    expect(updated).toMatchObject({ state: "ready_for_review", nextStep: "Read the draft." });
    expect(bus.of("task.updated").map((e) => e.taskId)).toEqual([
      fromTriage.id,
      fromChat.id,
      fromSuggestion.id,
      fromChat.id,
    ]);
  });

  it("refuses an empty title, an unknown state, and a task that is not there", () => {
    const { tasks } = setup();
    expect(() => tasks.create({ title: " ", detail: "", source: "person" })).toThrow("A task needs a title.");
    const task = tasks.create({ title: "Something", detail: "", source: "person" });
    expect(() => tasks.update(task.id, { state: "done" as never })).toThrow(ProactiveError);
    let missing: unknown;
    try {
      tasks.update("tsk_nope", { state: "resolved" });
    } catch (error) {
      missing = error;
    }
    expect(missing).toMatchObject({ code: "not_found", status: 404, message: "Couldn't find that task." });
  });

  it("lists newest change first, filters by state, leaves hidden ones out unless asked, and counts them all", () => {
    const { tasks, clock } = setup();
    const a = tasks.create({ title: "A", detail: "", source: "chat" });
    clock.advance(1000);
    const b = tasks.create({ title: "B", detail: "", source: "suggestion" });
    clock.advance(1000);
    const c = tasks.create({ title: "C", detail: "", source: "suggestion" });
    clock.advance(1000);
    tasks.update(a.id, { state: "resolved" });
    tasks.update(c.id, { state: "hidden" });

    expect(tasks.list().map((t) => t.title)).toEqual(["A", "B"]);
    expect(tasks.list({ state: "hidden" }).map((t) => t.id)).toEqual([c.id]);
    expect(tasks.list({ state: ["suggested", "resolved"] }).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(tasks.list({ limit: 1 }).map((t) => t.id)).toEqual([a.id]);

    const counts = tasks.counts();
    expect(Object.keys(counts).sort()).toEqual([...TASK_STATES].sort());
    expect(counts).toMatchObject({ resolved: 1, suggested: 1, hidden: 1, working: 0, needs_you: 0 });
  });

  it("finds the task for a conversation, and clears a field when given undefined", () => {
    const { tasks } = setup();
    const task = tasks.create({
      title: "Book the van",
      detail: "",
      source: "chat",
      threadId: "thr_1",
      nextStep: "Find a time.",
    });
    expect(tasks.byThread("thr_1")?.id).toBe(task.id);
    expect(tasks.byThread("thr_2")).toBeUndefined();
    const cleared = tasks.update(task.id, {
      title: undefined,
      state: undefined,
      nextStep: undefined,
      error: "The site was down.",
    });
    expect(cleared.state).toBe("working");
    expect(cleared.nextStep).toBeUndefined();
    expect(cleared.error).toBe("The site was down.");
    expect(tasks.get(task.id)?.title).toBe("Book the van");
  });

  it("reads a task waiting on a pending approval as needs you, whatever was stored", () => {
    const statuses = new Map<string, ApprovalStatus>([["apr_1", "pending"]]);
    const { tasks } = setup({
      approvals: { get: (id) => (statuses.has(id) ? { status: statuses.get(id)! } : undefined) },
    });
    const task = tasks.create({
      title: "Send the invoice",
      detail: "",
      source: "chat",
      state: "working",
      approvalId: "apr_1",
    });
    expect(task.state).toBe("needs_you");
    expect(tasks.list({ state: "needs_you" }).map((t) => t.id)).toEqual([task.id]);
    expect(tasks.counts()).toMatchObject({ needs_you: 1, working: 0 });

    statuses.set("apr_1", "allowed");
    expect(tasks.get(task.id)?.state).toBe("working");
    expect(tasks.counts()).toMatchObject({ needs_you: 0, working: 1 });

    statuses.set("apr_1", "pending");
    tasks.update(task.id, { state: "hidden" });
    expect(tasks.get(task.id)?.state).toBe("hidden");
  });

  it("links a task to an approval raised in its conversation, from the bus", () => {
    const { tasks, bus } = setup();
    const task = tasks.create({ title: "Reply to Ana", detail: "", source: "chat", threadId: "thr_9" });
    bus.events.length = 0;

    bus.emit({ type: "approval.created", approval: approval("apr_9", "thr_9", "pending") });
    expect(tasks.get(task.id)).toMatchObject({ approvalId: "apr_9", state: "needs_you" });
    expect(bus.of("task.updated").map((e) => e.taskId)).toEqual([task.id]);

    bus.emit({ type: "approval.decided", approval: approval("apr_9", "thr_9", "refused") });
    expect(tasks.get(task.id)?.state).toBe("working");
    expect(bus.of("task.updated")).toHaveLength(2);

    // An approval in a conversation with no task changes nothing.
    bus.emit({ type: "approval.created", approval: approval("apr_10", "thr_other", "pending") });
    expect(bus.of("task.updated")).toHaveLength(2);
  });
});
