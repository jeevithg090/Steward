import axe from "axe-core";

/**
 * Runs axe on a rendered container and fails with every violation spelled out. Colour contrast
 * is skipped because jsdom does not lay out or paint; the palette is checked by hand (§8).
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`)
    .join("\n");
  expect(results.violations, summary).toEqual([]);
}
