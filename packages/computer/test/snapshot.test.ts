import { describe, expect, it } from "vitest";
import {
  type AriaItem,
  cutAtCodeUnits,
  indexRefs,
  MASKED_VALUE,
  RefBook,
  renderSnapshot,
  toAriaItems,
  valueFieldRefs,
} from "../src/snapshot.ts";

/** Shaped like Playwright 1.64's `ariaSnapshotJSON({ mode: "ai" })` output. */
const FORM: unknown = [
  {
    role: "generic",
    active: true,
    ref: "e1",
    children: [
      { role: "heading", name: "Sign in", level: 1, ref: "e2" },
      {
        role: "generic",
        ref: "e3",
        children: ["Name", { role: "textbox", name: "Name", ref: "e4", text: "Ada" }],
      },
      { role: "textbox", name: "Pass", ref: "e5", text: "hunter2" },
      {
        role: "combobox",
        name: "Size",
        ref: "e6",
        children: [
          { role: "option", name: "Small" },
          { role: "option", name: "Large", selected: true },
        ],
      },
      { role: "checkbox", name: "Bacon", ref: "e7", checked: true },
      { role: "link", name: "Help", ref: "e8", cursor: "pointer", url: "/help" },
      { role: "button", name: "Off", disabled: true, ref: "e9" },
      { role: "generic", ref: "e10", cursor: "pointer", text: "Clickable div" },
      { role: "paragraph", ref: "e11", text: "Some   text\nhere." },
      { role: "img", name: "A cat", ref: "e12" },
    ],
  },
];

function render(items: AriaItem[], book = new RefBook(), masked = new Set<string>(), charLimit?: number) {
  return renderSnapshot(items, {
    refFor: (r) => book.refFor(r),
    masked,
    ...(charLimit ? { charLimit } : {}),
  });
}

describe("renderSnapshot", () => {
  it("renders compact text with refs only on things the model can act on", () => {
    const { text, entries, truncated } = render(toAriaItems(FORM));
    expect(truncated).toBe(false);
    expect(text).toBe(
      [
        '- heading "Sign in" [level=1]',
        '- textbox "Name" [ref=e1]: Ada',
        '- textbox "Pass" [ref=e2]: hunter2',
        '- combobox "Size" [ref=e3] [options: Small | Large]: Large',
        '- checkbox "Bacon" [checked] [ref=e4]',
        '- link "Help" [ref=e5] [url=/help]',
        '- button "Off" [disabled] [ref=e6]',
        "- generic [ref=e7]: Clickable div",
        "- paragraph: Some text here.",
        '- img "A cat"',
      ].join("\n"),
    );
    expect(entries.get("e5")).toEqual({ pwRef: "e8", role: "link", name: "Help" });
    expect(entries.size).toBe(7);
  });

  it("drops empty leaves and label text repeated beside its field", () => {
    const items = toAriaItems([
      { role: "paragraph", ref: "e1" },
      { role: "generic", ref: "e2", children: [{ role: "checkbox", name: "Bacon", ref: "e3" }, "Bacon"] },
      { role: "generic", ref: "e4", children: ["Total", { role: "paragraph", ref: "e5", text: "Total" }] },
    ]);
    expect(render(items).text).toBe(
      ['- checkbox "Bacon" [ref=e1]', "- text: Total", "- paragraph: Total"].join("\n"),
    );
  });

  it("hides a field's value when it cannot be checked", () => {
    const items = toAriaItems([{ role: "textbox", name: "Hidden", text: "s3cret" }]);
    expect(render(items).text).toBe(`- textbox "Hidden": ${MASKED_VALUE}`);
  });

  it("masks the values of sensitive fields", () => {
    const items = toAriaItems(FORM);
    expect(valueFieldRefs(items)).toEqual(["e4", "e5"]);
    const { text } = render(items, new RefBook(), new Set(["e5"]));
    expect(text).not.toContain("hunter2");
    expect(text).toContain(`- textbox "Pass" [ref=e2]: ${MASKED_VALUE}`);
  });

  it("keeps a ref stable within a document and never reuses one after it", () => {
    const book = new RefBook();
    const first = render(toAriaItems(FORM), book);
    const again = render(toAriaItems(FORM), book);
    expect([...again.entries.keys()]).toEqual([...first.entries.keys()]);
    book.newDocument();
    // Playwright restarts its numbering on a new page; Steward's refs carry on.
    const next = render(toAriaItems([{ role: "button", name: "Continue", ref: "e2" }]), book);
    expect(next.text).toBe('- button "Continue" [ref=e8]');
  });

  it("indexes every Playwright ref for the fresh look before acting", () => {
    const index = indexRefs(toAriaItems(FORM));
    expect(index.get("e9")).toEqual({ role: "button", name: "Off" });
    expect(index.get("e3")).toEqual({ role: "generic", name: "" });
  });

  it("cuts long pages around what is on screen", () => {
    const rows: AriaItem[] = Array.from({ length: 400 }, (_, i) => ({
      role: "button",
      name: `Row ${i}`,
      ref: `e${i + 1}`,
      box: { x: 0, y: i * 40 - 8000, width: 100, height: 30 },
    }));
    const { text, truncated } = render(rows, new RefBook(), new Set(), 2000);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2000);
    // Row 200 is the first at or below the top of the viewport (y = 0).
    expect(text).toContain('button "Row 200"');
    expect(text).toMatch(/^\[\d+ lines above are not shown\. Scroll up to see them\.\]/);
    expect(text).toMatch(/more lines below are not shown\. Scroll down to see them\.\]$/);
  });

  it("validates Playwright's JSON defensively", () => {
    expect(toAriaItems(null)).toEqual([]);
    expect(toAriaItems([{ nope: 1 }, "text", { role: "button", name: 5 }])).toEqual([
      "text",
      { role: "button" },
    ]);
  });

  it("never splits a surrogate pair", () => {
    expect(cutAtCodeUnits("ab😀cd", 3)).toBe("ab…");
    expect(cutAtCodeUnits("short", 10)).toBe("short");
  });
});
