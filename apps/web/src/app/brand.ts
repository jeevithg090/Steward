import { useEffect, useSyncExternalStore } from "react";
import { useInfo } from "@/lib/api.ts";

/**
 * The tenant's brand (brand.yaml) on screen: its name in the tab title and wherever the app names
 * the product, and its accent on buttons, links, the current page and the focus ring.
 *
 * The accent arrives as one `#rrggbb` colour that white text can be read on (the server's loader
 * checks it). The light, dark and more-contrast shades are worked out here and set on <html> as
 * `--st-brand-*`; `src/styles/app.css` uses them while `data-brand` is set. Steward's own teal is
 * hand-tuned in the stylesheet, so its own accent sets nothing.
 */

export const DEFAULT_PRODUCT = "Steward";
export const DEFAULT_ACCENT = "#0f6e66";

// The stylesheet's surfaces (surface, card, tile) in light and dark, its dark ink on the accent, and
// black and white. Kept in step with app.css by brand.test.tsx.
export const LIGHT_SURFACES = ["#f6f7f7", "#ffffff", "#eef1f0"] as const;
export const DARK_SURFACES = ["#101413", "#1a1f1e", "#232a29"] as const;
export const DARK_ON_ACCENT = "#06201d";
const WHITE = "#ffffff";
const BLACK = "#000000";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | undefined {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [Number.parseInt(m[1]!, 16), Number.parseInt(m[2]!, 16), Number.parseInt(m[3]!, 16)] : undefined;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** `amount` of the way from `from` to `to`, in sRGB as CSS's color-mix(in srgb) does. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from)!;
  const b = parseHex(to)!;
  return toHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as Rgb);
}

function luminance(hex: string): number {
  const rgb = parseHex(hex)!;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The least change from `start` toward `toward` that passes `ok`, in 2% steps. */
function nearest(start: string, toward: string, ok: (c: string) => boolean): string {
  for (let step = 0; step <= 50; step++) {
    const c = mix(start, toward, step / 50);
    if (ok(c)) return c;
  }
  return toward;
}

export interface BrandShades {
  light: { accent: string; hover: string; soft: string; more: string; moreHover: string };
  dark: { accent: string; hover: string; soft: string; more: string; moreHover: string };
}

/**
 * Every shade the stylesheet needs from one accent, each checked for contrast: text and focus
 * rings at 4.5:1 on the surfaces it sits on, 7:1 in more-contrast mode. The light accent is the
 * brand's own colour, or the least darker shade of it that also reads on the grey page and tiles
 * (white text on it is 4.5:1 already, but the page is darker than white). Undefined for a colour
 * that is not `#rrggbb` or that white text cannot be read on, so the app keeps Steward's own.
 */
export function brandShades(accent: string): BrandShades | undefined {
  const base = accent.toLowerCase();
  if (!parseHex(base) || contrast(base, WHITE) < 4.5) return undefined;

  const onLight = (c: string, ratio: number) => LIGHT_SURFACES.every((s) => contrast(c, s) >= ratio);
  const light = nearest(base, BLACK, (c) => onLight(c, 4.5));
  const lightSoft = nearest(mix(light, WHITE, 0.9), WHITE, (c) => contrast(light, c) >= 4.5);
  const lightMore = nearest(light, BLACK, (c) => onLight(c, 7));

  const darkSoftOf = (c: string) => mix(c, DARK_SURFACES[0], 0.82);
  const dark = nearest(
    base,
    WHITE,
    (c) =>
      DARK_SURFACES.every((s) => contrast(c, s) >= 4.5) &&
      contrast(c, DARK_ON_ACCENT) >= 4.5 &&
      contrast(c, darkSoftOf(c)) >= 4.5,
  );
  const darkMore = nearest(dark, WHITE, (c) => DARK_SURFACES.every((s) => contrast(c, s) >= 7));

  return {
    light: {
      accent: light,
      hover: mix(light, BLACK, 0.18),
      soft: lightSoft,
      more: lightMore,
      moreHover: mix(lightMore, BLACK, 0.25),
    },
    dark: {
      accent: dark,
      hover: mix(dark, WHITE, 0.3),
      soft: darkSoftOf(dark),
      more: darkMore,
      moreHover: mix(darkMore, WHITE, 0.35),
    },
  };
}

const PROPERTIES = ["accent", "hover", "soft", "more", "moreHover"] as const;
const propertyName = (key: (typeof PROPERTIES)[number]) =>
  `--st-brand-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Writes the accent's shades to <html>, or removes them for Steward's own accent or a bad colour. */
export function applyBrandAccent(
  accent: string | undefined,
  root: HTMLElement = document.documentElement,
): void {
  const shades = accent && accent.toLowerCase() !== DEFAULT_ACCENT ? brandShades(accent) : undefined;
  for (const key of PROPERTIES) {
    if (shades)
      root.style.setProperty(propertyName(key), `light-dark(${shades.light[key]}, ${shades.dark[key]})`);
    else root.style.removeProperty(propertyName(key));
  }
  if (shades) root.setAttribute("data-brand", "");
  else root.removeAttribute("data-brand");
}

// The product's name, for code that cannot wait on a query (the tab title is set from effects
// everywhere). It starts as Steward's and follows /api/info once that arrives.
let productName = DEFAULT_PRODUCT;
const listeners = new Set<() => void>();

function setProductName(name: string): void {
  if (name === productName) return;
  productName = name;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The product's name from brand.yaml: "Steward", "Tempo". Steward's until /api/info answers. */
export function useBrandName(): string {
  return useSyncExternalStore(
    subscribe,
    () => productName,
    () => productName,
  );
}

/** Puts the brand on screen. Rendered once, near the root. */
export function BrandTheme(): null {
  const info = useInfo();
  const brand = info.data?.brand;
  useEffect(() => {
    setProductName(brand?.name?.trim() || DEFAULT_PRODUCT);
    applyBrandAccent(brand?.accent);
  }, [brand?.name, brand?.accent]);
  return null;
}

/** For tests: back to Steward's name and accent. */
export function resetBrandForTests(): void {
  setProductName(DEFAULT_PRODUCT);
  applyBrandAccent(undefined);
}
