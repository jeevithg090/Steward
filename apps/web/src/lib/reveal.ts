// The hidden pages (plan.md §19): by default Tempo shows the chat and a few pages; pressing L
// brings back the rest (Mission Control, Read It To Me, Am I owed anything?, Scam Shield, Who's
// calling?, Devices, The story) and L again hides them. Kept in memory only, so a reload starts
// hidden again. The pages are hidden, not deleted: a direct link still opens them.
import { useEffect, useSyncExternalStore } from "react";

let revealed = false;
const listeners = new Set<() => void>();

export const reveal = {
  get: (): boolean => revealed,
  set(on: boolean): void {
    if (on === revealed) return;
    revealed = on;
    for (const l of listeners) l();
  },
  toggle(): boolean {
    this.set(!revealed);
    return revealed;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useRevealed(): boolean {
  return useSyncExternalStore(reveal.subscribe, reveal.get, reveal.get);
}

/** True when a key press belongs to something the person is typing in. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "range", "reset", "submit", "file", "color"].includes(type);
}

/** L (no Ctrl, ⌘ or Alt, not while typing) shows or hides the hidden pages; `onToggle` hears the new state. */
export function useRevealKey(onToggle?: (revealed: boolean) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.defaultPrevented || typingIn(e.target)) return;
      onToggle?.(reveal.toggle());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
}
