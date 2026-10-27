import { useSyncExternalStore } from "react";
import { useAccessibility } from "./accessibility.tsx";

/** The desktop layout starts at this width, in em of the browser's own text size, at standard text. */
const WIDE_AT_EM = 64;

/**
 * True when there is room for the desktop layout (the left rail). CSS media queries measure rem
 * against the browser's default size, not the root, so a Tailwind `lg:` breakpoint would keep the
 * rail at 150% text and squeeze the page. This scales the breakpoint by the person's text size: at
 * 150% the rail appears only on a screen half as wide again.
 */
export function useWideLayout(): boolean {
  const { textSize } = useAccessibility();
  const query = `(min-width: ${(WIDE_AT_EM * textSize) / 100}em)`;
  return useSyncExternalStore(
    (onChange) => {
      const mql = globalThis.matchMedia?.(query);
      mql?.addEventListener?.("change", onChange);
      return () => mql?.removeEventListener?.("change", onChange);
    },
    () => globalThis.matchMedia?.(query).matches ?? true,
    () => true,
  );
}
