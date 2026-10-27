import { describe, expect, it } from "vitest";
import { GENESIS_HASH, hashEvent } from "../src/audit.ts";
import { isSecretKey } from "../src/redact.ts";
import { gateCall, setup } from "./helpers.ts";

function seed(n: number) {
  const ctx = setup();
  for (let i = 0; i < n; i++) {
    ctx.gw.audit.append({ type: "run.started", actorId: "local", threadId: `thr_${i}`, detail: { i } });
  }
  return ctx;
}

describe("the chain", () => {
  it("links every row to the one before and verifies", () => {
    const { gw } = seed(5);
    const { events } = gw.audit.page({ limit: 200 });
    const ordered = [...events].reverse();
    expect(ordered[0]?.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]?.prevHash).toBe(ordered[i - 1]?.hash);
    for (const e of ordered) {
      const { hash, ...body } = e;
      expect(hashEvent(body)).toBe(hash);
    }
    expect(gw.audit.verify()).toEqual({ ok: true, count: ordered.length });
  });

  it("numbers rows from 1 without gaps", () => {
    const { gw } = seed(3);
    const seqs = gw.audit
      .page({ limit: 200 })
      .events.map((e) => e.seq)
      .reverse();
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it("verifies across many pages", () => {
    const { gw } = seed(1200);
    const check = gw.audit.verify();
    expect(check.ok).toBe(true);
    expect(check.count).toBeGreaterThanOrEqual(1200);
  });

  it("refuses UPDATE and DELETE at the database", () => {
    const { db } = seed(2);
    expect(() => db.run("UPDATE gateway_audit SET detail_json = '{}' WHERE seq = 1")).toThrow(/append-only/);
    expect(() => db.run("DELETE FROM gateway_audit WHERE seq = 1")).toThrow(/append-only/);
  });

  it("finds an edited row once the triggers are bypassed", () => {
    const { gw, db } = seed(4);
    const target = gw.audit.page({ type: "run.started", limit: 200 }).events.find((e) => e.detail.i === 2);
    db.exec("DROP TRIGGER gateway_audit_no_update");
    db.run("UPDATE gateway_audit SET detail_json = ? WHERE seq = ?", ['{"i":99}', target?.seq ?? 0]);
    const check = gw.audit.verify();
    expect(check.ok).toBe(false);
    expect(check.brokenAt).toBe(target?.seq);
    expect(check.count).toBe((target?.seq ?? 0) - 1);
  });

  it("finds an edited row even when the attacker rehashes it, because the next row no longer chains", () => {
    const { gw, db } = seed(4);
    const all = [...gw.audit.page({ limit: 200 }).events].reverse();
    const victim = all[1];
    if (!victim) throw new Error("no rows");
    db.exec("DROP TRIGGER gateway_audit_no_update");
    const forged = { ...victim, detail: { forged: true } };
    const { hash: _old, ...body } = forged;
    db.run("UPDATE gateway_audit SET detail_json = ?, hash = ? WHERE seq = ?", [
      JSON.stringify(forged.detail),
      hashEvent(body),
      victim.seq,
    ]);
    expect(gw.audit.verify()).toMatchObject({ ok: false, brokenAt: victim.seq + 1 });
  });

  it("finds a deleted row", () => {
    const { gw, db } = seed(4);
    db.exec("DROP TRIGGER gateway_audit_no_delete");
    db.run("DELETE FROM gateway_audit WHERE seq = 2");
    expect(gw.audit.verify()).toMatchObject({ ok: false, brokenAt: 3 });
  });

  it("announces every row on the bus", () => {
    const { gw, events } = setup();
    const before = events.length;
    const e = gw.audit.append({
      type: "computer.control_taken",
      actorId: "local",
      agentId: "steward",
      detail: {},
    });
    expect(events.slice(before)).toEqual([{ type: "audit.appended", event: e }]);
  });
});

describe("redaction", () => {
  it("knows secret key names in any spelling, and leaves ordinary ones", () => {
    for (const k of [
      "password",
      "Password",
      "api_key",
      "apiKey",
      "x-api-key",
      "accessToken",
      "authorization",
      "Cookie",
      "otp",
      "pin",
      "cvv",
      "client_secret",
      "privateKey",
      "key",
    ]) {
      expect(isSecretKey(k), k).toBe(true);
    }
    for (const k of [
      "to",
      "subject",
      "body",
      "url",
      "keyboard",
      "monkey",
      "pinned",
      "spinner",
      "footprint",
      "title",
    ]) {
      expect(isSecretKey(k), k).toBe(false);
    }
  });

  it("redacts secrets by key, masks values in text and cuts long strings", () => {
    const { gw } = setup();
    const e = gw.audit.append({
      type: "secret.filled",
      actorId: "local",
      detail: {
        password: "hunter2",
        nested: { apiToken: "abc", list: [{ cookie: "sid=1" }] },
        body: `Card 4242 4242 4242 4242 ${"x".repeat(400)}`,
        length: 7,
      },
    });
    expect(e.detail).toMatchObject({
      password: "[redacted]",
      nested: { apiToken: "[redacted]", list: [{ cookie: "[redacted]" }] },
      length: 7,
    });
    const body = e.detail.body as string;
    expect(body.startsWith("Card [•••• 4242] xxx")).toBe(true);
    expect(body.length).toBe(200);
    expect(body.endsWith("…")).toBe(true);
  });

  it("strips secrets from target URLs and commands", () => {
    const { gw } = setup();
    const e = gw.audit.append({
      type: "tool.decided",
      actorId: "local",
      target: {
        url: "https://api.example/cb?code=abc123&state=ok",
        command: "curl -H 'Authorization: Bearer abcDEF123456ghiJKL789' https://api.example",
      },
    });
    expect(e.target?.url).toBe("https://api.example/cb?code=%5Bredacted%5D&state=ok");
    expect(e.target?.command).not.toContain("abcDEF123456ghiJKL789");
  });

  it("keeps the key pressed by browser_press but hides text typed into a password field", async () => {
    const { gw } = setup();
    const press = gateCall("browser_press", { key: "Enter" });
    await gw.governance.execute(press, async () => null);
    expect(gw.audit.forToolCall(press.toolCallId)[0]?.detail.args).toEqual({ key: "Enter" });

    const typed = gateCall(
      "browser_type",
      { ref: "e1", text: "s3cret!" },
      {
        target: { element: { ref: "e1", name: "Enter your PIN" } },
      },
    );
    await gw.governance.execute(typed, async () => null);
    expect(gw.audit.forToolCall(typed.toolCallId)[0]?.detail.args).toEqual({ ref: "e1", text: "[redacted]" });
  });
});

describe("page", () => {
  async function populated() {
    const ctx = setup();
    const { gw } = ctx;
    await gw.governance.execute(
      gateCall("browser_navigate", { url: "https://news.example" }),
      async () => null,
    );
    await gw.governance.execute(
      gateCall("mail_send", { to: "sam@example.com", subject: "Lunch" }),
      async () => null,
    );
    gw.rules.create({
      name: "No evil",
      effect: "deny",
      when: 'target.host == "evil.example"',
      description: "",
      enabled: true,
      source: "person",
    });
    await gw.governance.execute(gateCall("web_fetch", { url: "https://evil.example" }), async () => null);
    await gw.governance.execute(gateCall("browser_snapshot"), async () => {
      throw new Error("boom");
    });
    return ctx;
  }

  it("filters by effect, including failed", async () => {
    const { gw } = await populated();
    expect(gw.audit.page({ effect: "deny" }).events.map((e) => e.tool?.name)).toEqual(["web_fetch"]);
    expect(gw.audit.page({ effect: "ask" }).events.every((e) => e.effect === "ask")).toBe(true);
    expect(gw.audit.page({ effect: "failed" }).events.map((e) => e.type)).toEqual(["tool.failed"]);
    expect(gw.audit.page({ effect: "bogus" }).total).toBe(0);
  });

  it("filters by type, a list of types or a prefix", async () => {
    const { gw } = await populated();
    expect(gw.audit.page({ type: "approval.requested" }).total).toBe(1);
    expect(gw.audit.page({ type: "tool.failed,approval.requested" }).total).toBe(2);
    expect(gw.audit.page({ type: "approval.*" }).events.every((e) => e.type.startsWith("approval."))).toBe(
      true,
    );
  });

  it("searches tool names, hosts and summaries", async () => {
    const { gw } = await populated();
    expect(gw.audit.page({ q: "news.example" }).events.every((e) => e.target?.host === "news.example")).toBe(
      true,
    );
    expect(gw.audit.page({ q: "Lunch" }).total).toBeGreaterThan(0);
    expect(gw.audit.page({ q: "mail_send" }).total).toBeGreaterThan(0);
    expect(gw.audit.page({ q: "100%_" }).total).toBe(0);
  });

  it("pages newest first with nextBefore", async () => {
    const { gw } = await populated();
    const all = gw.audit.page({ limit: 200 });
    const first = gw.audit.page({ limit: 3 });
    expect(first.events.map((e) => e.seq)).toEqual(all.events.slice(0, 3).map((e) => e.seq));
    expect(first.total).toBe(all.total);
    const second = gw.audit.page({ limit: 3, before: first.nextBefore });
    expect(second.events[0]?.seq).toBe((first.events[2]?.seq ?? 0) - 1);
    const last = gw.audit.page({ limit: 200, before: 2 });
    expect(last.nextBefore).toBeUndefined();
  });
});
