import { toolInfo } from "@steward/gateway";
import type { Approval, ConversationAllow, GateCall, ThreadSummary } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missingPackages } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const missing = await missingPackages();

describe.runIf(missing.length === 0)("the conversation list over HTTP", () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    await t?.close();
  });

  it("renames a conversation, and the new name stays", async () => {
    const made = await t.api<ThreadSummary>("/api/threads", { method: "POST", json: {} });
    expect(made.body.title).toBe("New conversation");
    const renamed = await t.api<ThreadSummary>(`/api/threads/${made.body.id}`, {
      method: "PATCH",
      json: { title: "  Trip to Lisbon  " },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: made.body.id, title: "Trip to Lisbon", kind: "chat" });
    const listed = (await t.api<ThreadSummary[]>("/api/threads")).body.find((x) => x.id === made.body.id);
    expect(listed?.title).toBe("Trip to Lisbon");
  });

  it("refuses an empty name, and a conversation that isn't there", async () => {
    const made = await t.api<ThreadSummary>("/api/threads", { method: "POST", json: { title: "Kept" } });
    const empty = await t.api<{ error: string }>(`/api/threads/${made.body.id}`, {
      method: "PATCH",
      json: { title: "   " },
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/name/);
    expect((await t.api<ThreadSummary>(`/api/threads/${made.body.id}`)).body.title).toBe("Kept");
    const ghost = await t.api("/api/threads/thr_nobody", { method: "PATCH", json: { title: "X" } });
    expect(ghost.status).toBe(404);
  });

  /** Asks to put an event on the calendar in this conversation, as the person's own run would. */
  async function askInThread(threadId: string, title: string): Promise<Approval> {
    const call: GateCall = {
      toolCallId: `call_${title}`,
      runId: "run_1",
      threadId,
      agentId: "steward",
      actorId: "local",
      initiator: { kind: "person", id: "local" },
      tool: toolInfo("calendar_create"),
      args: { title, start: "2026-11-11T09:00:00Z", end: "2026-11-11T10:00:00Z" },
      target: {},
      tainted: false,
    };
    const outcome = await t.server.services.gateway.governance.execute(call, async () => null);
    if (outcome.status !== "parked") throw new Error(`expected an ask, got ${outcome.status}`);
    return outcome.approval;
  }

  it("lists what was allowed for one conversation, turns it off, and deletes it with the conversation", async () => {
    const made = await t.api<ThreadSummary>("/api/threads", { method: "POST", json: {} });
    const id = made.body.id;
    const first = await askInThread(id, "Dentist");
    expect(first.canConversation).toBe(true);
    const answered = await t.api<Approval>(`/api/approvals/${first.id}/decision`, {
      method: "POST",
      json: { answer: "conversation" },
    });
    expect(answered.body).toMatchObject({ status: "allowed", answer: "conversation" });

    const listed = await t.api<ConversationAllow[]>(`/api/threads/${id}/allows`);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ threadId: id, approvalId: first.id });

    // Turned off from the conversation: Steward asks again.
    const allowId = listed.body[0]?.id ?? "";
    expect((await t.api(`/api/threads/other/allows/${allowId}`, { method: "DELETE" })).status).toBe(404);
    expect((await t.api(`/api/threads/${id}/allows/${allowId}`, { method: "DELETE" })).body).toEqual({
      ok: true,
    });
    expect((await t.api<ConversationAllow[]>(`/api/threads/${id}/allows`)).body).toEqual([]);

    // Allowed again, then the conversation is deleted: the allow goes with it.
    const second = await askInThread(id, "Dentist again");
    await t.api(`/api/approvals/${second.id}/decision`, { method: "POST", json: { answer: "conversation" } });
    expect(t.server.services.gateway.conversationAllows.forThread(id)).toHaveLength(1);
    expect((await t.api(`/api/threads/${id}`, { method: "DELETE" })).body).toEqual({ ok: true });
    expect(t.server.services.gateway.conversationAllows.forThread(id)).toEqual([]);
    expect((await t.api(`/api/threads/${id}/allows`)).status).toBe(404);
  });

  it("refuses Allow in this conversation for a routine's ask", async () => {
    const made = await t.api<ThreadSummary>("/api/threads", { method: "POST", json: {} });
    const routine = await t.server.services.gateway.governance.execute(
      {
        toolCallId: "call_routine",
        runId: "run_2",
        threadId: made.body.id,
        agentId: "steward",
        actorId: "local",
        initiator: { kind: "routine", id: "rtn_1" },
        tool: toolInfo("calendar_create"),
        args: { title: "From a routine", start: "2026-11-11T09:00:00Z", end: "2026-11-11T10:00:00Z" },
        target: {},
        tainted: false,
      },
      async () => null,
    );
    if (routine.status !== "parked") throw new Error("expected an ask");
    expect(routine.approval.canConversation).toBe(false);
    const refused = await t.api<{ error: string }>(`/api/approvals/${routine.approval.id}/decision`, {
      method: "POST",
      json: { answer: "conversation" },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/isn't offered/);
  });
});
