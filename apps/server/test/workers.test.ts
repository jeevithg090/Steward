import type { Approval, Routine } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServerRuns } from "../src/runtime/server-runs.ts";
import type { SettingsStore } from "../src/store/settings.ts";
import { ThreadStore } from "../src/store/threads.ts";
import { localDate } from "../src/util/time.ts";
import type { ResumeSweep } from "../src/workers/resume-sweep.ts";
import { STOPPED_RUN, type WorkerDeps, Workers } from "../src/workers/workers.ts";
import { EchoAgent, missingPackages, runnerOnMemoryDb, waitFor } from "./helpers.ts";
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
  function workersAt(now: Date) {
    const s = t.server.services;
    return new Workers({
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
    const later = new Date(Date.now() + 2 * 86_400_000);
    await workersAt(later).tickRoutines();

    const recorded = await waitFor(() => {
      const r = proactive.routines.get(routine.id);
      return r?.lastStatus ? r : undefined;
    });
    expect(recorded.lastStatus).toBe("ok");
    const messages = runner.getThreadMessages(routine.threadId);
    expect(String(messages[0]?.content)).toMatch(/^One of your routines is firing right now/);
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

    await workersAt(new Date(Date.now() + 2 * 86_400_000)).tickRoutines();
    const recorded = await waitFor(() => {
      const r = proactive.routines.get(routine.id);
      return r?.lastStatus ? r : undefined;
    });
    expect(recorded.lastStatus).toBe("skipped");
    expect(recorded.lastError).toMatch(/still waiting for your answer/);
    expect(runner.getThreadMessages(routine.threadId)).toEqual(before);
  });

  it("makes today's brief once the brief time has passed, once a day", async () => {
    const { settings, proactive } = t.server.services;
    settings.update({ briefTime: "00:00", timezone: "UTC" });
    // A day nothing else has made a brief for.
    const now = new Date(Date.now() + 5 * 86_400_000);
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

describe("a routine run the person stopped", () => {
  it("is recorded as skipped, not as a run that finished, and sends no notification", async () => {
    const { runner, db } = runnerOnMemoryDb();
    const agent = new EchoAgent({ agentId: "steward" });
    agent.delayMs = 5_000;
    const runs = new ServerRuns({ runner, agent: () => agent, serverRunToken: "tok" });
    const recorded: [string, string, string | undefined][] = [];
    const notes: unknown[] = [];
    const routine = {
      id: "rtn_1",
      title: "Morning mail",
      prompt: "Check my mail.",
      threadId: "thr_routine",
      agentId: "steward",
    } as Routine;
    const workers = new Workers({
      routines: {
        recordRun: (id: string, status: string, error?: string) => recorded.push([id, status, error]),
      },
      notifications: { add: (n: unknown) => notes.push(n) },
      runs,
      threads: new ThreadStore(db, runner),
      approvals: {},
      brief: {},
      sweep: {} as ResumeSweep,
      settings: {} as SettingsStore,
    } as unknown as WorkerDeps);

    const run = workers.runRoutine(routine);
    await runner.stop({ threadId: routine.threadId });
    expect((await run.done).outcome).toBe("cancelled");
    await waitFor(() => recorded.length > 0);
    expect(recorded).toEqual([["rtn_1", "skipped", STOPPED_RUN]]);
    expect(notes).toEqual([]);
  });
});
