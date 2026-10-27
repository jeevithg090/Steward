import type { Approval, GateOutcome } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { GatewayError } from "../src/errors.ts";
import { gateCall, HOUR, setup, spyAction } from "./helpers.ts";

function parked<T>(outcome: GateOutcome<T>): Approval {
  if (outcome.status !== "parked") throw new Error(`expected parked, got ${outcome.status}`);
  return outcome.approval;
}

const mail = (body = "See you Friday.") =>
  gateCall("mail_send", { to: "sam@example.com", subject: "Re: Friday", body });

describe("execute", () => {
  it("acts on an allowed call and records decided then completed", async () => {
    const { gw } = setup();
    const call = gateCall("browser_snapshot");
    const spy = spyAction({ title: "Hacker News" });
    const outcome = await gw.governance.execute(call, spy.act);
    expect(outcome).toMatchObject({
      status: "done",
      result: { title: "Hacker News" },
      decision: { effect: "allow" },
    });
    expect(spy.calls).toHaveLength(1);
    const rows = gw.audit.forToolCall(call.toolCallId);
    expect(rows.map((r) => r.type)).toEqual(["tool.decided", "tool.completed"]);
    expect(rows[0]?.effect).toBe("allow");
    expect(rows[1]?.detail).toMatchObject({ preview: '{"title":"Hacker News"}' });
    expect(typeof rows[1]?.detail.durationMs).toBe("number");
  });

  it("records a failure and returns it", async () => {
    const { gw } = setup();
    const call = gateCall("browser_snapshot");
    const outcome = await gw.governance.execute(call, async () => {
      throw new Error("The page did not load");
    });
    expect(outcome).toMatchObject({ status: "failed", error: "The page did not load" });
    expect(gw.audit.forToolCall(call.toolCallId).map((r) => r.type)).toEqual(["tool.decided", "tool.failed"]);
  });

  it("refuses with a sentence that names the rule, and never acts", async () => {
    const { gw } = setup();
    gw.rules.create({
      name: "No shopping sites",
      effect: "deny",
      when: 'target.host == "shop.example"',
      description: "Shopping is off limits.",
      enabled: true,
      source: "person",
    });
    const spy = spyAction(null);
    const outcome = await gw.governance.execute(
      gateCall("browser_navigate", { url: "https://shop.example" }),
      spy.act,
    );
    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") return;
    expect(outcome.message).toBe(
      "Refused by the rule 'No shopping sites': Shopping is off limits. Tell the person; do not try another way around it.",
    );
    expect(spy.calls).toHaveLength(0);
  });

  it("parks a call that asks, with a plain summary, and tells the live listeners", async () => {
    const { gw, events } = setup();
    const call = mail();
    const spy = spyAction(null);
    const outcome = await gw.governance.execute(call, spy.act);
    const approval = parked(outcome);
    expect(spy.calls).toHaveLength(0);
    expect(approval).toMatchObject({
      toolCallId: call.toolCallId,
      status: "pending",
      summary: "Send an email to sam@example.com: 'Re: Friday'",
      canAlways: true,
      args: { to: "sam@example.com", subject: "Re: Friday", body: "See you Friday." },
    });
    expect(approval.expiresAt).toBe("2026-10-28T09:00:00.000Z");
    expect(events.some((e) => e.type === "approval.created" && e.approval.id === approval.id)).toBe(true);
    expect(gw.audit.forToolCall(call.toolCallId).map((r) => r.type)).toEqual([
      "tool.decided",
      "approval.requested",
    ]);
    if (outcome.status === "parked") expect(outcome.message).toContain("Waiting for the person's answer");
  });

  it("returns the same approval when the same call is executed twice, and refuses a changed one", async () => {
    const { gw } = setup();
    const call = mail();
    const first = parked(await gw.governance.execute(call, async () => null));
    const again = parked(await gw.governance.execute(call, async () => null));
    expect(again.id).toBe(first.id);
    const changed = await gw.governance.execute(
      { ...call, args: { ...call.args, to: "eve@example.com" } },
      async () => null,
    );
    expect(changed.status).toBe("refused");
    expect(gw.approvals.list()).toHaveLength(1);
  });

  it("does not offer Always allow for a tainted send, a payment or a finding", async () => {
    const { gw } = setup();
    const tainted = parked(await gw.governance.execute({ ...mail(), tainted: true }, async () => null));
    expect(tainted.canAlways).toBe(false);
    const pay = parked(
      await gw.governance.execute(
        gateCall(
          "browser_click",
          { ref: "e1" },
          { target: { host: "shop.example", element: { ref: "e1", name: "Pay now" } } },
        ),
        async () => null,
      ),
    );
    expect(pay.canAlways).toBe(false);
    expect(pay.tool.kind).toBe("pay");
    expect(pay.summary).toBe("Click 'Pay now' on shop.example");
    const finding = parked(await gw.governance.execute(mail("my NI is AB 12 34 56 C"), async () => null));
    expect(finding.canAlways).toBe(false);
    expect(finding.decision.findings[0]?.kind).toBe("national_id");
  });

  it("never stores or records what was typed into a password field", async () => {
    const { gw, db } = setup();
    const call = gateCall(
      "browser_type",
      { ref: "e2", text: "hunter2-secret" },
      {
        target: { host: "bank.example", element: { ref: "e2", role: "textbox", name: "Password" } },
      },
    );
    const approval = parked(await gw.governance.execute(call, async () => null));
    expect(approval.args).toEqual({ ref: "e2", text: "[redacted]" });
    expect(approval.summary).toBe("Type into 'Password' on bank.example");
    const everything = JSON.stringify([
      db.all("SELECT * FROM gateway_audit"),
      db.all("SELECT * FROM gateway_approvals"),
    ]);
    expect(everything).not.toContain("hunter2");
  });
});

describe("decide and resume", () => {
  it("allow once: the resume acts exactly once, and a second resume says already handled", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    gw.approvals.decide(approval.id, "once", "local");
    const spy = spyAction({ id: "msg_1" });
    const first = await gw.governance.resume(call, spy.act);
    expect(first).toMatchObject({
      status: "done",
      result: { id: "msg_1" },
      decision: { effect: "allow", rule: { id: "default:answer-once", source: "person" } },
    });
    const second = await gw.governance.resume(call, spy.act);
    expect(second.status).toBe("refused");
    if (second.status === "refused") expect(second.message).toMatch(/^Already handled\./);
    expect(spy.calls).toHaveLength(1);
    expect(gw.approvals.get(approval.id)?.claimedAt).toBeDefined();
    const types = gw.audit.forToolCall(call.toolCallId).map((r) => r.type);
    expect(types).toEqual([
      "tool.decided",
      "approval.requested",
      "approval.decided",
      "tool.decided",
      "tool.completed",
      "tool.decided",
    ]);
  });

  it("concurrent resumes: only one acts", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    gw.approvals.decide(approval.id, "once", "local");
    const spy = spyAction("sent");
    const outcomes = await Promise.all([1, 2, 3].map(() => gw.governance.resume(call, spy.act)));
    expect(outcomes.filter((o) => o.status === "done")).toHaveLength(1);
    expect(spy.calls).toHaveLength(1);
  });

  it("refuse: the resume does not act and relays the person's words", async () => {
    const { gw, events } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    const decided = gw.approvals.decide(approval.id, "refuse", "local", "Not to Sam, please.");
    expect(decided.status).toBe("refused");
    expect(events.some((e) => e.type === "approval.decided" && e.approval.id === approval.id)).toBe(true);
    const spy = spyAction(null);
    const outcome = await gw.governance.resume(call, spy.act);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.message).toMatch(/^The person refused this\./);
      expect(outcome.decision.rule).toMatchObject({ id: "default:answer-refused", source: "person" });
      expect(outcome.message).toContain('They said: "Not to Sam, please."');
    }
    expect(spy.calls).toHaveLength(0);
  });

  it("refuses a resume whose arguments changed after the answer", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    gw.approvals.decide(approval.id, "once", "local");
    const spy = spyAction(null);
    const tampered = { ...call, args: { ...call.args, to: "eve@example.com" } };
    const outcome = await gw.governance.resume(tampered, spy.act);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.message).toMatch(/changed after the person approved it/);
    expect(spy.calls).toHaveLength(0);
    // The answer was spent on the refused attempt; the original cannot use it afterwards either.
    expect((await gw.governance.resume(call, spy.act)).status).toBe("refused");
  });

  it("refuses a resume from another conversation", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    gw.approvals.decide(approval.id, "once", "local");
    const outcome = await gw.governance.resume({ ...call, threadId: "thr_other" }, async () => null);
    expect(outcome.status).toBe("refused");
  });

  it("refuses a resume for a call that never asked", async () => {
    const { gw } = setup();
    const outcome = await gw.governance.resume(gateCall("mail_send", { to: "a@b.com" }), async () => null);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.message).toMatch(/nothing was waiting/);
  });

  it("a resume before any answer cancels the request instead of leaving it to act later", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    const outcome = await gw.governance.resume(call, async () => null);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.message).toMatch(/moved on without answering/);
    expect(gw.approvals.get(approval.id)?.status).toBe("cancelled");
    expect(() => gw.approvals.decide(approval.id, "once", "local")).toThrow(/cancelled/);
  });

  it("a deny rule added while the person was deciding still wins", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    gw.approvals.decide(approval.id, "once", "local");
    gw.rules.create({
      name: "No mail today",
      effect: "deny",
      when: 'tool.name == "mail_send"',
      description: "",
      enabled: true,
      source: "person",
    });
    const spy = spyAction(null);
    const outcome = await gw.governance.resume(call, spy.act);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.message).toMatch(/^Refused by the rule 'No mail today'/);
    expect(spy.calls).toHaveLength(0);
  });

  it("answering the same way twice is fine; answering differently is a conflict", async () => {
    const { gw } = setup();
    const approval = parked(await gw.governance.execute(mail(), async () => null));
    gw.approvals.decide(approval.id, "once", "local");
    expect(gw.approvals.decide(approval.id, "once", "local").status).toBe("allowed");
    expect(() => gw.approvals.decide(approval.id, "refuse", "local")).toThrow(GatewayError);
    expect(() => gw.approvals.decide("apr_nope", "once", "local")).toThrow(/no approval/);
  });
});

describe("always allow", () => {
  it("writes a standing rule in the same answer, so the next identical send runs without asking", async () => {
    const { gw } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    const decided = gw.approvals.decide(approval.id, "always", "local");
    expect(decided.createdRuleId).toBeDefined();
    const rule = gw.rules.get(decided.createdRuleId ?? "");
    expect(rule).toMatchObject({ source: "always", effect: "allow", enabled: true });
    expect(rule?.when).toBe(
      'tool.name == "mail_send" && size(target.recipients) > 0 && target.recipients.all(r, r in ["sam@example.com"])',
    );
    expect(rule?.name).toBe("Always allow mail_send to sam@example.com");

    const resumed = await gw.governance.resume(call, async () => "sent");
    expect(resumed).toMatchObject({ status: "done", decision: { rule: { id: rule?.id, source: "always" } } });

    const next = await gw.governance.execute(mail("Another note"), async () => "sent again");
    expect(next).toMatchObject({ status: "done", decision: { rule: { id: rule?.id } } });
  });

  it("is scoped: a different recipient still asks, and so does the same one when tainted", async () => {
    const { gw } = setup();
    const approval = parked(await gw.governance.execute(mail(), async () => null));
    gw.approvals.decide(approval.id, "always", "local");
    const other = gateCall("mail_send", {
      to: ["sam@example.com", "eve@example.com"],
      subject: "x",
      body: "y",
    });
    expect(gw.governance.dryRun(other).effect).toBe("ask");
    expect(gw.governance.dryRun({ ...mail(), tainted: true }).effect).toBe("ask");
  });

  it("scopes shell commands to the exact command and clicks to the element and host", async () => {
    const { gw } = setup();
    const ls = gateCall("shell_run", { command: "ls -la" });
    gw.approvals.decide(parked(await gw.governance.execute(ls, async () => null)).id, "always", "local");
    expect(gw.governance.dryRun(gateCall("shell_run", { command: "ls -la" })).effect).toBe("allow");
    expect(gw.governance.dryRun(gateCall("shell_run", { command: "ls -la; cat ~/.ssh/id_rsa" })).effect).toBe(
      "ask",
    );

    const post = (host: string, name: string) =>
      gateCall("browser_click", { ref: "e3" }, { target: { host, element: { ref: "e3", name } } });
    gw.approvals.decide(
      parked(await gw.governance.execute(post("x.example", "Post"), async () => null)).id,
      "always",
      "local",
    );
    expect(gw.governance.dryRun(post("x.example", "Post")).effect).toBe("allow");
    expect(gw.governance.dryRun(post("x.example", "Delete post")).effect).toBe("ask");
    expect(gw.governance.dryRun(post("y.example", "Post")).effect).toBe("ask");
  });

  it("scopes MCP tools to the server", async () => {
    const { gw } = setup();
    const call = gateCall("mcp__github__create_issue", { title: "Bug" });
    const approval = parked(await gw.governance.execute(call, async () => null));
    const decided = gw.approvals.decide(approval.id, "always", "local");
    expect(gw.rules.get(decided.createdRuleId ?? "")?.when).toBe(
      'tool.name == "mcp__github__create_issue" && target.mcp.server == "github"',
    );
  });

  it("is refused when the ask came from the floor, taint, a finding or an ask rule, and writes no rule", async () => {
    const { gw } = setup();
    const before = gw.rules.list().length;
    const tainted = parked(await gw.governance.execute({ ...mail(), tainted: true }, async () => null));
    expect(() => gw.approvals.decide(tainted.id, "always", "local")).toThrow(/Always allow is not offered/);
    expect(gw.approvals.get(tainted.id)?.status).toBe("pending");

    gw.rules.create({
      name: "Ask about calendar",
      effect: "ask",
      when: 'tool.surface == "calendar"',
      description: "",
      enabled: true,
      source: "person",
    });
    const asked = parked(
      await gw.governance.execute(gateCall("calendar_create", { title: "x" }), async () => null),
    );
    expect(asked.canAlways).toBe(false);
    expect(() => gw.approvals.decide(asked.id, "always", "local")).toThrow(GatewayError);
    expect(gw.rules.list().filter((r) => r.source === "always")).toHaveLength(0);
    expect(gw.rules.list().length).toBe(before + 1);
  });

  it("is not offered when the call is too long to match exactly", async () => {
    const { gw } = setup();
    const command = `echo ${"x".repeat(2100)}`;
    const approval = parked(
      await gw.governance.execute(gateCall("shell_run", { command }), async () => null),
    );
    expect(approval.canAlways).toBe(false);
  });

  it("escapes awkward text in the rule it writes", async () => {
    const { gw } = setup();
    const command = 'echo "hi" \\ there';
    const approval = parked(
      await gw.governance.execute(gateCall("shell_run", { command }), async () => null),
    );
    gw.approvals.decide(approval.id, "always", "local");
    expect(gw.governance.dryRun(gateCall("shell_run", { command })).effect).toBe("allow");
    expect(gw.governance.dryRun(gateCall("shell_run", { command: 'echo "hi" there' })).effect).toBe("ask");
  });
});

describe("expiry", () => {
  it("expires pending approvals after the default 24 hours", async () => {
    const { gw, advance, events } = setup();
    const call = mail();
    const approval = parked(await gw.governance.execute(call, async () => null));
    advance(23 * HOUR);
    expect(gw.approvals.expireDue()).toBe(0);
    advance(2 * HOUR);
    expect(gw.approvals.expireDue()).toBe(1);
    expect(gw.approvals.get(approval.id)?.status).toBe("expired");
    expect(events.some((e) => e.type === "approval.decided" && e.approval.status === "expired")).toBe(true);
    expect(gw.audit.forToolCall(call.toolCallId).map((r) => r.type)).toContain("approval.expired");
    expect(() => gw.approvals.decide(approval.id, "once", "local")).toThrow(/expired/);
    const outcome = await gw.governance.resume(call, async () => null);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.message).toMatch(/^This request expired\./);
  });

  it("answering after expiry fails even if nobody swept", async () => {
    const { gw, advance } = setup({ expiryHours: 1 });
    const approval = parked(await gw.governance.execute(mail(), async () => null));
    advance(2 * HOUR);
    expect(() => gw.approvals.decide(approval.id, "once", "local")).toThrow(/expired/);
    expect(gw.approvals.get(approval.id)?.status).toBe("expired");
  });

  it("lists only what is still pending", async () => {
    const { gw, advance } = setup({ expiryHours: () => 1 });
    parked(await gw.governance.execute(mail(), async () => null));
    expect(gw.approvals.list({ status: "pending" })).toHaveLength(1);
    advance(2 * HOUR);
    expect(gw.approvals.list({ status: "pending" })).toHaveLength(0);
    expect(gw.approvals.list({ status: "expired" })).toHaveLength(1);
  });
});

describe("waitFor", () => {
  it("resolves when the person answers", async () => {
    const { gw } = setup();
    const approval = parked(await gw.governance.execute(mail(), async () => null));
    const waiting = gw.approvals.waitFor(approval.id);
    setTimeout(() => gw.approvals.decide(approval.id, "once", "local"), 5);
    expect((await waiting).status).toBe("allowed");
  });

  it("resolves at once for an answered approval and with the pending one on timeout", async () => {
    const { gw } = setup();
    const approval = parked(await gw.governance.execute(mail(), async () => null));
    expect((await gw.approvals.waitFor(approval.id, { timeoutMs: 5 })).status).toBe("pending");
    gw.approvals.decide(approval.id, "refuse", "local");
    expect((await gw.approvals.waitFor(approval.id)).status).toBe("refused");
  });

  it("stops waiting when aborted", async () => {
    const { gw } = setup();
    const approval = parked(await gw.governance.execute(mail(), async () => null));
    const controller = new AbortController();
    const waiting = gw.approvals.waitFor(approval.id, { signal: controller.signal });
    controller.abort(new Error("gone"));
    await expect(waiting).rejects.toThrow("gone");
  });
});

describe("dryRun", () => {
  it("decides without writing anything", () => {
    const { gw, db } = setup();
    const before = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM gateway_audit")?.n;
    const d = gw.governance.dryRun(mail());
    expect(d.effect).toBe("ask");
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM gateway_audit")?.n).toBe(before);
    expect(gw.approvals.list()).toHaveLength(0);
  });
});
