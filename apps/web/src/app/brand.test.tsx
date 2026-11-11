import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDocumentTitle } from "@/components/ui/PageHeader.tsx";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import {
  BrandTheme,
  brandShades,
  contrast,
  DARK_ON_ACCENT,
  DARK_SURFACES,
  DEFAULT_ACCENT,
  LIGHT_SURFACES,
  resetBrandForTests,
  useBrandName,
} from "./brand.ts";

afterEach(() => {
  resetBrandForTests();
  vi.unstubAllGlobals();
  document.title = "";
});

const info = (brand: { name: string; accent: string }) => ({
  brand: { tagline: "", voice: "", ...brand },
  agents: [],
  starters: [],
  model: { provider: "scripted", model: "steward-scripted", scripted: true },
  mail: { connected: false, label: "Not connected", isDemo: false },
  version: "0.1.0",
  singleUser: true,
});

function Page({ title }: { title: string }) {
  useDocumentTitle(title);
  const name = useBrandName();
  return <p>{name}</p>;
}

describe("brandShades", () => {
  // Tempo's amber, Steward's teal, the darkest and lightest colours the loader takes, and a blue.
  const accents = ["#b45309", DEFAULT_ACCENT, "#000000", "#767676", "#1d4ed8", "#7c2d92"];

  it("keeps every shade readable, in light and dark, and stronger in more-contrast mode", () => {
    for (const accent of accents) {
      const shades = brandShades(accent);
      expect(shades, accent).toBeDefined();
      const { light, dark } = shades!;
      // Links and the current page are accent text on the page, cards and tiles, not only on white.
      for (const surface of LIGHT_SURFACES) {
        expect(contrast(light.accent, surface), `${accent} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(light.more, surface), `${accent} on ${surface}`).toBeGreaterThanOrEqual(7);
      }
      expect(contrast(light.hover, "#ffffff"), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light.accent, light.soft), accent).toBeGreaterThanOrEqual(4.5);
      for (const surface of DARK_SURFACES) {
        expect(contrast(dark.accent, surface), `${accent} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(dark.more, surface), `${accent} on ${surface}`).toBeGreaterThanOrEqual(7);
      }
      expect(contrast(dark.accent, DARK_ON_ACCENT), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark.hover, DARK_ON_ACCENT), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark.accent, dark.soft), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the brand's own colour in light mode, darkened only as far as the grey tiles need", () => {
    expect(brandShades("#1d4ed8")?.light.accent).toBe("#1d4ed8");
    expect(brandShades(DEFAULT_ACCENT)?.light.accent).toBe(DEFAULT_ACCENT);
    // Tempo's amber is 5.0:1 on white but 4.4:1 on a tile, so links on a tile get a shade darker.
    expect(contrast("#b45309", "#eef1f0")).toBeLessThan(4.5);
    const tempo = brandShades("#b45309")!.light.accent;
    expect(tempo).not.toBe("#b45309");
    expect(contrast(tempo, "#eef1f0")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tempo, "#b45309")).toBeLessThan(1.1);
  });

  it("refuses a colour white text cannot be read on, or one that is not #rrggbb", () => {
    expect(brandShades("#f0c419")).toBeUndefined();
    expect(brandShades("teal")).toBeUndefined();
    expect(brandShades("#b45309; color: red")).toBeUndefined();
  });

  it("works from the same surfaces and ink as the stylesheet", async () => {
    // Vitest hands CSS imports over empty, and the web app has no Node types, so the one call this
    // test needs is typed here.
    const fs: { existsSync(file: string): boolean; readFileSync(file: string, encoding: "utf8"): string } =
      await import(/* @vite-ignore */ "node:fs" as string);
    // Tests run from the repository root or from apps/web.
    const file = ["apps/web/src/styles/app.css", "src/styles/app.css"].find((f) => fs.existsSync(f)) ?? "";
    const css = fs.readFileSync(file, "utf8");
    const [surface, card, tile] = DARK_SURFACES;
    const [lightSurface, lightCard, lightTile] = LIGHT_SURFACES;
    expect(css).toContain(`--st-surface: light-dark(${lightSurface}, ${surface});`);
    expect(css).toContain(`--st-card: light-dark(${lightCard}, ${card});`);
    expect(css).toContain(`--st-tile: light-dark(${lightTile}, ${tile});`);
    expect(css).toContain(`--st-on-accent: light-dark(#ffffff, ${DARK_ON_ACCENT});`);
    expect(css).toContain(`--st-accent: light-dark(${DEFAULT_ACCENT}, #6ad3c5);`);
  });
});

describe("BrandTheme", () => {
  it("puts Tempo's accent on <html> and its name in the tab title", async () => {
    mockFetch((req) =>
      req.path === "/api/info" ? { body: info({ name: "Tempo", accent: "#b45309" }) } : undefined,
    );
    renderWithProviders(
      <>
        <BrandTheme />
        <Page title="Today" />
      </>,
    );
    await waitFor(() => expect(document.title).toBe("Today · Tempo"));
    expect(screen.getByText("Tempo")).toBeTruthy();
    const root = document.documentElement;
    expect(root.hasAttribute("data-brand")).toBe(true);
    const shades = brandShades("#b45309")!;
    expect(root.style.getPropertyValue("--st-brand-accent")).toBe(
      `light-dark(${shades.light.accent}, ${shades.dark.accent})`,
    );
    expect(root.style.getPropertyValue("--st-brand-soft")).toMatch(
      /^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/,
    );
  });

  it("leaves Steward's own teal to the stylesheet", async () => {
    const fetch = mockFetch((req) =>
      req.path === "/api/info" ? { body: info({ name: "Steward", accent: DEFAULT_ACCENT }) } : undefined,
    );
    renderWithProviders(
      <>
        <BrandTheme />
        <Page title="Tasks" />
      </>,
    );
    await waitFor(() => expect(fetch.calls.some((c) => c.path === "/api/info")).toBe(true));
    await waitFor(() => expect(document.title).toBe("Tasks · Steward"));
    expect(document.documentElement.hasAttribute("data-brand")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--st-brand-accent")).toBe("");
  });

  it("says Steward until the server answers, and when it cannot", async () => {
    mockFetch(() => ({ status: 500, body: { error: "down" } }));
    renderWithProviders(
      <>
        <BrandTheme />
        <Page title="Rules" />
      </>,
    );
    await waitFor(() => expect(document.title).toBe("Rules · Steward"));
  });
});
