import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "@/lib/api.ts";
import { storage } from "@/lib/utils.ts";

/**
 * The person's display and reading settings. They live in this browser (localStorage) and are
 * written to <html> as data attributes that `styles/app.css` reads, so the whole app, CopilotKit's
 * chat included, follows them. Plain language is also the agent's business, so it is saved on the
 * server too (`PUT /api/settings`).
 *
 * `index.html` applies the stored values before the first paint with the same key and attributes.
 */

export type TextSize = 100 | 115 | 130 | 150;
export type Contrast = "normal" | "more";
export type MotionPreference = "system" | "reduce";
export type ThemePreference = "system" | "light" | "dark";
export type FontPreference = "default" | "readable";

export interface AccessibilitySettings {
  textSize: TextSize;
  contrast: Contrast;
  motion: MotionPreference;
  theme: ThemePreference;
  font: FontPreference;
  /** Read Steward's replies aloud (the chat's voice feature reads this). */
  readAloud: boolean;
  /** Ask Steward for short sentences and everyday words. */
  plainLanguage: boolean;
}

export interface AccessibilityContextValue extends AccessibilitySettings {
  /** The scheme actually on screen once "system" is resolved. */
  resolvedTheme: "light" | "dark";
  /** True when motion should be avoided, from Settings or from the system. */
  reducedMotion: boolean;
  set: (patch: Partial<AccessibilitySettings>) => void;
  setTextSize: (value: TextSize) => void;
  setContrast: (value: Contrast) => void;
  setMotion: (value: MotionPreference) => void;
  setTheme: (value: ThemePreference) => void;
  setFont: (value: FontPreference) => void;
  setReadAloud: (value: boolean) => void;
  setPlainLanguage: (value: boolean) => void;
  reset: () => void;
}

export const ACCESSIBILITY_STORAGE_KEY = "steward.accessibility";

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 100, label: "Standard" },
  { value: 115, label: "Large" },
  { value: 130, label: "Larger" },
  { value: 150, label: "Largest" },
];

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  textSize: 100,
  contrast: "normal",
  motion: "system",
  theme: "system",
  font: "default",
  readAloud: false,
  plainLanguage: false,
};

/** Reads stored settings, keeping only values that make sense. */
export function readStoredAccessibility(): Partial<AccessibilitySettings> {
  const raw = storage.get(ACCESSIBILITY_STORAGE_KEY);
  if (!raw) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const out: Partial<AccessibilitySettings> = {};
  if ([100, 115, 130, 150].includes(parsed.textSize as number)) out.textSize = parsed.textSize as TextSize;
  if (parsed.contrast === "normal" || parsed.contrast === "more") out.contrast = parsed.contrast;
  if (parsed.motion === "system" || parsed.motion === "reduce") out.motion = parsed.motion;
  if (parsed.theme === "system" || parsed.theme === "light" || parsed.theme === "dark")
    out.theme = parsed.theme;
  if (parsed.font === "default" || parsed.font === "readable") out.font = parsed.font;
  if (typeof parsed.readAloud === "boolean") out.readAloud = parsed.readAloud;
  if (typeof parsed.plainLanguage === "boolean") out.plainLanguage = parsed.plainLanguage;
  return out;
}

function mediaQuery(query: string) {
  return (onChange: () => void) => {
    const mql = globalThis.matchMedia?.(query);
    if (!mql) return () => {};
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  };
}

const darkQuery = "(prefers-color-scheme: dark)";
const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeDark = mediaQuery(darkQuery);
const subscribeMotion = mediaQuery(motionQuery);
const prefersDark = () => globalThis.matchMedia?.(darkQuery).matches ?? false;
const prefersLessMotion = () => globalThis.matchMedia?.(motionQuery).matches ?? false;

/** Writes the settings to <html>. Attributes are removed at their defaults, so the CSS defaults apply. */
export function applyAccessibilityAttributes(
  settings: AccessibilitySettings,
  resolvedTheme: "light" | "dark",
  root: HTMLElement = document.documentElement,
): void {
  const setOrRemove = (name: string, value: string | undefined) => {
    if (value === undefined) root.removeAttribute(name);
    else root.setAttribute(name, value);
  };
  setOrRemove("data-text", settings.textSize === 100 ? undefined : String(settings.textSize));
  setOrRemove("data-contrast", settings.contrast === "more" ? "more" : undefined);
  setOrRemove("data-motion", settings.motion === "reduce" ? "reduce" : undefined);
  setOrRemove("data-theme", settings.theme === "system" ? undefined : settings.theme);
  setOrRemove("data-font", settings.font === "readable" ? "readable" : undefined);
  root.classList.toggle("dark", resolvedTheme === "dark");
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

export interface AccessibilityProviderProps {
  children: ReactNode;
  /** Starting values; stored values win over these. For tests and embedding. */
  initial?: Partial<AccessibilitySettings>;
  /**
   * Saves plain language on the server. Defaults to `PUT /api/settings`; failures are ignored
   * because the local setting still applies to the screen.
   */
  savePlainLanguage?: (value: boolean) => Promise<unknown>;
  /**
   * The server's plain-language setting, once known. Adopted while this browser has never chosen,
   * so a setting made on another device or by the agent shows here too.
   */
  serverPlainLanguage?: boolean;
}

export function AccessibilityProvider({
  children,
  initial,
  savePlainLanguage,
  serverPlainLanguage,
}: AccessibilityProviderProps) {
  const [settings, setSettings] = useState<AccessibilitySettings>(() => ({
    ...DEFAULT_ACCESSIBILITY,
    ...initial,
    ...readStoredAccessibility(),
  }));

  const systemDark = useSyncExternalStore(subscribeDark, prefersDark, () => false);
  const systemLessMotion = useSyncExternalStore(subscribeMotion, prefersLessMotion, () => false);
  const resolvedTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  useEffect(() => {
    applyAccessibilityAttributes(settings, resolvedTheme);
  }, [settings, resolvedTheme]);

  useEffect(() => {
    if (serverPlainLanguage === undefined) return;
    if (readStoredAccessibility().plainLanguage !== undefined) return;
    setSettings((current) =>
      current.plainLanguage === serverPlainLanguage
        ? current
        : { ...current, plainLanguage: serverPlainLanguage },
    );
  }, [serverPlainLanguage]);

  const set = useCallback(
    (patch: Partial<AccessibilitySettings>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        storage.set(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      if (patch.plainLanguage !== undefined) {
        const save = savePlainLanguage ?? ((value: boolean) => api.settings.update({ plainLanguage: value }));
        save(patch.plainLanguage).catch(() => {
          // The screen already follows the setting; the agent picks it up on the next save.
        });
      }
    },
    [savePlainLanguage],
  );

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      ...settings,
      resolvedTheme,
      reducedMotion: settings.motion === "reduce" || systemLessMotion,
      set,
      setTextSize: (textSize) => set({ textSize }),
      setContrast: (contrast) => set({ contrast }),
      setMotion: (motion) => set({ motion }),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setReadAloud: (readAloud) => set({ readAloud }),
      setPlainLanguage: (plainLanguage) => set({ plainLanguage }),
      reset: () => set({ ...DEFAULT_ACCESSIBILITY }),
    }),
    [settings, resolvedTheme, systemLessMotion, set],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

/** The person's accessibility settings and their setters. Must be used inside `AccessibilityProvider`. */
export function useAccessibility(): AccessibilityContextValue {
  const value = useContext(AccessibilityContext);
  if (!value) throw new Error("useAccessibility must be used inside <AccessibilityProvider>.");
  return value;
}
