import { describe, expect, it } from "vitest";
import { prepareCall } from "../src/policy.ts";
import { summarize } from "../src/summary.ts";
import { completeTarget, deriveTarget, gateCallFor, hostOf, normaliseKind, toolInfo } from "../src/target.ts";
import { gateCall } from "./helpers.ts";

function sentence(name: string, args: Record<string, unknown> = {}, target = {}) {
  const call = prepareCall(gateCall(name, args, { target }));
  return summarize({ tool: call.tool, args: call.args, target: call.target, hidden: call.hiddenArgs });
}

describe("summarize", () => {
  it.each([
    [
      "mail_send",
      { to: "sam@example.com", subject: "Re: Friday", body: "x" },
      {},
      "Send an email to sam@example.com: 'Re: Friday'",
    ],
    [
      "mail_send",
      { to: ["a@x.com", "b@x.com", "c@x.com"], subject: "Plan" },
      {},
      "Send an email to a@x.com and 2 others: 'Plan'",
    ],
    ["shell_run", { command: "ls -la" }, {}, "Run a command: ls -la"],
    [
      "browser_click",
      { ref: "e9" },
      { host: "shop.example.com", element: { ref: "e9", name: "Place order" } },
      "Click 'Place order' on shop.example.com",
    ],
    ["browser_click", { ref: "e9" }, { element: { ref: "e9" } }, "Click an element (e9)"],
    [
      "browser_type",
      { ref: "e2", text: "On my way", submit: true },
      { host: "chat.example", element: { ref: "e2", name: "Reply" } },
      "Type 'On my way' into 'Reply' on chat.example and press Enter",
    ],
    [
      "browser_type",
      { ref: "e5", text: "SAVE10", submit: true },
      {
        host: "shop.example",
        element: { ref: "e5", name: "Promo code", submitter: { role: "button", name: "Place order" } },
      },
      "Type 'SAVE10' into 'Promo code' on shop.example and press Enter, which clicks 'Place order'",
    ],
    [
      "browser_press",
      { key: "Enter" },
      { host: "shop.example", element: { ref: "", name: "Place order", submitter: { name: "Place order" } } },
      "Press Enter in 'Place order' on shop.example",
    ],
    ["browser_navigate", { url: "https://news.ycombinator.com" }, {}, "Open https://news.ycombinator.com"],
    [
      "calendar_create",
      { title: "Lunch", start: "2026-10-31T12:30:00Z", attendees: ["kim@example.com"] },
      {},
      "Add 'Lunch' to your calendar on 2026-10-31 at 12:30 and invite kim@example.com",
    ],
    ["web_search", { query: "train times" }, {}, "Search the web for 'train times'"],
    ["file_write", { path: "report.md", content: "..." }, {}, "Save report.md"],
    ["mcp__github__create_issue", { title: "Bug" }, {}, "Use create_issue on github"],
    [
      "request_secret",
      { ref: "e4", label: "Password for bank.example" },
      { host: "bank.example" },
      "Ask you for 'Password for bank.example' on bank.example",
    ],
    ["something_new", {}, {}, "Use something_new"],
  ])("%s", (name, args, target, expected) => {
    expect(sentence(name, args, target)).toBe(expected);
  });

  it("never repeats text typed into a password field", () => {
    expect(
      sentence(
        "browser_type",
        { ref: "e2", text: "hunter2" },
        { host: "bank.example", element: { ref: "e2", name: "Password" } },
      ),
    ).toBe("Type into 'Password' on bank.example");
  });

  it("collapses whitespace and shortens long subjects", () => {
    const s = sentence("mail_send", { to: "a@x.com", subject: `Line\n\n${"word ".repeat(40)}` });
    expect(s).not.toContain("\n");
    expect(s.endsWith("…'")).toBe(true);
  });
});

describe("targets", () => {
  it("reads host, path, command, recipients and amount from arguments", () => {
    expect(
      deriveTarget("mail_send", {
        to: "Sam <SAM@example.com>, kim@example.com",
        cc: [{ name: "Lee", email: "lee@example.com" }],
      }).recipients,
    ).toEqual(["sam@example.com", "kim@example.com", "lee@example.com"]);
    expect(deriveTarget("web_fetch", { url: "https://Docs.Example.com:8080/a?b=c" })).toEqual({
      url: "https://Docs.Example.com:8080/a?b=c",
      host: "docs.example.com",
    });
    expect(deriveTarget("x", { amount: { value: 1299, currency: "gbp" } }).amount).toEqual({
      value: 1299,
      currency: "GBP",
    });
    expect(deriveTarget("mcp__slack__post_message", {}).mcp).toEqual({
      server: "slack",
      tool: "post_message",
    });
  });

  it("prefers the caller's target and only fills gaps", () => {
    const t = completeTarget(
      "browser_click",
      { url: "https://ignored.example" },
      { host: "Page.Example", element: { ref: "e1", name: "Go" } },
    );
    expect(t.host).toBe("page.example");
    expect(t.element).toEqual({ ref: "e1", name: "Go" });
  });

  it("knows hosts and kinds", () => {
    expect(hostOf("not a url")).toBe("");
    expect(normaliseKind("teleport")).toBe("write");
    expect(toolInfo("mcp__notion__search", { kind: "read" })).toMatchObject({
      kind: "read",
      surface: "mcp",
      source: "mcp:notion",
    });
    expect(toolInfo("mcp__notion__delete", {})).toMatchObject({ kind: "write" });
  });

  it("builds a whole call for the dry-run tester", () => {
    const call = gateCallFor({ tool: "mail_send", args: { to: "sam@example.com" }, initiator: "routine" });
    expect(call).toMatchObject({
      toolCallId: "dry-run",
      tool: { name: "mail_send", kind: "send", surface: "mail", source: "builtin" },
      target: { recipients: ["sam@example.com"] },
      initiator: { kind: "routine", id: "" },
      tainted: false,
    });
  });
});
