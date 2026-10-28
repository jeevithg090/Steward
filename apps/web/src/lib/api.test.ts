import { type Approval, ROUTES, type Task, type TasksResponse } from "@steward/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, needsYouCount, withQuery } from "./api.ts";
import { mockFetch } from "./testing.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("withQuery", () => {
  it("adds only defined, non-empty values", () => {
    expect(withQuery("/api/audit", { before: 10, type: "tool.decided", q: "", effect: undefined })).toBe(
      "/api/audit?before=10&type=tool.decided",
    );
    expect(withQuery("/api/tasks", {})).toBe("/api/tasks");
    expect(withQuery("/api/tasks")).toBe("/api/tasks");
  });
});

describe("api: every route in ROUTES", () => {
  // One row per client call: what it should send. Covers every ROUTES entry the browser calls over
  // HTTP (events is the SSE stream in live.ts; computerWs is checked separately below).
  const cases: [string, () => Promise<unknown>, string, string, unknown?][] = [
    ["info", () => api.info(), "GET", "/api/info"],
    ["agents", () => api.agents(), "GET", "/api/agents"],
    ["harnesses", () => api.harnesses(), "GET", "/api/harnesses"],
    ["health", () => api.health(), "GET", "/api/health"],
    ["settings", () => api.settings.get(), "GET", "/api/settings"],
    [
      "settings (PUT)",
      () => api.settings.update({ plainLanguage: true }),
      "PUT",
      "/api/settings",
      { plainLanguage: true },
    ],
    ["setup", () => api.setup.list(), "GET", "/api/setup"],
    ["setup check", () => api.setup.check(), "POST", "/api/setup/check"],
    ["threads", () => api.threads.list(), "GET", "/api/threads"],
    [
      "threads (POST)",
      () => api.threads.create({ title: "Plans" }),
      "POST",
      "/api/threads",
      { title: "Plans" },
    ],
    ["thread", () => api.threads.get("thr_1"), "GET", "/api/threads/thr_1"],
    ["thread (DELETE)", () => api.threads.remove("thr_1"), "DELETE", "/api/threads/thr_1"],
    ["approvals", () => api.approvals.list("pending"), "GET", "/api/approvals?status=pending"],
    ["approval", () => api.approvals.get("apr_1"), "GET", "/api/approvals/apr_1"],
    [
      "approval decision",
      () => api.approvals.decide("apr_1", { answer: "refuse", note: "Not today" }),
      "POST",
      "/api/approvals/apr_1/decision",
      { answer: "refuse", note: "Not today" },
    ],
    ["rules", () => api.rules.list(), "GET", "/api/rules"],
    [
      "rules (POST)",
      () => api.rules.create({ name: "Calendar", effect: "ask", when: 'tool.surface == "calendar"' }),
      "POST",
      "/api/rules",
      { name: "Calendar", effect: "ask", when: 'tool.surface == "calendar"' },
    ],
    [
      "rule (PUT)",
      () => api.rules.update("rul_1", { name: "N", effect: "deny", when: "true" }),
      "PUT",
      "/api/rules/rul_1",
      { name: "N", effect: "deny", when: "true" },
    ],
    ["rule (DELETE)", () => api.rules.remove("rul_1"), "DELETE", "/api/rules/rul_1"],
    [
      "rules dry run",
      () => api.rules.dryRun({ tool: "mail_send", args: {}, tainted: true }),
      "POST",
      "/api/rules/dry-run",
      { tool: "mail_send", args: {}, tainted: true },
    ],
    ["rules presets", () => api.rules.presets(), "GET", "/api/rules/presets"],
    [
      "audit",
      () => api.audit.page({ before: 40, limit: 20, effect: "deny" }),
      "GET",
      "/api/audit?before=40&limit=20&effect=deny",
    ],
    ["audit verify", () => api.audit.verify(), "GET", "/api/audit/verify"],
    ["tasks", () => api.tasks.list("suggested"), "GET", "/api/tasks?state=suggested"],
    [
      "task (PATCH)",
      () => api.tasks.patch("tsk_1", { state: "resolved" }),
      "PATCH",
      "/api/tasks/tsk_1",
      { state: "resolved" },
    ],
    ["task start", () => api.tasks.start("tsk_1"), "POST", "/api/tasks/tsk_1/start", {}],
    ["brief", () => api.brief.get("2026-10-27"), "GET", "/api/brief?date=2026-10-27"],
    ["brief generate", () => api.brief.generate(), "POST", "/api/brief/generate"],
    [
      "brief generate (for a day)",
      () => api.brief.generate({ date: "2026-10-28" }),
      "POST",
      "/api/brief/generate",
      { date: "2026-10-28" },
    ],
    ["inbox", () => api.inbox(), "GET", "/api/inbox"],
    [
      "calendar",
      () => api.calendar("2026-10-27T00:00:00Z", "2026-10-28T00:00:00Z"),
      "GET",
      "/api/calendar?from=2026-10-27T00%3A00%3A00Z&to=2026-10-28T00%3A00%3A00Z",
    ],
    ["routines", () => api.routines.list(), "GET", "/api/routines"],
    [
      "routines (POST)",
      () => api.routines.create({ title: "T", prompt: "P", schedule: "0 8 * * *" }),
      "POST",
      "/api/routines",
      { title: "T", prompt: "P", schedule: "0 8 * * *" },
    ],
    [
      "routine (PATCH)",
      () => api.routines.update("rtn_1", { enabled: false }),
      "PATCH",
      "/api/routines/rtn_1",
      { enabled: false },
    ],
    ["routine (DELETE)", () => api.routines.remove("rtn_1"), "DELETE", "/api/routines/rtn_1"],
    ["routine run", () => api.routines.run("rtn_1"), "POST", "/api/routines/rtn_1/run"],
    ["memory", () => api.memory.list(), "GET", "/api/memory"],
    [
      "memory (POST)",
      () => api.memory.add("Prefers mornings"),
      "POST",
      "/api/memory",
      { text: "Prefers mornings" },
    ],
    ["memory item (DELETE)", () => api.memory.remove("mem_1"), "DELETE", "/api/memory/mem_1"],
    ["skills", () => api.skills.list(), "GET", "/api/skills"],
    [
      "skills (POST)",
      () => api.skills.create({ name: "weekly", description: "D", instructions: "I" }),
      "POST",
      "/api/skills",
      { name: "weekly", description: "D", instructions: "I" },
    ],
    [
      "skill (PUT)",
      () => api.skills.update("skl_1", { name: "weekly", description: "D", instructions: "I", tools: [] }),
      "PUT",
      "/api/skills/skl_1",
      { name: "weekly", description: "D", instructions: "I", tools: [] },
    ],
    ["skill (DELETE)", () => api.skills.remove("skl_1"), "DELETE", "/api/skills/skl_1"],
    ["connections", () => api.connections.get(), "GET", "/api/connections"],
    [
      "mcp (POST)",
      () =>
        api.connections.addMcp({
          id: "notes",
          name: "Notes",
          transport: "http",
          url: "https://example.com/mcp",
        }),
      "POST",
      "/api/connections/mcp",
      { id: "notes", name: "Notes", transport: "http", url: "https://example.com/mcp" },
    ],
    [
      "mcp (PUT)",
      () =>
        api.connections.updateMcp("notes", {
          id: "notes",
          name: "Notes",
          transport: "stdio",
          command: "npx",
        }),
      "PUT",
      "/api/connections/mcp/notes",
      { id: "notes", name: "Notes", transport: "stdio", command: "npx" },
    ],
    ["mcp (DELETE)", () => api.connections.removeMcp("notes"), "DELETE", "/api/connections/mcp/notes"],
    ["computer", () => api.computer.status("steward"), "GET", "/api/computer/steward"],
    ["computer activity", () => api.computer.activity("steward"), "GET", "/api/computer/steward/activity"],
    [
      "computer files",
      () => api.computer.files("steward", "reports"),
      "GET",
      "/api/computer/steward/files?dir=reports",
    ],
    ["computer reset", () => api.computer.reset("steward"), "POST", "/api/computer/steward/reset"],
    ["notifications", () => api.notifications.list(), "GET", "/api/notifications"],
    ["notifications read all", () => api.notifications.readAll(), "POST", "/api/notifications/read-all"],
    [
      "bots",
      () => api.bots.list({ q: "rent", category: "home", sort: "used" }),
      "GET",
      "/api/bots?q=rent&category=home&sort=used",
    ],
    ["bots installed", () => api.bots.installed(), "GET", "/api/bots/installed"],
    [
      "bots preview",
      () => api.bots.preview({ packUrl: "packs/rent-scout.json" }),
      "POST",
      "/api/bots/preview",
      { packUrl: "packs/rent-scout.json" },
    ],
    [
      "bots install",
      () => api.bots.install({ packUrl: "packs/rent-scout.json" }),
      "POST",
      "/api/bots/install",
      { packUrl: "packs/rent-scout.json" },
    ],
    [
      "bot installed (DELETE)",
      () => api.bots.remove("rent-scout"),
      "DELETE",
      "/api/bots/installed/rent-scout",
    ],
    [
      "bot installed update",
      () => api.bots.update("rent-scout"),
      "POST",
      "/api/bots/installed/rent-scout/update",
    ],
    [
      "bots make",
      () => api.bots.make({ job: "Find me a flat", category: "home" }),
      "POST",
      "/api/bots/make",
      { job: "Find me a flat", category: "home" },
    ],
    ["phone", () => api.phone.get(), "GET", "/api/phone"],
    [
      "phone address",
      () => api.phone.setUrl("https://mac.example.ts.net"),
      "PUT",
      "/api/phone",
      { url: "https://mac.example.ts.net" },
    ],
    ["phone catalogue", () => api.phone.catalogue(), "GET", "/api/phone/catalogue"],
    [
      "phone shortcut install",
      () => api.phone.install("skill:plan-trip"),
      "POST",
      "/api/phone/shortcuts/skill%3Aplan-trip/install",
    ],
    ["devices", () => api.devices.list(), "GET", "/api/devices"],
    [
      "devices pairing",
      () => api.devices.pair("shortcut"),
      "POST",
      "/api/devices/pairing",
      { kind: "shortcut" },
    ],
    [
      "device (PATCH)",
      () => api.devices.patch("dev_1", { scopes: ["chat"] }),
      "PATCH",
      "/api/devices/dev_1",
      { scopes: ["chat"] },
    ],
    ["device (DELETE)", () => api.devices.revoke("dev_1"), "DELETE", "/api/devices/dev_1"],
    ["remote pairing", () => api.devices.remotePair(), "POST", "/api/devices/remote-pairing"],
    ["remote pairing state", () => api.devices.remoteState("p1"), "GET", "/api/devices/remote-pairing/p1"],
    [
      "remote pairing confirm",
      () => api.devices.remoteConfirm("p1"),
      "POST",
      "/api/devices/remote-pairing/p1/confirm",
    ],
    [
      "remote pairing refuse",
      () => api.devices.remoteRefuse("p1"),
      "POST",
      "/api/devices/remote-pairing/p1/refuse",
    ],
  ];

  it.each(cases)("%s", async (_name, call, method, url, body) => {
    const { calls } = mockFetch(() => ({ body: {} }));
    await call();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe(method);
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.body).toEqual(body);
  });

  it("covers every HTTP route in ROUTES", () => {
    const covered = new Set(cases.map(([, , , url]) => url.split("?")[0]));
    const templates = Object.entries(ROUTES).filter(([key]) => key !== "events" && key !== "computerWs");
    for (const [key, template] of templates) {
      const pattern = new RegExp(`^${template.replace(/:[a-zA-Z]+/g, "[^/]+")}$`);
      expect(
        [...covered].some((u) => pattern.test(u ?? "")),
        `ROUTES.${key} has no client call`,
      ).toBe(true);
    }
  });

  it("encodes ids in paths", async () => {
    const { calls } = mockFetch(() => ({ status: 204 }));
    await api.threads.remove("thr a/b");
    expect(calls[0]!.url).toBe("/api/threads/thr%20a%2Fb");
  });

  it("builds the computer's WebSocket address on this host", () => {
    expect(api.computer.wsUrl("steward")).toMatch(/^wss?:\/\/[^/]+\/ws\/computer\/steward$/);
  });

  it("returns undefined for an empty 204", async () => {
    mockFetch(() => ({ status: 204 }));
    await expect(api.memory.remove("mem_1")).resolves.toBeUndefined();
  });
});

describe("api errors", () => {
  it("throws the server's own sentence as an ApiError", async () => {
    mockFetch(() => ({ status: 404, body: { error: "Couldn't find that task." } }));
    const error = await api.tasks.patch("tsk_x", { state: "resolved" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Couldn't find that task.");
    expect((error as ApiError).status).toBe(404);
  });

  it("falls back to a plain sentence when the body is not JSON", async () => {
    mockFetch(() => ({ status: 502, body: "<html>Bad gateway</html>" }));
    await expect(api.info()).rejects.toThrow("Steward hit a problem. Try again in a moment.");
  });

  it("says the server can't be reached when fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const error = (await api.info().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/Couldn't reach Steward/);
  });
});

describe("needsYouCount", () => {
  const task = (over: Partial<Task>): Task => ({
    id: "tsk_1",
    title: "T",
    detail: "",
    state: "needs_you",
    source: "triage",
    createdAt: "2026-10-27T08:00:00Z",
    updatedAt: "2026-10-27T08:00:00Z",
    ...over,
  });
  const approval = (id: string) => ({ id, status: "pending" }) as Approval;

  it("adds tasks that need you, failed tasks, and approvals no task stands for", () => {
    const tasks: TasksResponse = {
      tasks: [task({ id: "a", approvalId: "apr_linked" }), task({ id: "b", state: "failed" })],
      counts: {
        needs_you: 1,
        suggested: 0,
        working: 0,
        ready_for_review: 0,
        needs_input: 0,
        resolved: 0,
        failed: 1,
        hidden: 0,
      },
    };
    expect(needsYouCount(tasks, [approval("apr_linked"), approval("apr_loose")])).toBe(3);
    expect(needsYouCount(undefined, undefined)).toBe(0);
  });
});
