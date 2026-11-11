import { describe, expect, it } from "vitest";
import {
  McpServerBody,
  ROUTES,
  RoutineBody,
  RuleBody,
  route,
  SettingsBody,
  SkillBody,
} from "../src/index.ts";

describe("route", () => {
  it("fills each segment, encoded so it stays one segment", () => {
    expect(route(ROUTES.thread, { id: "t-1" })).toBe("/api/threads/t-1");
    expect(route(ROUTES.thread, { id: "a/b?c#d" })).toBe("/api/threads/a%2Fb%3Fc%23d");
    expect(route(ROUTES.computerFiles, { agentId: "steward" })).toBe("/api/computer/steward/files");
    expect(route(ROUTES.botInstalled, { id: "" })).toBe("/api/bots/installed/");
  });

  it("leaves a segment with no value as it is, so the mistake shows", () => {
    expect(route(ROUTES.approvalDecide)).toBe("/api/approvals/:id/decision");
    expect(route(ROUTES.remotePairingConfirm, { other: "x" })).toBe(
      "/api/devices/remote-pairing/:id/confirm",
    );
  });

  it("names every route under /api, or the computer's WebSocket", () => {
    for (const path of Object.values(ROUTES)) expect(path).toMatch(/^\/(api|ws)\//);
  });
});

describe("SettingsBody", () => {
  it("takes only http and https model addresses", () => {
    for (const baseUrl of ["http://localhost:11434/v1", "https://openrouter.ai/api/v1"]) {
      expect(SettingsBody.safeParse({ model: { provider: "ollama", model: "m", baseUrl } }).success).toBe(
        true,
      );
    }
    for (const baseUrl of ["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.c", "ftp://x", "nope"]) {
      const parsed = SettingsBody.safeParse({
        model: { provider: "openai-compatible", model: "m", baseUrl },
      });
      expect(parsed.success, baseUrl).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe("use a web address that starts with http:// or https://");
    }
  });

  it("takes a brief time of day, and approvals that wait between an hour and a week", () => {
    expect(SettingsBody.safeParse({ briefTime: "07:30" }).success).toBe(true);
    expect(SettingsBody.safeParse({ briefTime: "23:59" }).success).toBe(true);
    for (const briefTime of ["7:30", "24:00", "07:60", "7am"]) {
      expect(SettingsBody.safeParse({ briefTime }).error?.issues[0]?.message, briefTime).toBe(
        "use a time like 07:30",
      );
    }
    expect(SettingsBody.safeParse({ approvalExpiryHours: 168 }).success).toBe(true);
    for (const approvalExpiryHours of [0, 169, 1.5, "3"]) {
      expect(SettingsBody.safeParse({ approvalExpiryHours }).success).toBe(false);
    }
    expect(SettingsBody.safeParse({ model: { provider: "someone-else", model: "m" } }).success).toBe(false);
  });
});

describe("RuleBody and RoutineBody", () => {
  it("fill their defaults, and refuse an effect that is not allow, ask or deny", () => {
    expect(RuleBody.parse({ name: "n", effect: "allow", when: "true" })).toEqual({
      name: "n",
      effect: "allow",
      when: "true",
      description: "",
      enabled: true,
    });
    expect(RuleBody.safeParse({ name: "n", effect: "maybe", when: "true" }).success).toBe(false);
    expect(RuleBody.safeParse({ name: "", effect: "ask", when: "true" }).success).toBe(false);
    expect(RuleBody.safeParse({ name: "n", effect: "ask", when: "x".repeat(2001) }).success).toBe(false);
    expect(RoutineBody.parse({ title: "t", prompt: "p", schedule: "0 8 * * *" })).toMatchObject({
      timezone: "UTC",
      enabled: true,
    });
    expect(RoutineBody.safeParse({ title: "t", prompt: "", schedule: "0 8 * * *" }).success).toBe(false);
  });
});

describe("names and addresses", () => {
  it("say what a skill name or tool server id may be", () => {
    for (const name of ["Weekly", "-x", "a b", "x".repeat(42)]) {
      const parsed = SkillBody.safeParse({ name, description: "d", instructions: "i" });
      expect(parsed.error?.issues[0]?.message, name).toBe(
        "use up to 41 lower-case letters, digits and dashes, starting with a letter or digit",
      );
    }
    expect(SkillBody.safeParse({ name: "weekly-review", description: "d", instructions: "i" }).success).toBe(
      true,
    );
    const server = { id: "files", name: "Files", transport: "http" };
    expect(McpServerBody.safeParse({ ...server, url: "https://tools.example/mcp" }).success).toBe(true);
    expect(McpServerBody.safeParse({ ...server, url: "file:///etc/passwd" }).success).toBe(false);
    expect(McpServerBody.safeParse({ ...server, id: "Files" }).success).toBe(false);
  });
});
