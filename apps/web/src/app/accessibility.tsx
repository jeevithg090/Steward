import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { api } from "@/lib/api.ts";
import { storage } from "@/lib/utils.ts";

/**
 * The person's display and reading settings. They live in this browser (localStorage) and are
 * written to <html> as data attributes that `styles/app.css` reads, so the whole app, CopilotKit's
 * chat included, follows them.
 *
 * Plain language is the exception: it changes only how the agent answers, so it lives on the server
 * (`PUT /api/settings`) and this browser never keeps its own copy. The switch shows the server's
 * value, or the person's new choice while it is being saved; a save that fails puts it back.
 *
 * `index.html` applies the stored values before the first paint with the same key and attributes.
 */

export type TextSize = 100 | 115 | 130 | 150;
export type Contrast = "normal" | "more";
export type MotionPreference = "system" | "reduce";
export type ThemePreference = "system" | "light" | "dark";
export type FontPreference = "default" | "readable";
/** How fast replies are read aloud: slower, normal, faster. */
export type SpeechRate = 0.8 | 1 | 1.25;

export interface AccessibilitySettings {
  textSize: TextSize;
  contrast: Contrast;
  motion: MotionPreference;
  theme: ThemePreference;
  font: FontPreference;
  /** Read Steward's replies aloud (the chat's voice feature reads this). */
  readAloud: boolean;
  /** The voice that reads aloud, by `voiceURI`; "" is this device's usual voice. */
  speechVoice: string;
  /** How fast it reads. */
  speechRate: SpeechRate;
  /** Ask Steward for short sentences and everyday words. */
  plainLanguage: boolean;
  /**
   * Single-key shortcuts (`g` then a letter, `?`). They can be turned off (WCAG 2.1.4), because
   * voice control and switch access type letters that would set them off.
   */
  shortcuts: boolean;
}

export interface AccessibilityContextValue extends AccessibilitySettings {
  /** The scheme actually on screen once "system" is resolved. */
  resolvedTheme: "light" | "dark";
  /** True when motion should be avoided, from Settings or from the system. */
  reducedMotion: boolean;
  /** True when the stronger colours apply, from Settings or from the system. */
  moreContrast: boolean;
  set: (patch: Partial<AccessibilitySettings>) => void;
  setTextSize: (value: TextSize) => void;
  setContrast: (value: Contrast) => void;
  setMotion: (value: MotionPreference) => void;
  setTheme: (value: ThemePreference) => void;
  setFont: (value: FontPreference) => void;
  setReadAloud: (value: boolean) => void;
  setPlainLanguage: (value: boolean) => void;
  setShortcuts: (value: boolean) => void;
  reset: () => void;
}

export const ACCESSIBILITY_STORAGE_KEY = "steward.accessibility";

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 100, label: "Standard" },
  { value: 115, label: "Large" },
  { value: 130, label: "Larger" },
  { value: 150, label: "Largest" },
];

/** The settings kept in this browser: all but plain language, which the server keeps. */
type LocalSettings = Omit<AccessibilitySettings, "plainLanguage">;

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
  textSize: 100,
  contrast: "normal",
  motion: "system",
  theme: "system",
  font: "default",
  readAloud: false,
  speechVoice: "",
  speechRate: 1,
  plainLanguage: false,
  shortcuts: true,
};

/** Reads stored settings, keeping only values that make sense. Plain language is never read from here. */
export function readStoredAccessibility(): Partial<LocalSettings> {
  const raw = storage.get(ACCESSIBILITY_STORAGE_KEY);
  if (!raw) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const out: Partial<LocalSettings> = {};
  if ([100, 115, 130, 150].includes(parsed.textSize as number)) out.textSize = parsed.textSize as TextSize;
  if (parsed.contrast === "normal" || parsed.contrast === "more") out.contrast = parsed.contrast;
  if (parsed.motion === "system" || parsed.motion === "reduce") out.motion = parsed.motion;
  if (parsed.theme === "system" || parsed.theme === "light" || parsed.theme === "dark")
    out.theme = parsed.theme;
  if (parsed.font === "default" || parsed.font === "readable") out.font = parsed.font;
  if (typeof parsed.speechVoice === "string" && parsed.speechVoice.length <= 500)
    out.speechVoice = parsed.speechVoice;
  if ([0.8, 1, 1.25].includes(parsed.speechRate as number)) out.speechRate = parsed.speechRate as SpeechRate;
  if (typeof parsed.readAloud === "boolean") out.readAloud = parsed.readAloud;
  if (typeof parsed.shortcuts === "boolean") out.shortcuts = parsed.shortcuts;
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
const contrastQuery = "(prefers-contrast: more)";
const subscribeDark = mediaQuery(darkQuery);
const subscribeMotion = mediaQuery(motionQuery);
const subscribeContrast = mediaQuery(contrastQuery);
const prefersDark = () => globalThis.matchMedia?.(darkQuery).matches ?? false;
const prefersLessMotion = () => globalThis.matchMedia?.(motionQuery).matches ?? false;
const prefersMoreContrast = () => globalThis.matchMedia?.(contrastQuery).matches ?? false;

/** Writes the settings to <html>. Attributes are removed at their defaults, so the CSS defaults apply. */
export function applyAccessibilityAttributes(
  settings: LocalSettings,
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
   * Saves plain language on the server. Defaults to `PUT /api/settings`; the app passes one that
   * also updates its cached settings. When it fails, the switch goes back and a toast says so.
   */
  savePlainLanguage?: (value: boolean) => Promise<unknown>;
  /**
   * The server's plain-language setting, once known. It is what the switch shows, so a setting
   * made on another device or by the agent shows here too.
   */
  serverPlainLanguage?: boolean;
}

/** The person's plain-language choice while the server has not yet taken it in. */
interface PlainLanguageChoice {
  value: boolean;
  /** Saved: kept only until the server's value next changes, which then wins. */
  saved: boolean;
}

export const PLAIN_LANGUAGE_SAVE_FAILED =
  "Couldn't save plain language. Steward will keep answering as before.";

export function AccessibilityProvider({
  children,
  initial,
  savePlainLanguage,
  serverPlainLanguage,
}: AccessibilityProviderProps) {
  const [settings, setSettings] = useState<LocalSettings>(() => {
    const { plainLanguage: _server, ...local } = { ...DEFAULT_ACCESSIBILITY, ...initial };
    return { ...local, ...readStoredAccessibility() };
  });
  const [choice, setChoice] = useState<PlainLanguageChoice | undefined>();
  const plainLanguage = choice?.value ?? serverPlainLanguage ?? initial?.plainLanguage ?? false;
  // Read by `set`, which keeps one identity across renders.
  const latest = useRef({ plainLanguage, savePlainLanguage, attempt: 0 });
  latest.current.plainLanguage = plainLanguage;
  latest.current.savePlainLanguage = savePlainLanguage;

  const systemDark = useSyncExternalStore(subscribeDark, prefersDark, () => false);
  const systemLessMotion = useSyncExternalStore(subscribeMotion, prefersLessMotion, () => false);
  const systemMoreContrast = useSyncExternalStore(subscribeContrast, prefersMoreContrast, () => false);
  const resolvedTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  // Like motion, the system can only add: its "increase contrast" applies whatever is chosen here.
  const moreContrast = settings.contrast === "more" || systemMoreContrast;

  useEffect(() => {
    applyAccessibilityAttributes({ ...settings, contrast: moreContrast ? "more" : "normal" }, resolvedTheme);
  }, [settings, moreContrast, resolvedTheme]);

  // Once a choice is saved, the server's next value is the truth again: ours, or a later one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the server's value changes.
  useEffect(() => {
    setChoice((current) => (current?.saved ? undefined : current));
  }, [serverPlainLanguage]);

  const choosePlainLanguage = useCallback((value: boolean) => {
    if (value === latest.current.plainLanguage) return;
    const attempt = ++latest.current.attempt;
    setChoice({ value, saved: false });
    const save =
      latest.current.savePlainLanguage ?? ((next: boolean) => api.settings.update({ plainLanguage: next }));
    save(value).then(
      () => {
        if (attempt === latest.current.attempt) setChoice({ value, saved: true });
      },
      () => {
        if (attempt !== latest.current.attempt) return;
        setChoice(undefined);
        toast.error(PLAIN_LANGUAGE_SAVE_FAILED);
      },
    );
  }, []);

  const set = useCallback(
    (patch: Partial<AccessibilitySettings>) => {
      const { plainLanguage: plain, ...local } = patch;
      if (Object.keys(local).length > 0) {
        setSettings((current) => {
          const next = { ...current, ...local };
          storage.set(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
      if (plain !== undefined) choosePlainLanguage(plain);
    },
    [choosePlainLanguage],
  );

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      ...settings,
      plainLanguage,
      resolvedTheme,
      reducedMotion: settings.motion === "reduce" || systemLessMotion,
      moreContrast,
      set,
      setTextSize: (textSize) => set({ textSize }),
      setContrast: (contrast) => set({ contrast }),
      setMotion: (motion) => set({ motion }),
      setTheme: (theme) => set({ theme }),
      setFont: (font) => set({ font }),
      setReadAloud: (readAloud) => set({ readAloud }),
      setPlainLanguage: (plainLanguage) => set({ plainLanguage }),
      setShortcuts: (shortcuts) => set({ shortcuts }),
      reset: () => set({ ...DEFAULT_ACCESSIBILITY }),
    }),
    [settings, plainLanguage, resolvedTheme, systemLessMotion, moreContrast, set],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

/** The person's accessibility settings and their setters. Must be used inside `AccessibilityProvider`. */
export function useAccessibility(): AccessibilityContextValue {
  const value = useContext(AccessibilityContext);
  if (!value) throw new Error("useAccessibility must be used inside <AccessibilityProvider>.");
  return value;
}
