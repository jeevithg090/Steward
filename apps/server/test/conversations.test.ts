import type { ThreadSummary } from "@steward/shared";
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
});
