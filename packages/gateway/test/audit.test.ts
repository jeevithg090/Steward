import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Db, memoryDb } from "@steward/db";
import type { AuditEvent } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { FULL_CHECK_EVERY_MS, GENESIS_HASH, hashEvent, SqliteAuditLog } from "../src/audit.ts";
import { createGateway } from "../src/gateway.ts";
import { migrations } from "../src/migrations.ts";
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
    const newest = ordered[ordered.length - 1];
    expect(gw.audit.verify()).toEqual({
      ok: true,
      count: ordered.length,
      scope: "full",
      fullCheckAt: "2026-10-27T09:00:00.000Z",
      head: { seq: newest?.seq, hash: newest?.hash, at: newest?.at },
    });
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

  it("finds a row numbered below the first, which the walk from 1 would never reach", () => {
    const { gw, db } = seed(1);
    const first = gw.audit.page({ limit: 1 }).events[0] as AuditEvent;
    // Nothing stops an INSERT: a forged entry slipped in before the first one.
    const forged = { ...first, seq: 0, id: "aud_forged", detail: { summary: "Sent the invoices" } };
    const { hash: _h, ...body } = forged;
    db.run(
      `INSERT INTO gateway_audit (seq, id, at, type, actor_id, detail_json, prev_hash, hash)
       VALUES (0, 'aud_forged', ?, 'tool.completed', 'local', ?, ?, ?)`,
      [first.at, JSON.stringify(forged.detail), GENESIS_HASH, hashEvent({ ...body, type: "tool.completed" })],
    );
    expect(gw.audit.verify()).toMatchObject({ ok: false, brokenAt: 0, count: 0 });
  });

  it("stores ids with a lone surrogate so they still match their hash", () => {
    const { gw } = setup();
    const e = gw.audit.append({ type: "run.started", actorId: "local\uDFFF", threadId: "thr_\uD800x" });
    expect(e.threadId).toBe("thr_\uFFFDx");
    expect(gw.audit.page({ limit: 1 }).events[0]).toEqual(e);
    expect(gw.audit.verify()).toMatchObject({ ok: true, count: e.seq });
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

describe("checking without holding up the server", () => {
  const dropTriggers = (db: ReturnType<typeof setup>["db"]) => {
    db.exec("DROP TRIGGER gateway_audit_no_update");
    db.exec("DROP TRIGGER gateway_audit_no_delete");
  };
  const append = (gw: ReturnType<typeof setup>["gw"], n: number) => {
    for (let i = 0; i < n; i++) gw.audit.append({ type: "run.started", actorId: "local", detail: { i } });
  };

  it("walks everything first, then hashes only what was added since", async () => {
    const { gw } = seed(600);
    const n = gw.audit.page({}).total;
    expect(await gw.audit.check()).toMatchObject({ ok: true, count: n, scope: "full" });
    append(gw, 3);
    const recent = await gw.audit.check();
    expect(recent).toMatchObject({ ok: true, count: n + 3, scope: "recent", head: { seq: n + 3 } });
    expect(recent.fullCheckAt).toBe("2026-10-27T09:00:00.000Z");
    expect(await gw.audit.check({ full: true })).toMatchObject({ ok: true, count: n + 3, scope: "full" });
  });

  it("gives way to other work between pages", async () => {
    const { gw } = seed(1000);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const check = await gw.audit.check({ full: true });
    clearInterval(timer);
    expect(check.ok).toBe(true);
    expect(ticks).toBeGreaterThan(0);
  });

  it("the recent check catches a forged new row", async () => {
    const { gw, db } = seed(5);
    await gw.audit.check();
    const newest = gw.audit.page({ limit: 1 }).events[0] as AuditEvent;
    db.run(
      `INSERT INTO gateway_audit (seq, id, at, type, actor_id, detail_json, prev_hash, hash)
       VALUES (?, 'aud_forged', ?, 'tool.completed', 'local', '{"summary":"Paid"}', ?, ?)`,
      [newest.seq + 1, newest.at, newest.hash, "f".repeat(64)],
    );
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: newest.seq + 1, scope: "recent" });
    // It keeps saying so.
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: newest.seq + 1 });
  });

  it("the full walk catches an edit to an old row, on request and at least hourly", async () => {
    const { gw, db } = seed(5);
    await gw.audit.check();
    dropTriggers(db);
    db.run("UPDATE gateway_audit SET detail_json = '{\"i\":99}' WHERE seq = 2");
    // Below the checkpoint, unchanged numbering: the recent check does not hash row 2 again.
    expect(await gw.audit.check()).toMatchObject({ ok: true, scope: "recent" });
    expect(await gw.audit.check({ full: true })).toMatchObject({
      ok: false,
      brokenAt: 2,
      count: 1,
      scope: "full",
    });

    const other = seed(5);
    await other.gw.audit.check();
    dropTriggers(other.db);
    other.db.run("UPDATE gateway_audit SET detail_json = '{\"i\":99}' WHERE seq = 2");
    other.advance(FULL_CHECK_EVERY_MS);
    expect(await other.gw.audit.check()).toMatchObject({ ok: false, brokenAt: 2, scope: "full" });
  });

  it("walks everything again when an old row goes missing", async () => {
    const { gw, db } = seed(6);
    await gw.audit.check();
    dropTriggers(db);
    db.run("DELETE FROM gateway_audit WHERE seq = 3");
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: 4, count: 2, scope: "full" });
  });

  it("says the record was rewritten when a row it checked changes, even if the new chain is whole", async () => {
    const { gw, db } = seed(4);
    expect((await gw.audit.check()).ok).toBe(true);
    dropTriggers(db);
    // Cut the last two entries: what is left still chains from the first.
    db.run("DELETE FROM gateway_audit WHERE seq > 2");
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: 3, count: 2 });
    // New entries chain on from what is left, but the cut is not forgotten.
    append(gw, 3);
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: 3 });
    expect(await gw.audit.check({ full: true })).toMatchObject({ ok: false, brokenAt: 3 });
    // A later break does not hide the earlier one.
    db.run("UPDATE gateway_audit SET detail_json = '{}' WHERE seq = 4");
    expect(await gw.audit.check({ full: true })).toMatchObject({ ok: false, brokenAt: 3 });
  });

  it("still sees a cut made after a break, though the checkpoint moved back to the break", async () => {
    const { gw, db } = seed(10);
    expect(await gw.audit.check()).toMatchObject({ ok: true, count: 11 });
    dropTriggers(db);
    // First a gap, which a check reports, so the checkpoint moves back to entry 4.
    db.run("DELETE FROM gateway_audit WHERE seq = 5");
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: 6, count: 4 });
    // Then everything after it goes: what is left chains from the first, but entry 11 was seen.
    db.run("DELETE FROM gateway_audit WHERE seq > 4");
    expect(await gw.audit.check()).toMatchObject({ ok: false, brokenAt: 5, count: 4 });
    expect(await gw.audit.check({ full: true })).toMatchObject({ ok: false, brokenAt: 5 });
    // Steward writing on from what is left does not hide it either.
    append(gw, 8);
    const later = await gw.audit.check({ full: true });
    expect(later).toMatchObject({ ok: false, brokenAt: 5 });
    expect(later.head).toBeUndefined();
  });

  it("a break that is put right again is not a rewrite", async () => {
    const { gw, db } = seed(4);
    await gw.audit.check();
    dropTriggers(db);
    const row = db.get<{ detail_json: string }>("SELECT detail_json FROM gateway_audit WHERE seq = 3");
    db.run("UPDATE gateway_audit SET detail_json = '{\"i\":99}' WHERE seq = 3");
    expect(await gw.audit.check({ full: true })).toMatchObject({ ok: false, brokenAt: 3 });
    db.run("UPDATE gateway_audit SET detail_json = ? WHERE seq = 3", [row?.detail_json ?? ""]);
    expect(await gw.audit.check({ full: true })).toMatchObject({ ok: true, count: 5 });
  });
});

describe("a seal written down elsewhere", () => {
  it("matches while the record is whole, and the newest one is given to write down", async () => {
    const { gw } = seed(3);
    const { head } = await gw.audit.check();
    if (!head) throw new Error("no head");
    gw.audit.append({ type: "run.started", actorId: "local" });
    const check = await gw.audit.check({ anchor: { seq: head.seq, hash: head.hash.toUpperCase() } });
    expect(check).toMatchObject({
      ok: true,
      scope: "full",
      anchor: { seq: head.seq, hash: head.hash, ok: true },
    });
    expect(check.head?.seq).toBe(head.seq + 1);
  });

  it("does not match once the record was cut or rewritten, even in a fresh Steward", async () => {
    const { gw, db } = seed(4);
    const { head } = gw.audit.verify();
    if (!head) throw new Error("no head");
    db.exec("DROP TRIGGER gateway_audit_no_delete");
    db.run("DELETE FROM gateway_audit WHERE seq = ?", [head.seq]);
    // A Steward that never saw the old chain: it is whole, but the seal no longer is in it.
    const db2 = memoryDb();
    db2.migrate(migrations);
    const fresh = new SqliteAuditLog(db2);
    for (const e of [...gw.audit.page({ limit: 200 }).events].reverse()) {
      db2.run(
        `INSERT INTO gateway_audit (seq, id, at, type, actor_id, agent_id, thread_id, run_id, tool_call_id,
           tool_json, target_json, effect, rule_json, detail_json, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        [
          e.seq,
          e.id,
          e.at,
          e.type,
          e.actorId,
          e.threadId ?? null,
          JSON.stringify(e.detail),
          e.prevHash,
          e.hash,
        ],
      );
    }
    expect(fresh.verify()).toMatchObject({ ok: true, count: head.seq - 1 });
    expect(fresh.verify({ anchor: head })).toMatchObject({ ok: false, anchor: { ok: false } });
    const older = gw.audit.page({ limit: 200 }).events.find((e) => e.seq === 2) as AuditEvent;
    expect(await fresh.check({ anchor: { seq: 2, hash: older.hash } })).toMatchObject({
      ok: true,
      anchor: { ok: true },
    });
    expect(await fresh.check({ anchor: { seq: 2, hash: "0".repeat(64) } })).toMatchObject({
      ok: false,
      anchor: { ok: false },
    });
  });
});

describe("export", () => {
  it("gives every row as stored, oldest first, in pages that hash as they did", () => {
    const { gw } = seed(6);
    const pages = [...gw.audit.exportPages(3)];
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
    const rows = pages.flat();
    expect(rows.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    let prev = GENESIS_HASH;
    for (const e of rows) {
      const { hash, ...body } = JSON.parse(JSON.stringify(e)) as AuditEvent;
      expect(body.prevHash).toBe(prev);
      expect(hashEvent(body)).toBe(hash);
      prev = hash;
    }
    const empty = memoryDb();
    empty.migrate(migrations);
    expect([...new SqliteAuditLog(empty).exportPages()]).toEqual([]);
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

describe("the checks docs/governance.md gives", () => {
  const docs = readFileSync(fileURLToPath(new URL("../../../docs/governance.md", import.meta.url)), "utf8");
  const script = (name: string) => {
    const fence = "```";
    const start = docs.indexOf(`${fence}js\n// ${name}:`);
    const end = docs.indexOf(fence, start + fence.length);
    if (start < 0 || end < 0) throw new Error(`${name} is not in docs/governance.md`);
    return docs.slice(start + fence.length + "js\n".length, end);
  };
  const node = (dir: string, args: string[]) =>
    spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", timeout: 20_000 });

  it("verify a database file and a download, without Steward running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "steward-record-"));
    try {
      const db = new Db(join(dir, "steward.db"));
      const gw = createGateway({ db });
      await gw.governance.execute(
        gateCall("mail_send", { to: "sam@example.com", subject: "Hi" }),
        async () => null,
      );
      await gw.governance.execute(gateCall("browser_snapshot"), async () => ({ title: "News" }));
      gw.audit.append({
        type: "run.started",
        actorId: "local",
        threadId: "thr_\uD800x",
        detail: { n: [1, { b: 2, a: 1 }] },
      });
      const { head } = gw.audit.verify();
      if (!head) throw new Error("no head");
      const lines = [...gw.audit.exportPages(2)].flat().map((e) => JSON.stringify(e));
      db.close();
      writeFileSync(join(dir, "verify-record.mjs"), script("verify-record.mjs"));
      writeFileSync(join(dir, "verify-export.mjs"), script("verify-export.mjs"));
      writeFileSync(join(dir, "record.jsonl"), `${lines.join("\n")}\n`);

      const fromDb = node(dir, ["verify-record.mjs", "steward.db"]);
      expect(fromDb.stdout.trim()).toBe(`Record intact: ${head.seq} entries verified.`);
      const exported = node(dir, ["verify-export.mjs", "record.jsonl", `${head.seq}:${head.hash}`]);
      expect(exported.stdout.trim()).toBe(
        `Export intact: ${head.seq} entries verified, and your seal matches.`,
      );
      expect(exported.status).toBe(0);

      const wrongSeal = node(dir, ["verify-export.mjs", "record.jsonl", `${head.seq}:${"0".repeat(64)}`]);
      expect(wrongSeal.status).toBe(1);
      expect(wrongSeal.stderr).toMatch(/does not have the seal you saved/);
      const edited = lines.map((l, i) => (i === 2 ? l.replace('"local"', '"someone"') : l));
      writeFileSync(join(dir, "edited.jsonl"), `${edited.join("\n")}\n`);
      const broken = node(dir, ["verify-export.mjs", "edited.jsonl"]);
      expect(broken.status).toBe(1);
      expect(broken.stderr).toMatch(/^Broken at entry 3\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
