import type { GateCall } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { gateCall, setup } from "./helpers.ts";

/** A fresh gateway with the presets, plus whatever person rules a test adds. */
function gateway() {
  return setup().gw;
}

function addRule(
  gw: ReturnType<typeof gateway>,
  effect: "allow" | "ask" | "deny",
  when: string,
  name = `${effect} rule`,
) {
  return gw.rules.create({ name, effect, when, description: "", enabled: true, source: "person" });
}

const decide = (gw: ReturnType<typeof gateway>, call: GateCall) => gw.governance.dryRun(call);

describe("defaults by kind", () => {
  const gw = gateway();
  for (const p of gw.rules.presets()) gw.rules.update(p.id, { enabled: false });

  it.each([
    ["browser_snapshot", {}, "allow", "default:read-runs"],
    ["show_table", {}, "allow", "default:ui-runs"],
    ["browser_click", { ref: "e1" }, "allow", "default:write-runs"],
    ["file_write", { path: "notes.md", content: "x" }, "allow", "default:write-runs"],
    ["memory_remember", { text: "likes tea" }, "allow", "default:write-runs"],
    ["task_create", { title: "x" }, "allow", "default:write-runs"],
    ["calendar_create", { title: "Lunch" }, "ask", "default:write-asks"],
    ["mcp__notion__create_page", {}, "ask", "default:write-asks"],
    ["mail_send", { to: "sam@example.com", subject: "Hi", body: "Hello" }, "ask", "default:send-asks"],
    ["shell_run", { command: "ls" }, "ask", "default:shell-asks"],
  ])("%s → %s (%s)", (name, args, effect, ruleId) => {
    const d = decide(gw, gateCall(name, args));
    expect(d.effect).toBe(effect);
    expect(d.rule?.id).toBe(ruleId);
    expect(d.reason.length).toBeGreaterThan(10);
  });

  it("treats an unknown tool as a write, whatever kind the caller claims", () => {
    const call = gateCall(
      "mystery_tool",
      {},
      { tool: { name: "mystery_tool", kind: "read", surface: "web", source: "x" } },
    );
    const d = decide(gw, call);
    expect(d.effect).toBe("ask");
    expect(d.rule?.id).toBe("default:write-asks");
  });

  it("takes a built-in tool's kind from the catalogue, not the caller", () => {
    const call = gateCall(
      "mail_send",
      { to: "a@b.com" },
      {
        tool: { name: "mail_send", kind: "read", surface: "web", source: "builtin" },
      },
    );
    expect(decide(gw, call).rule?.id).toBe("default:send-asks");
  });
});

describe("precedence", () => {
  it("deny rules beat everything, including allow rules", () => {
    const gw = gateway();
    addRule(gw, "allow", 'tool.name == "browser_navigate"', "Allow all browsing");
    addRule(gw, "deny", 'target.host == "evil.example"', "No evil");
    const d = decide(gw, gateCall("browser_navigate", { url: "https://evil.example/x" }));
    expect(d.effect).toBe("deny");
    expect(d.rule?.name).toBe("No evil");
  });

  it("the safety floor beats allow rules: payments always ask", () => {
    const gw = gateway();
    addRule(gw, "allow", "true", "Allow everything");
    const d = decide(
      gw,
      gateCall(
        "browser_click",
        { ref: "e9" },
        { target: { host: "shop.example", element: { ref: "e9", name: "Place order" } } },
      ),
    );
    expect(d.effect).toBe("ask");
    expect(d.rule?.id).toBe("default:floor-pay");
  });

  it("the safety floor covers secrets: request_secret and typing into a password field", () => {
    const gw = gateway();
    addRule(gw, "allow", "true", "Allow everything");
    expect(decide(gw, gateCall("request_secret", { ref: "e2", label: "Password" })).rule?.id).toBe(
      "default:floor-credential",
    );
    const typing = gateCall(
      "browser_type",
      { ref: "e2", text: "hunter2" },
      {
        target: { host: "bank.example", element: { ref: "e2", role: "textbox", name: "Password" } },
      },
    );
    expect(decide(gw, typing).rule?.id).toBe("default:floor-credential");
  });

  it("deny rules still beat the safety floor", () => {
    const gw = gateway();
    addRule(gw, "deny", 'tool.kind == "pay"', "Never pay");
    const d = decide(
      gw,
      gateCall("browser_click", { ref: "e9" }, { target: { element: { ref: "e9", name: "Buy now" } } }),
    );
    expect(d.effect).toBe("deny");
  });

  it("taint beats allow rules for send, delete and shell", () => {
    const gw = gateway();
    addRule(gw, "allow", 'tool.name == "mail_send"', "Mail freely");
    addRule(gw, "allow", 'tool.name == "shell_run"', "Shell freely");
    const send = gateCall("mail_send", { to: "sam@example.com", body: "hi" });
    expect(decide(gw, send).effect).toBe("allow");
    expect(decide(gw, { ...send, tainted: true }).rule?.id).toBe("default:taint");
    expect(decide(gw, gateCall("shell_run", { command: "ls" }, { tainted: true })).rule?.id).toBe(
      "default:taint",
    );
  });

  it("taint does not touch reads or Steward's own writes", () => {
    const gw = gateway();
    expect(decide(gw, gateCall("web_fetch", { url: "https://a.example" }, { tainted: true })).effect).toBe(
      "allow",
    );
    expect(decide(gw, gateCall("file_write", { path: "a.md" }, { tainted: true })).effect).toBe("allow");
  });

  it("outbound findings beat allow rules and carry the findings", () => {
    const gw = gateway();
    addRule(gw, "allow", 'tool.name == "mail_send"', "Mail freely");
    const d = decide(gw, gateCall("mail_send", { to: "sam@example.com", body: "Card 4242 4242 4242 4242" }));
    expect(d.effect).toBe("ask");
    expect(d.rule?.id).toBe("default:outbound-check");
    expect(d.findings).toEqual([{ kind: "card_number", hint: "•••• 4242", label: "A card number" }]);
    expect(d.reason).toContain("a card number");
  });

  it("ask rules beat allow rules", () => {
    const gw = gateway();
    addRule(gw, "allow", 'tool.surface == "calendar"', "Calendar freely");
    addRule(
      gw,
      "ask",
      'tool.name == "calendar_create" && size(target.recipients) > 0',
      "Ask before inviting",
    );
    expect(decide(gw, gateCall("calendar_create", { title: "Focus" })).effect).toBe("allow");
    const invite = decide(
      gw,
      gateCall("calendar_create", { title: "Lunch", attendees: ["kim@example.com"] }),
    );
    expect(invite.effect).toBe("ask");
    expect(invite.rule?.name).toBe("Ask before inviting");
  });

  it("allow rules beat the defaults", () => {
    const gw = gateway();
    addRule(gw, "allow", 'tool.name == "calendar_create"', "Calendar freely");
    const d = decide(gw, gateCall("calendar_create", { title: "Focus" }));
    expect(d.effect).toBe("allow");
    expect(d.rule).toMatchObject({ name: "Calendar freely", source: "person" });
  });

  it("switched-off rules are skipped", () => {
    const gw = gateway();
    const rule = addRule(gw, "deny", 'tool.name == "browser_snapshot"', "No snapshots");
    expect(decide(gw, gateCall("browser_snapshot")).effect).toBe("deny");
    gw.rules.update(rule.id, { enabled: false });
    expect(decide(gw, gateCall("browser_snapshot")).effect).toBe("allow");
  });

  it("follows the full order on one call", () => {
    // A tainted send with a card number that a deny, an ask and an allow rule all match: deny wins;
    // remove it and taint wins; and so on down the list.
    const gw = gateway();
    const call = gateCall(
      "mail_send",
      { to: "sam@example.com", body: "4242 4242 4242 4242" },
      { tainted: true },
    );
    const deny = addRule(gw, "deny", 'tool.name == "mail_send"', "D");
    addRule(gw, "ask", 'tool.name == "mail_send"', "A");
    addRule(gw, "allow", 'tool.name == "mail_send"', "L");
    expect(decide(gw, call).rule?.name).toBe("D");
    gw.rules.remove(deny.id);
    expect(decide(gw, call).rule?.id).toBe("default:taint");
    expect(decide(gw, { ...call, tainted: false }).rule?.id).toBe("default:outbound-check");
    expect(
      decide(gw, { ...call, tainted: false, args: { to: "sam@example.com", body: "hi" } }).rule?.name,
    ).toBe("A");
  });
});

describe("fail closed", () => {
  it("a rule that throws refuses the call and names itself", () => {
    const gw = gateway();
    // Valid when saved (neutral context), but compares text with a number for shell calls.
    addRule(gw, "deny", 'tool.kind == "shell" && target.command > 3', "Broken shell rule");
    const d = decide(gw, gateCall("shell_run", { command: "ls" }));
    expect(d.effect).toBe("deny");
    expect(d.rule?.name).toBe("Broken shell rule");
    expect(d.reason).toMatch(/could not be checked .*different kinds/);
    // Calls the broken half never reaches are unaffected.
    expect(decide(gw, gateCall("browser_snapshot")).effect).toBe("allow");
  });

  it("a broken allow rule refuses rather than silently allowing or skipping", () => {
    const gw = gateway();
    addRule(gw, "allow", 'tool.name == "calendar_create" && target.amount.value > "x"', "Broken allow");
    const d = decide(gw, gateCall("calendar_create", { title: "x" }));
    expect(d.effect).toBe("deny");
    expect(d.rule?.name).toBe("Broken allow");
  });

  it("a rule edited into a broken state in the database refuses too", () => {
    const { gw, db } = setup();
    const rule = addRule(gw, "deny", 'tool.name == "x"', "Will break");
    db.run("UPDATE gateway_rules SET cel = ? WHERE id = ?", ["tool.name ==", rule.id]);
    const d = decide(gw, gateCall("browser_snapshot"));
    expect(d.effect).toBe("deny");
    expect(d.reason).toMatch(/'Will break' could not be checked/);
  });

  it("a call that cannot be checked is refused", () => {
    const gw = gateway();
    const d = decide(gw, gateCall("mail_send", { to: "a@b.com", body: "x".repeat(2_100_000) }));
    expect(d.effect).toBe("deny");
    expect(d.rule?.id).toBe("default:error");
  });
});

describe("escalation and targets", () => {
  it("a click on Send is judged as a send", () => {
    const gw = gateway();
    const d = decide(
      gw,
      gateCall(
        "browser_click",
        { ref: "e7" },
        { target: { host: "mail.example", element: { ref: "e7", name: "Send" } } },
      ),
    );
    expect(d.effect).toBe("ask");
    expect(d.rule?.id).toBe("default:send-asks");
  });

  it("rules see the escalated kind", () => {
    const gw = gateway();
    addRule(gw, "deny", 'tool.kind == "delete" && target.host == "github.com"', "No deleting on GitHub");
    const d = decide(
      gw,
      gateCall(
        "browser_click",
        { ref: "e1" },
        {
          target: {
            url: "https://github.com/me/repo/settings",
            element: { ref: "e1", name: "Delete this repository" },
          },
        },
      ),
    );
    expect(d.rule?.name).toBe("No deleting on GitHub");
  });

  it("fills the host from a URL argument when the caller left the target empty", () => {
    const gw = gateway();
    addRule(gw, "deny", 'target.host == "blocked.example"', "Blocked");
    expect(decide(gw, gateCall("web_fetch", { url: "https://Blocked.Example:8443/a" })).effect).toBe("deny");
  });

  it("fills recipients from to, cc and bcc", () => {
    const gw = gateway();
    addRule(gw, "deny", '"boss@example.com" in target.recipients', "Never mail the boss");
    const d = decide(
      gw,
      gateCall("mail_send", { to: "Sam <sam@example.com>", bcc: [{ email: "Boss@Example.com" }] }),
    );
    expect(d.rule?.name).toBe("Never mail the boss");
  });

  it("lets a routine be treated differently from a person", () => {
    const gw = gateway();
    addRule(
      gw,
      "deny",
      'initiator.kind == "routine" && tool.surface == "browser"',
      "Routines stay off the web",
    );
    expect(decide(gw, gateCall("browser_snapshot")).effect).toBe("allow");
    expect(
      decide(gw, gateCall("browser_snapshot", {}, { initiator: { kind: "routine", id: "rtn_1" } })).effect,
    ).toBe("deny");
  });
});
