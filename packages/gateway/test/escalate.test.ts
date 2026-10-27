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
    expect(escalateKind("browser_press", { key: "Tab" }, undefined)).toBeUndefined();
    expect(escalateKind("browser_press", { key: "+" }, undefined)).toBeUndefined();
    expect(escalateKind("browser_press", { key: "Shift++" }, undefined)).toBeUndefined();
  });

  it("escalates Space, which presses a focused button, and Enter with modifiers", () => {
    const order = { name: "Place order" };
    for (const key of [" ", "Space", "space", "Spacebar", "Control+Enter", "Meta+Enter", "Shift+Space"]) {
      expect(escalateKind("browser_press", { key }, order), key).toBe("pay");
    }
  });

  it("judges a key press by the control it activates, not just the focused field", () => {
    const promo = { name: "Promo code", submitter: { role: "button", name: "Place order" } };
    expect(escalateKind("browser_press", { key: "Enter" }, promo)).toBe("pay");
    expect(escalateKind("browser_type", { ref: "e2", text: "SAVE10", submit: true }, promo)).toBe("pay");
    expect(escalateKind("browser_press", { key: "Tab" }, promo)).toBeUndefined();
    expect(escalateKind("browser_type", { ref: "e2", text: "SAVE10" }, promo)).toBeUndefined();
    // A harmless submitter does not hide a field named like a send.
    expect(
      escalateKind("browser_press", { key: "Enter" }, { name: "Reply", submitter: { name: "Go" } }),
    ).toBe("send");
    // The stricter of the two wins.
    expect(
      escalateKind("browser_press", { key: "Enter" }, { name: "Message", submitter: { name: "Delete" } }),
    ).toBe("delete");
    expect(
      escalateKind("browser_press", { key: "Enter" }, { name: "Search", submitter: { name: "Search" } }),
    ).toBeUndefined();
  });

  it("fails closed: Enter or Space with nothing named is at least a send", () => {
    expect(escalateKind("browser_press", { key: "Enter" }, undefined)).toBe("send");
    expect(escalateKind("browser_press", { key: " " }, { name: "  " })).toBe("send");
    expect(escalateKind("browser_press", { key: "Enter" }, { submitter: {} })).toBe("send");
    expect(escalateKind("browser_type", { ref: "e2", text: "x", submit: true }, undefined)).toBe("send");
    // A named submitter or field is judged as usual.
    expect(
      escalateKind("browser_press", { key: "Enter" }, { submitter: { name: "Search" } }),
    ).toBeUndefined();
    expect(escalateKind("browser_press", { key: "Enter" }, { submitter: { name: "Pay now" } })).toBe("pay");
    expect(
      escalateKind("browser_type", { ref: "e2", text: "x", submit: true }, { name: "Search" }),
    ).toBeUndefined();
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
