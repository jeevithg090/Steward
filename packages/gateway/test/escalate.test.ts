import { describe, expect, it } from "vitest";
import { escalateKind, kindForElementName } from "../src/escalate.ts";
import { gateCall, setup } from "./helpers.ts";

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
    ["Book now", "pay"],
    ["Book", "pay"],
    ["Book a table", "pay"],
    ["Reserve", "pay"],
    ["Reserve now", "pay"],
    ["Confirm booking", "pay"],
    ["Confirm reservation", "pay"],
    ["Order now", "pay"],
    ["Pre-order", "pay"],
    ["Place bid", "pay"],
    ["Bid now", "pay"],
    ["Start free trial", "pay"],
    ["Start my trial", "pay"],
    ["Upgrade to Pro", "pay"],
    ["Renew subscription", "pay"],
    ["Top up", "pay"],
    ["Top-up £20", "pay"],
    ["Withdraw funds", "pay"],
    ["Sell", "pay"],
    ["Sell now", "pay"],
    ["I agree", "sign"],
    ["I accept", "sign"],
    ["Agree and continue", "sign"],
    ["Agree to the terms", "sign"],
    ["Accept terms", "sign"],
    ["Accept the terms and conditions", "sign"],
    ["Accept and continue", "sign"],
    ["Share", "send"],
    ["Share post", "send"],
    ["Invite", "send"],
    ["Invite people", "send"],
    ["Forward", "send"],
    ["Comment", "send"],
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
    "Bookmarks",
    "Address book",
    "Facebook",
    "Reservations",
    "Share screen",
    "Share your screen",
    "Shared with me",
    "Accept all cookies",
    "Accept cookies",
    "Accept",
    "Disagree",
    "User agreement",
    "Fast forward",
    "Skip forward",
    "Comments (12)",
    "Invited",
    "Renewal date",
    "Withdrawal history",
    "Sellers",
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

  it("leaves other tools, links and harmless buttons alone", () => {
    expect(escalateKind("browser_snapshot", {}, send)).toBeUndefined();
    expect(escalateKind("mail_send", {}, send)).toBeUndefined();
    expect(escalateKind("browser_click", { ref: "e4" }, undefined)).toBeUndefined();
    expect(escalateKind("browser_click", { ref: "e4" }, { name: "Read more" })).toBeUndefined();
    expect(escalateKind("browser_click", { ref: "e4" }, { role: "button", name: "Next" })).toBeUndefined();
    expect(escalateKind("browser_click", { ref: "e4" }, { role: "link", name: "" })).toBeUndefined();
  });

  it("fails closed: a click on a button nobody can name is at least a send", () => {
    expect(escalateKind("browser_click", { ref: "e4" }, { role: "button", name: "" })).toBe("send");
    expect(escalateKind("browser_click", { ref: "e4" }, { role: "button" })).toBe("send");
    // A name with no letters or numbers says nothing.
    expect(escalateKind("browser_click", { ref: "e4" }, { role: "button", name: "→" })).toBe("send");
    expect(escalateKind("browser_press", { key: "Enter" }, { name: "»" })).toBe("send");
  });

  it("a submitter the computer found but could not name commits, whatever the field is called", () => {
    const promo = { name: "Promo code", submitter: {} };
    expect(escalateKind("browser_press", { key: "Enter" }, promo)).toBe("send");
    expect(escalateKind("browser_type", { ref: "e2", text: "SAVE10", submit: true }, promo)).toBe("send");
    expect(escalateKind("browser_press", { key: "Enter" }, { name: "Delete account", submitter: {} })).toBe(
      "delete",
    );
    // A click the computer reports as submitting a form is judged by that form's button too.
    expect(
      escalateKind(
        "browser_click",
        { ref: "e4" },
        { role: "button", name: "Go", submitter: { name: "Pay" } },
      ),
    ).toBe("pay");
    expect(escalateKind("browser_click", { ref: "e4" }, { role: "button", name: "Go", submitter: {} })).toBe(
      "send",
    );
  });
});

describe("escalation in the gateway", () => {
  const { gw } = setup();
  const checkout = { host: "shop.example", url: "https://shop.example/checkout" };
  const click = (element: { role?: string; name?: string }) =>
    gw.governance.dryRun(
      gateCall(
        "browser_click",
        { ref: "e4" },
        { tainted: true, target: { ...checkout, element: { ref: "e4", ...element } } },
      ),
    );

  it("after untrusted content, booking pays, agreeing signs and an unnamed button asks", () => {
    expect(click({ role: "button", name: "Book now" }).rule?.id).toBe("default:floor-pay");
    expect(click({ role: "button", name: "Reserve" }).rule?.id).toBe("default:floor-pay");
    expect(click({ role: "button", name: "Accept and continue" }).rule?.id).toBe("default:taint");
    expect(click({ role: "button" }).rule?.id).toBe("default:taint");
  });

  it("ordinary clicks still run", () => {
    expect(click({ role: "link", name: "Bookmarks" }).effect).toBe("allow");
    expect(click({ role: "button", name: "Accept all cookies" }).effect).toBe("allow");
    expect(click({ role: "link" }).effect).toBe("allow");
  });
});
