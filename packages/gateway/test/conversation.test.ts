import type { Approval, GateCall, GateOutcome } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { canAllowInConversation, inConversationScope } from "../src/conversation.ts";
import { GatewayError } from "../src/errors.ts";
import { gateCall, setup } from "./helpers.ts";

function parked<T>(outcome: GateOutcome<T>): Approval {
  if (outcome.status !== "parked") throw new Error(`expected parked, got ${outcome.status}`);
  return outcome.approval;
}

/** An event with no guests on the person's calendar: a write that asks by default. */
const event = (over: Partial<GateCall> = {}, title = "Dentist") =>
  gateCall("calendar_create", { title, start: "2026-11-11T09:00:00Z", end: "2026-11-11T10:00:00Z" }, over);

const mail = (over: Partial<GateCall> = {}, body = "See you Friday.") =>
  gateCall("mail_send", { to: "sam@example.com", subject: "Re: Friday", body }, over);

/** Answers the first ask for `call` with Allow in this conversation, and resumes it. */
async function allowInConversation(gw: ReturnType<typeof setup>["gw"], call: GateCall) {
  const approval = parked(await gw.governance.execute(call, async () => null));
  expect(approval.canConversation).toBe(true);
  const decided = gw.approvals.decide(approval.id, "conversation", "local");
  const resumed = await gw.governance.resume(call, async () => "done");
  return { approval, decided, resumed };
}

describe("the scope checks", () => {
  const allow = { threadId: "thr_1", agentId: "steward" };
  it("hold only in their own conversation, with their own agent, for the person's runs", () => {
    const call = {
      threadId: "thr_1",
      agentId: "steward",
      initiator: { kind: "person" as const, id: "local" },
    };
    expect(inConversationScope(allow, call)).toBe(true);
    expect(inConversationScope(allow, { ...call, initiator: { kind: "resume", id: "apr_1" } })).toBe(true);
    expect(inConversationScope(allow, { ...call, threadId: "thr_2" })).toBe(false);
    expect(inConversationScope(allow, { ...call, agentId: "helper" })).toBe(false);
    for (const kind of ["routine", "task", "device", "system"] as const) {
      expect(inConversationScope(allow, { ...call, initiator: { kind, id: "x" } }), kind).toBe(false);
    }
    expect(inConversationScope(allow, { threadId: "thr_1", agentId: "steward" } as never)).toBe(false);
    expect(inConversationScope({ threadId: "", agentId: "steward" }, { ...call, threadId: "" })).toBe(false);
  });

  it("are offered only where Always allow is, for a person's run in a conversation", () => {
    const person = { kind: "person" as const, id: "local" };
    expect(canAllowInConversation({ canAlways: true, threadId: "thr_1", initiator: person })).toBe(true);
    expect(canAllowInConversation({ canAlways: false, threadId: "thr_1", initiator: person })).toBe(false);
    expect(canAllowInConversation({ canAlways: true, threadId: "", initiator: person })).toBe(false);
    expect(
      canAllowInConversation({ canAlways: true, threadId: "thr_1", initiator: { kind: "routine", id: "r" } }),
    ).toBe(false);
    expect(canAllowInConversation({ canAlways: true, threadId: "thr_1" })).toBe(false);
  });
});

describe("allow in this conversation", () => {
  it("allows the same again in this conversation, and nowhere else", async () => {
    const { gw } = setup();
    const { decided, resumed } = await allowInConversation(gw, event());
    expect(decided).toMatchObject({ status: "allowed", answer: "conversation" });
    expect(resumed).toMatchObject({
      status: "done",
      decision: {
        effect: "allow",
        rule: { source: "conversation" },
        reason: "You allowed this for this conversation",
      },
    });
    // No standing rule was written.
    expect(gw.rules.list().some((r) => r.source === "always")).toBe(false);
    const [allow] = gw.conversationAllows.forThread("thr_1");
    expect(allow).toMatchObject({ threadId: "thr_1", agentId: "steward", approvalId: decided.id });
    expect(decided.createdRuleId).toBe(allow?.id);

    // The same again here runs, and the record names the conversation allow.
    const again = event({}, "Dentist again");
    const next = await gw.governance.execute(again, async () => "made");
    expect(next).toMatchObject({
      status: "done",
      decision: { rule: { id: allow?.id, source: "conversation" } },
    });
    expect(gw.audit.forToolCall(again.toolCallId)[0]).toMatchObject({
      effect: "allow",
      rule: { id: allow?.id, source: "conversation" },
    });

    // Another conversation, another agent, or a routine in this one: still asks.
    expect((await gw.governance.execute(event({ threadId: "thr_2" }), async () => null)).status).toBe(
      "parked",
    );
    expect((await gw.governance.execute(event({ agentId: "helper" }), async () => null)).status).toBe(
      "parked",
    );
    const routine = event({ initiator: { kind: "routine", id: "rtn_1" } });
    expect((await gw.governance.execute(routine, async () => null)).status).toBe("parked");
    const phone = event({ initiator: { kind: "device", id: "dev_1" } });
    expect((await gw.governance.execute(phone, async () => null)).status).toBe("parked");
  });

  it("never lifts taint, the outbound check or an ask rule", async () => {
    const { gw } = setup();
    await allowInConversation(gw, mail());
    expect(gw.conversationAllows.forThread("thr_1")).toHaveLength(1);
    // The same send, untainted, runs; tainted, it asks, with no Always allow and no conversation allow.
    expect((await gw.governance.execute(mail({}, "Another note"), async () => "sent")).status).toBe("done");
    const tainted = parked(
      await gw.governance.execute(mail({ tainted: true }, "Tainted note"), async () => null),
    );
    expect(tainted.decision.rule?.id).toBe("default:taint");
    expect(tainted.canAlways).toBe(false);
    expect(tainted.canConversation).toBe(false);
    // Something sensitive in it asks too.
    const finding = parked(await gw.governance.execute(mail({}, "my NI is AB 12 34 56 C"), async () => null));
    expect(finding.decision.rule?.id).toBe("default:outbound-check");
    // And so does the person's own ask rule.
    gw.rules.create({
      name: "Ask before mail to Sam",
      effect: "ask",
      when: 'tool.name == "mail_send"',
      description: "",
      enabled: true,
      source: "person",
    });
    const asked = parked(await gw.governance.execute(mail({}, "Third note"), async () => null));
    expect(asked.decision.rule?.name).toBe("Ask before mail to Sam");
    expect(asked.canConversation).toBe(false);
  });

  it("is scoped like Always allow: other people still ask", async () => {
    const { gw } = setup();
    await allowInConversation(gw, mail());
    const other = gateCall("mail_send", { to: "eve@example.com", subject: "Hi", body: "Hello" });
    expect((await gw.governance.execute(other, async () => null)).status).toBe("parked");
  });

  it("is refused where it is not offered: a routine's ask, a payment, from a phone", async () => {
    const { gw } = setup();
    const routine = parked(
      await gw.governance.execute(event({ initiator: { kind: "routine", id: "rtn_1" } }), async () => null),
    );
    expect(routine.canAlways).toBe(true);
    expect(routine.canConversation).toBe(false);
    expect(() => gw.approvals.decide(routine.id, "conversation", "local")).toThrow(/not offered/);
    expect(gw.approvals.get(routine.id)?.status).toBe("pending");

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
    expect(pay.canConversation).toBe(false);
    expect(() => gw.approvals.decide(pay.id, "conversation", "local")).toThrow(GatewayError);

    const fromPhone = parked(await gw.governance.execute(event(), async () => null));
    expect(() =>
      gw.approvals.decide(fromPhone.id, "conversation", "local", undefined, {
        via: "device:dev_1",
        device: { id: "dev_1", name: "iPhone", kind: "app" },
        verified: "webauthn",
      }),
    ).toThrow(/on your Mac/);
    expect(gw.conversationAllows.forThread("thr_1")).toHaveLength(0);
  });

  it("is turned off on its own, or with its conversation, and the record says so", async () => {
    const { gw } = setup();
    await allowInConversation(gw, event());
    const [allow] = gw.conversationAllows.forThread("thr_1");
    if (!allow) throw new Error("no allow");
    expect(gw.conversationAllows.remove("thr_2", allow.id, "local")).toBe(false);
    expect(gw.conversationAllows.remove("thr_1", allow.id, "local")).toBe(true);
    expect((await gw.governance.execute(event({}, "After"), async () => null)).status).toBe("parked");

    await allowInConversation(gw, event({}, "Again"));
    expect(gw.conversationAllows.removeForThread("thr_1", "local")).toBe(1);
    expect(gw.conversationAllows.forThread("thr_1")).toHaveLength(0);

    const changes = gw.audit
      .page({ type: "policy.changed" })
      .events.filter((e) => e.rule?.source === "conversation")
      .map((e) => e.detail.change);
    expect(changes.sort()).toEqual(["created", "created", "removed", "removed"]);
    expect(gw.audit.verify().ok).toBe(true);
  });

  it("an approval answered for the conversation reads back as such", async () => {
    const { gw } = setup();
    const { approval } = await allowInConversation(gw, event());
    expect(gw.approvals.get(approval.id)).toMatchObject({ answer: "conversation", status: "allowed" });
    // Answering the same way twice is not an error; answering another way is.
    expect(gw.approvals.decide(approval.id, "conversation", "local").answer).toBe("conversation");
    expect(() => gw.approvals.decide(approval.id, "once", "local")).toThrow(GatewayError);
  });
});
