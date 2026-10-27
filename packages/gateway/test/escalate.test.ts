import { describe, expect, it } from "vitest";
import { escalateKind, kindForElementName } from "../src/escalate.ts";

describe("kindForElementName", () => {
  it.each([
    ["Pay now", "pay"],
    ["Buy now", "pay"],
    ["Place order", "pay"],
    ["Place your order", "pay"],
    ["Proceed to checkout", "pay"],
    ["Checkout", "pay"],
    ["Complete purchase", "pay"],
    ["Submit payment", "pay"],
    ["Subscribe", "pay"],
    ["Donate £10", "pay"],
    ["Transfer", "pay"],
    ["Send money", "pay"],
    ["Sign", "sign"],
    ["Sign here", "sign"],
    ["Agree and sign", "sign"],
    ["E-sign document", "sign"],
    ["Delete", "delete"],
    ["Delete account", "delete"],
    ["Remove from basket", "delete"],
    ["Move to trash", "delete"],
    ["Cancel subscription", "delete"],
    ["Close my account", "delete"],
    ["Unsubscribe", "delete"],
    ["Send", "send"],
    ["Submit", "send"],
    ["Post", "send"],
    ["Reply all", "send"],
    ["Publish", "send"],
  ])("%s → %s", (name, kind) => {
    expect(kindForElementName(name)).toBe(kind);
  });

  it.each([
    "Sign in",
    "Sign up",
    "Sign out",
    "Sign-in",
    "Signing in",
    "Design",
    "Payments history",
    "PayPal account overview",
    "Buying guide",
    "Postcode",
    "Posts",
    "Cancel",
    "Check out our blog",
    "Next",
    "Search",
    "",
  ])("%s → nothing", (name) => {
    expect(kindForElementName(name)).toBeUndefined();
  });
});

describe("escalateKind", () => {
  const send = { name: "Send" };

  it("escalates clicks on named elements", () => {
    expect(escalateKind("browser_click", { ref: "e4" }, { name: "Place order" })).toBe("pay");
    expect(escalateKind("browser_click", { ref: "e4" }, send)).toBe("send");
  });

  it("escalates Enter, but not other keys", () => {
    expect(escalateKind("browser_press", { key: "Enter" }, { name: "Reply" })).toBe("send");
    expect(escalateKind("browser_press", { key: "NumpadEnter" }, { name: "Reply" })).toBe("send");
    expect(escalateKind("browser_press", { key: "Tab" }, { name: "Reply" })).toBeUndefined();
  });

  it("escalates typing that submits, but not plain typing", () => {
    expect(
      escalateKind("browser_type", { ref: "e2", text: "On my way", submit: true }, { name: "Reply" }),
    ).toBe("send");
    expect(escalateKind("browser_type", { ref: "e2", text: "On my way" }, { name: "Reply" })).toBeUndefined();
  });

  it("leaves other tools and unnamed elements alone", () => {
    expect(escalateKind("browser_snapshot", {}, send)).toBeUndefined();
    expect(escalateKind("mail_send", {}, send)).toBeUndefined();
    expect(escalateKind("browser_click", { ref: "e4" }, undefined)).toBeUndefined();
    expect(escalateKind("browser_click", { ref: "e4" }, { name: "Read more" })).toBeUndefined();
  });
});
