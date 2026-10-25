// Whether a CSS media query matches, kept in sync as the window changes (plan.md §12.1 finding 5:
// the chat swaps the avatar panel for a compact strip below `lg`). Where `matchMedia` is missing
// (jsdom, very old browsers) it answers `fallback`.
import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `lg` breakpoint: the chat's side-by-side layout starts here. */
export const WIDE = "(min-width: 1024px)";

export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener?.("change", onChange);
      return () => list.removeEventListener?.("change", onChange);
    },
    [query],
  );
  const snapshot = () => (typeof window === "undefined" || typeof window.matchMedia !== "function" ? fallback : window.matchMedia(query).matches);
  return useSyncExternalStore(subscribe, snapshot, () => fallback);
}
