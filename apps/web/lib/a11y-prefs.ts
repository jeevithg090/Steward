// The accessibility controls' state (SHIPPING.md §4.6, §8): text size and plain mode, kept per
// browser in localStorage (inside try/catch: private windows and locked-down browsers must still
// work) and applied as data attributes on <html> so globals.css can act on them.

export type TextSize = "default" | "large" | "larger";

export interface A11yPrefs {
  textSize: TextSize;
  plain: boolean;
}

export const TEXT_SIZE_KEY = "tempo.textSize";
export const PLAIN_KEY = "tempo.plain";

export const TEXT_SIZES: { id: TextSize; label: string; words: string }[] = [
  { id: "default", label: "A", words: "Normal text" },
  { id: "large", label: "A+", words: "Large text" },
  { id: "larger", label: "A++", words: "Largest text" },
];

const DEFAULTS: A11yPrefs = { textSize: "default", plain: false };

let current: A11yPrefs | null = null;
const listeners = new Set<() => void>();

function read(): A11yPrefs {
  try {
    const size = window.localStorage.getItem(TEXT_SIZE_KEY);
    const plain = window.localStorage.getItem(PLAIN_KEY) === "1";
    return {
      textSize: size === "large" || size === "larger" ? size : "default",
      plain,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Put the prefs on <html> so the stylesheet can see them (also done by the boot script in layout). */
export function applyPrefs(prefs: A11yPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (prefs.textSize === "default") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", prefs.textSize);
  if (prefs.plain) root.setAttribute("data-plain", "");
  else root.removeAttribute("data-plain");
}

export function getPrefs(): A11yPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  if (!current) current = read();
  return current;
}

export function getServerPrefs(): A11yPrefs {
  return DEFAULTS;
}

export function setPrefs(update: Partial<A11yPrefs>): A11yPrefs {
  current = { ...getPrefs(), ...update };
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, current.textSize);
    window.localStorage.setItem(PLAIN_KEY, current.plain ? "1" : "0");
  } catch {
    // no storage: the setting still applies to this page
  }
  applyPrefs(current);
  for (const listener of listeners) listener();
  return current;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests: forget the cached snapshot so the next read comes from storage. */
export function resetPrefsCache(): void {
  current = null;
}

/** Runs before paint, inline in <head>, so the saved size and mode apply without a flash. */
export const BOOT_SCRIPT = `try{var d=document.documentElement,s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)});if(s==="large"||s==="larger")d.setAttribute("data-text-size",s);if(localStorage.getItem(${JSON.stringify(PLAIN_KEY)})==="1")d.setAttribute("data-plain","")}catch(e){}`;
