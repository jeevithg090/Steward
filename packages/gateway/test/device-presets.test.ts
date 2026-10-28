import type { Approval, ApprovalDecider, GateCall, GateOutcome } from "@steward/shared";
import { describe, expect, it } from "vitest";
import {
  DEVICE_FLOOR_PRESET,
  DEVICE_PRESETS,
  DEVICE_TAINT_PRESET,
  deviceRefusal,
  GatewayError,
  PRESET_RULES,
} from "../src/index.ts";
import { gateCall, setup, spyAction } from "./helpers.ts";

function parked<T>(outcome: GateOutcome<T>): Approval {
  if (outcome.status !== "parked") throw new Error(`expected parked, got ${outcome.status}`);
  return outcome.approval;
}

const shortcut: ApprovalDecider = {
  via: "device:dev_1",
  device: { id: "dev_1", name: "Sam's iPhone", kind: "shortcut" },
};
const pwa: ApprovalDecider = {
  via: "device:dev_2",
  device: { id: "dev_2", name: "Sam's iPhone", kind: "pwa" },
};
const pwaFaceId: ApprovalDecider = { ...pwa, verified: "webauthn" };

const tool = (name: string, kind: GateCall["tool"]["kind"]): Partial<GateCall> => ({
  tool: { name, kind, surface: "mcp", source: `mcp:${name.split("__")[1]}` },
});

/** Calls that ask, one per case the presets judge. */
const calls = {
  pay: () => gateCall("mcp__shop__checkout", { total: "£40" }, tool("mcp__shop__checkout", "pay")),
  sign: () => gateCall("mcp__docs__sign", { doc: "lease.pdf" }, tool("mcp__docs__sign", "sign")),
  secret: () => gateCall("request_secret", { label: "Bank password", ref: "e3" }),
  send: () => gateCall("mail_send", { to: "sam@example.com", subject: "Hi", body: "See you." }),
  taintedSend: () =>
    gateCall("mail_send", { to: "sam@example.com", subject: "Hi", body: "See you." }, { tainted: true }),
  taintedDelete: () =>
    gateCall(
      "mcp__files__delete",
      { path: "notes.txt" },
      { tainted: true, ...tool("mcp__files__delete", "delete") },
    ),
};

async function ask(gw: ReturnType<typeof setup>["gw"], call: GateCall): Promise<Approval> {
  return parked(await gw.governance.execute(call, spyAction(null).act));
}

describe("device presets (pure)", () => {
  const facts = (kind: GateCall["tool"]["kind"], extra: Partial<Approval> = {}) => ({
    tool: { name: "x", kind, surface: "mcp" as const, source: "mcp:x" },
    ...extra,
  });

  it("never let a phone say yes to a payment, a signature or a password", () => {
    for (const by of [shortcut, pwa, pwaFaceId]) {
      expect(deviceRefusal(facts("pay"), "once", by)).toBe(DEVICE_FLOOR_PRESET);
      expect(deviceRefusal(facts("sign"), "once", by)).toBe(DEVICE_FLOOR_PRESET);
      expect(deviceRefusal(facts("write", { credentialEntry: true }), "once", by)).toBe(DEVICE_FLOOR_PRESET);
    }
  });

  it("keep tainted sends, deletes and commands off shortcuts, and need Face ID in the app", () => {
    for (const kind of ["send", "delete", "shell"] as const) {
      expect(deviceRefusal(facts(kind, { tainted: true }), "once", shortcut)).toBe(DEVICE_TAINT_PRESET);
      expect(deviceRefusal(facts(kind, { tainted: true }), "once", pwa)).toBe(DEVICE_TAINT_PRESET);
      expect(deviceRefusal(facts(kind, { tainted: true }), "once", pwaFaceId)).toBeUndefined();
      expect(deviceRefusal(facts(kind), "once", shortcut)).toBeUndefined();
    }
  });

  it("always let a phone refuse: a refusal never acts", () => {
    for (const kind of ["pay", "sign", "send", "shell"] as const) {
      expect(
        deviceRefusal(facts(kind, { tainted: true, credentialEntry: true }), "refuse", shortcut),
      ).toBeUndefined();
    }
  });

  it("are two, with stable ids, and are not switchable rules", () => {
    expect(DEVICE_PRESETS.map((p) => p.id)).toEqual(["preset_device_floor", "preset_shortcut_taint"]);
    const switchable = new Set(PRESET_RULES.map((r) => r.id));
    for (const p of DEVICE_PRESETS) expect(switchable.has(p.id)).toBe(false);
  });
});

describe("approvals answered from a device", () => {
  it("store whether the call was tainted or typed a secret", async () => {
    const { gw } = setup();
    expect((await ask(gw, calls.taintedSend())).tainted).toBe(true);
    expect((await ask(gw, calls.send())).tainted).toBe(false);
    expect((await ask(gw, calls.secret())).credentialEntry).toBe(true);
    expect((await ask(gw, calls.pay())).credentialEntry).toBe(false);
  });

  it("refuse a payment from a phone, record why, and leave it waiting for the Mac", async () => {
    const { gw } = setup();
    const approval = await ask(gw, calls.pay());
    let error: unknown;
    try {
      gw.approvals.decide(approval.id, "once", "local", undefined, shortcut);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ code: "forbidden", message: DEVICE_FLOOR_PRESET.phoneMessage });
    expect(gw.approvals.get(approval.id)?.status).toBe("pending");
    const refused = gw.audit.forToolCall(approval.toolCallId).find((e) => e.type === "device.refused");
    expect(refused).toMatchObject({
      effect: "deny",
      rule: { id: "preset_device_floor", source: "preset" },
      detail: { approvalId: approval.id, answer: "once", via: "device:dev_1", device: "Sam's iPhone" },
    });
    expect(gw.audit.verify().ok).toBe(true);
  });

  it("refuse signing and passwords from every kind of phone, even with Face ID", async () => {
    const { gw } = setup();
    for (const make of [calls.sign, calls.secret]) {
      const approval = await ask(gw, make());
      for (const by of [shortcut, pwaFaceId]) {
        expect(() => gw.approvals.decide(approval.id, "once", "local", undefined, by)).toThrow(
          DEVICE_FLOOR_PRESET.phoneMessage,
        );
      }
    }
  });

  it("let a phone refuse a payment, recorded with via", async () => {
    const { gw } = setup();
    const approval = await ask(gw, calls.pay());
    const decided = gw.approvals.decide(approval.id, "refuse", "local", undefined, shortcut);
    expect(decided.status).toBe("refused");
    const row = gw.audit.forToolCall(approval.toolCallId).find((e) => e.type === "approval.decided");
    expect(row?.detail).toMatchObject({ answer: "refuse", via: "device:dev_1", deviceKind: "shortcut" });
  });

  it("keep a tainted send off a shortcut but let the app say yes after Face ID", async () => {
    const { gw } = setup();
    const first = await ask(gw, calls.taintedSend());
    expect(() => gw.approvals.decide(first.id, "once", "local", undefined, shortcut)).toThrow(
      DEVICE_TAINT_PRESET.phoneMessage,
    );
    expect(() => gw.approvals.decide(first.id, "once", "local", undefined, pwa)).toThrow(
      DEVICE_TAINT_PRESET.phoneMessage,
    );
    const decided = gw.approvals.decide(first.id, "once", "local", undefined, pwaFaceId);
    expect(decided.status).toBe("allowed");
    const row = gw.audit.forToolCall(first.toolCallId).find((e) => e.type === "approval.decided");
    expect(row?.detail).toMatchObject({ via: "device:dev_2", verified: "webauthn" });

    const del = await ask(gw, calls.taintedDelete());
    expect(() => gw.approvals.decide(del.id, "once", "local", undefined, shortcut)).toThrow(GatewayError);
  });

  it("let a shortcut allow an untainted send once, and the resume acts exactly once", async () => {
    const { gw } = setup();
    const call = calls.send();
    const approval = await ask(gw, call);
    const decided = gw.approvals.decide(approval.id, "once", "local", undefined, shortcut);
    expect(decided.status).toBe("allowed");
    const spy = spyAction({ sent: true });
    expect((await gw.governance.resume(call, spy.act)).status).toBe("done");
    expect((await gw.governance.resume(call, spy.act)).status).toBe("refused");
    expect(spy.calls).toHaveLength(1);
  });

  it("never let a phone choose Always allow: standing rules are made on the Mac", async () => {
    const { gw } = setup();
    const approval = await ask(gw, calls.send());
    expect(approval.canAlways).toBe(true);
    expect(() => gw.approvals.decide(approval.id, "always", "local", undefined, shortcut)).toThrow(
      /on your Mac/,
    );
    expect(gw.rules.list().filter((r) => r.source === "always")).toHaveLength(0);
  });

  it("answer from the web exactly as before, with no via", async () => {
    const { gw } = setup();
    const approval = await ask(gw, calls.pay());
    gw.approvals.decide(approval.id, "once", "local");
    const row = gw.audit.forToolCall(approval.toolCallId).find((e) => e.type === "approval.decided");
    expect(row?.detail.via).toBeUndefined();
  });
});

describe("the phone preset on tool calls", () => {
  it("asks before a phone-started run sends, even with Always allow", async () => {
    const { gw } = setup();
    gw.rules.create({
      name: "Always allow mail to Sam",
      effect: "allow",
      when: 'tool.name == "mail_send"',
      description: "",
      enabled: true,
      source: "always",
    });
    const fromMac = await gw.governance.execute(calls.send(), spyAction(null).act);
    expect(fromMac.status).toBe("done");
    const fromPhone = await gw.governance.execute(
      gateCall(
        "mail_send",
        { to: "sam@example.com", subject: "Hi", body: "x" },
        { initiator: { kind: "device", id: "dev_1" } },
      ),
      spyAction(null).act,
    );
    expect(fromPhone.status).toBe("parked");
    expect(fromPhone.decision.rule?.id).toBe("preset_device_sends");
  });
});
