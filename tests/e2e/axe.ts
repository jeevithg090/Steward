/**
 * The automated accessibility audit, shared by every spec that runs it. `@axe-core/playwright` is a
 * pinned dev dependency, so it is imported like any other: a broken install fails the run instead
 * of skipping the audit and passing.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The localStorage key the web app keeps the person's display settings under. */
export const ACCESSIBILITY_STORAGE_KEY = "steward.accessibility";

/** The WCAG levels Steward aims for (docs/accessibility.md). */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export interface AxeOptions {
  /**
   * Rules waived on this page, each with the reason and where the fix lives. A waiver is a known
   * bug being fixed elsewhere, never a way to make a new problem go away.
   */
  waive?: Record<string, string>;
}

/** Runs axe on the page as it is now and fails on any serious or critical violation. */
export async function expectNoSeriousAxe(page: Page, label: string, options: AxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  const waived = Object.keys(options.waive ?? {});
  if (waived.length > 0) builder = builder.disableRules(waived);
  const results = await builder.analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => {
      const where = v.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ");
      return `${label}: ${v.id} (${v.help}) at ${where}`;
    });
  expect(serious, `axe found serious problems on ${label}`).toEqual([]);
}

/** The display settings a person can choose, as Settings stores them in this browser. */
export interface DisplaySettings {
  textSize?: 100 | 115 | 130 | 150;
  contrast?: "normal" | "more";
  theme?: "system" | "light" | "dark";
  font?: "default" | "readable";
  motion?: "system" | "reduce";
  shortcuts?: boolean;
}

/** Starts every page of this test with these settings, applied before the first paint as in real use. */
export async function useDisplaySettings(page: Page, settings: DisplaySettings): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Storage can be blocked; the defaults then apply and the spec's checks say so.
      }
    },
    [ACCESSIBILITY_STORAGE_KEY, JSON.stringify(settings)] as const,
  );
}
