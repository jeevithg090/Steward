import type { Approval, InboxWatch, InboxWatchService } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDate } from "../src/util/time.ts";
import { Workers } from "../src/workers/workers.ts";
import { missingPackages, waitFor } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const missing = await missingPackages();
if (missing.length > 0) it.todo(`workers (waiting for ${missing.join(", ")})`);

describe.runIf(missing.length === 0)("background workers", () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    await t?.close();
  });

  /** A Workers instance on the live services, with its own clock. */
  function workersAt(now: Date, watch?: InboxWatchService) {
    const s = t.server.services;
    return new Workers({
      ...(watch ? { watch } : {}),
      routines: s.proactive.routines,
      brief: s.proactive.brief,
      notifications: s.proactive.notifications,
      approvals: s.gateway.approvals,
      sweep: s.sweep,
      runs: s.runs,
      settings: s.settings,
      threads: s.threads,
      now: () => now,
    });
  }

  it("fires due routines on their own thread, framed, and records the run", async () => {
    const { proactive, runner } = t.server.services;
    const routine = proactive.routines.create({
      title: "Daily look",
      prompt: "Tell me what needs me today.",
      schedule: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      agentId: "steward",
    });
    // A minute after its slot: on time, so the firing carries no note about being late.
    const later = new Date(Date.parse(routine.nextRunAt!) + 60_000);
    await workersAt(later).tickRoutines();

    const recorded = await waitFor(() => {
      const r = proactive.routines.get(routine.id);
      return r?.lastStatus ? r : undefined;
    });
    expect(recorded.lastStatus).toBe("ok");
    const messages = runner.getThreadMessages(routine.threadId);
    expect(String(messages[0]?.content)).toMatch(/^One of your routines is firing right now/);
    expect(String(messages[0]?.content)).not.toContain("(Due at");
    expect(messages.at(-1)?.role).toBe("assistant");
    const notes = proactive.notifications.list({ limit: 20 });
    expect(notes.some((n) => n.title === "Daily look ran" && n.href === `/chat/${routine.threadId}`)).toBe(
      true,
    );
    expect((await t.api<{ kind: string }>(`/api/threads/${routine.threadId}`)).body.kind).toBe("routine");
  });

  it("skips a firing while the routine's last run waits for an answer, and says so", async () => {
    const { proactive, runner, gateway } = t.server.services;
    const routine = proactive.routines.create({
      title: "Mail sender",
      prompt: "Send the weekly note.",
      schedule: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      agentId: "steward",
    });
    // The routine's conversation ends with a parked send nobody has answered yet.
    const res = await fetch(`${t.base}/api/copilotkit/agent/steward/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: routine.threadId,
        runId: "parks-a-send",
        messages: [{ id: "u1", role: "user", content: "Email sam@example.com about Friday: see you at 10" }],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      }),
    });
    await res.text();
    expect(gateway.approvals.list({ status: "pending", threadId: routine.threadId })).toHaveLength(1);
    const before = runner.getThreadMessages(routine.threadId);

    await workersAt(new Date(Date.parse(routine.nextRunAt!) + 60_000)).tickRoutines();
    const recorded = await waitFor(() => {
      const r = proactive.routines.get(routine.id);
      return r?.lastStatus ? r : undefined;
    });
    expect(recorded.lastStatus).toBe("skipped");
    expect(recorded.lastError).toMatch(/still waiting for your answer/);
    expect(runner.getThreadMessages(routine.threadId)).toEqual(before);
  });

  it("says when a firing starts well after its slot", async () => {
    const { proactive, runner } = t.server.services;
    const routine = proactive.routines.create({
      title: "Late look",
      prompt: "Tell me what changed.",
      schedule: "30 14 * * *",
      timezone: "UTC",
      enabled: true,
      agentId: "steward",
    });
    // 40 minutes late: inside the grace, so it runs, and says so.
    await workersAt(new Date(Date.parse(routine.nextRunAt!) + 40 * 60_000)).tickRoutines();
    await waitFor(() => proactive.routines.get(routine.id)?.lastStatus);
    const first = String(runner.getThreadMessages(routine.threadId)[0]?.content);
    expect(first).toMatch(/^One of your routines is firing right now/);
    expect(first).toContain("Tell me what changed.\n\n(Due at 14:30; starting at 15:10.)");
  });

  it("records the routine runs the last server died in as failed when it starts", async () => {
    const { proactive } = t.server.services;
    const routine = proactive.routines.create({
      title: "Cut short",
      prompt: "Tidy the workspace.",
      schedule: "45 13 * * *",
      timezone: "UTC",
      enabled: true,
      agentId: "steward",
    });
    // Claimed, and never reported back: the server stopped mid-run.
    const slot = new Date(Date.parse(routine.nextRunAt!) + 1000);
    expect(proactive.routines.due(slot).map((r) => r.id)).toContain(routine.id);
    const workers = workersAt(slot);
    workers.start();
    workers.stop();
    expect(proactive.routines.get(routine.id)).toMatchObject({
      lastStatus: "failed",
      lastError: "Steward stopped while this was running.",
    });
  });

  it("looks at the inbox only when it is on, from the brief time until 21:00", async () => {
    t.server.services.settings.update({ briefTime: "08:00", timezone: "UTC" });
    let enabled = false;
    const looks: string[] = [];
    let clock = "";
    const watch: InboxWatchService = {
      status: () => ({ enabled }),
      setEnabled: (on) => ({ enabled: on }),
      check: async () => {
        looks.push(clock);
        return { enabled } satisfies InboxWatch;
      },
    };
    const tick = (iso: string) => {
      clock = iso;
      return workersAt(new Date(iso), watch).tickWatch();
    };
    await tick("2026-10-22T12:00:00Z"); // off
    enabled = true;
    await tick("2026-10-22T07:59:00Z"); // before the brief time
    await tick("2026-10-22T21:00:00Z"); // from 21:00 it rests
    expect(looks).toEqual([]);
    await tick("2026-10-22T08:00:00Z");
    await tick("2026-10-22T20:59:00Z");
    expect(looks).toEqual(["2026-10-22T08:00:00Z", "2026-10-22T20:59:00Z"]);
  });

  it("switches the inbox watch on and off over the API, and is honest that it cannot sort", async () => {
    expect((await t.api<InboxWatch>("/api/inbox-watch")).body).toMatchObject({ enabled: false });
    const on = await t.api<InboxWatch>("/api/inbox-watch", { method: "PATCH", json: { enabled: true } });
    expect(on.body).toMatchObject({ enabled: true });
    expect((await t.api("/api/inbox-watch", { method: "PATCH", json: { enabled: "yes" } })).status).toBe(400);
    // The test server runs the scripted model, which does not sort mail: the watch says so.
    const looked = await t.server.services.proactive.watch.check();
    expect(looked.note).toBe("Couldn't look: no model is set up to sort mail.");
    expect(looked.checkedAt).toBeUndefined();
    const off = await t.api<InboxWatch>("/api/inbox-watch", { method: "PATCH", json: { enabled: false } });
    expect(off.body).toMatchObject({ enabled: false, note: looked.note });
  });

  it("makes today's brief once the brief time has passed, once a day", async () => {
    const { settings, proactive } = t.server.services;
    settings.update({ briefTime: "00:00", timezone: "UTC" });
    // A day nothing else has made a brief for. An earlier one: a brief for a later day than the
    // service's today is refused.
    const now = new Date(Date.now() - 5 * 86_400_000);
    const today = localDate(now, "UTC");
    expect(proactive.brief.get(today)).toBeUndefined();

    const workers = workersAt(now);
    await workers.tickBrief();
    const made = proactive.brief.get(today);
    expect(made?.date).toBe(today);
    expect(settings.get("worker.briefDate", "")).toBe(today);

    await workers.tickBrief();
    expect(proactive.brief.get(today)?.id).toBe(made?.id);
  });

  it("waits for the brief time", async () => {
    const { settings, proactive } = t.server.services;
    settings.update({ briefTime: "23:59", timezone: "UTC" });
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(6, 0, 0, 0);
    await workersAt(tomorrow).tickBrief();
    expect(proactive.brief.get(localDate(tomorrow, "UTC"))).toBeUndefined();
  });

  it("expires approvals nobody answered and tells the agent", async () => {
    const res = await fetch(`${t.base}/api/copilotkit/agent/steward/run`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        threadId: "expiry-thread",
        runId: "expiry-run",
        messages: [{ id: "u1", role: "user", content: "Email sam@example.com about Friday: see you at 10" }],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      }),
    });
    await res.text();
    const pending = t.server.services.gateway.approvals.list({
      status: "pending",
      threadId: "expiry-thread",
    });
    expect(pending).toHaveLength(1);

    const farFuture = new Date(Date.now() + 10 * 86_400_000);
    await workersAt(farFuture).tickApprovals();
    const expired = t.server.services.gateway.approvals.get(pending[0]!.id) as Approval;
    expect(expired.status).toBe("expired");
  });
});
