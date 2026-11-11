import type { Routine } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missingPackages } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const missing = await missingPackages();

describe.runIf(missing.length === 0)("changing a routine on /routines", () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    await t?.close();
  });

  const changes = (routineId: string) =>
    t.server.services.gateway.audit
      .page({ type: "routine.changed", limit: 50 })
      .events.filter((e) => e.detail.routineId === routineId)
      .reverse();

  it("puts each change the person makes in the record, naming what changed", async () => {
    const made = await t.api<Routine>("/api/routines", {
      method: "POST",
      json: { title: "Morning mail", prompt: "Check my mail.", schedule: "0 8 * * 1-5" },
    });
    expect(made.status).toBe(201);
    const id = made.body.id;

    const moved = await t.api<Routine>(`/api/routines/${id}`, {
      method: "PATCH",
      json: { title: "Morning mail", schedule: "0 9 * * 1-5", prompt: "Check my mail and calendar." },
    });
    expect(moved.body).toMatchObject({ schedule: "0 9 * * 1-5", prompt: "Check my mail and calendar." });
    // Sending what is already saved changes nothing, so nothing new is recorded.
    await t.api(`/api/routines/${id}`, { method: "PATCH", json: { schedule: "0 9 * * 1-5" } });
    await t.api(`/api/routines/${id}`, { method: "DELETE" });

    const recorded = changes(id).map((e) => e.detail);
    expect(recorded).toEqual([
      expect.objectContaining({ change: "created", summary: "Added the routine 'Morning mail'" }),
      expect.objectContaining({
        change: "updated",
        fields: ["prompt", "schedule"],
        schedule: "0 9 * * 1-5",
        summary: "Changed the routine 'Morning mail'",
      }),
      expect.objectContaining({ change: "removed", summary: "Deleted the routine 'Morning mail'" }),
    ]);
    expect(t.server.services.gateway.audit.verify().ok).toBe(true);
  });

  it("records nothing when a change is refused", async () => {
    const made = await t.api<Routine>("/api/routines", {
      method: "POST",
      json: { title: "Evening digest", prompt: "Sum up the day.", schedule: "0 18 * * *" },
    });
    const refused = await t.api(`/api/routines/${made.body.id}`, {
      method: "PATCH",
      json: { schedule: "*/5 * * * *" },
    });
    expect(refused.status).toBe(400);
    expect(changes(made.body.id).map((e) => e.detail.change)).toEqual(["created"]);
  });
});
