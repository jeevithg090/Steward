/**
 * Says something to screen readers from one polite live region that outlives whoever spoke. An
 * answered approval card is gone a moment after the answer, and a live region inside it would go
 * with it before anything was heard.
 */
let region: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** How long the region waits before it speaks, so one only just added is in place first. */
const SETTLE_MS = 50;

export function announce(message: string): void {
  if (typeof document === "undefined" || !document.body) return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.dataset.announcer = "";
    region.className = "sr-only";
    document.body.append(region);
  }
  const target = region;
  // Emptied, then filled, so the same words said twice are heard twice.
  target.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    target.textContent = message;
  }, SETTLE_MS);
}
