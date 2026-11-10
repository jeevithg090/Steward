/**
 * Focus after navigation. A single-page app does not move focus when the route changes, so a
 * screen reader stays on the link that was pressed and hears nothing. The layout marks each route
 * change; the new page's heading claims the mark when it mounts and takes focus, so the reader
 * announces where the person has arrived. A page with no heading (chat) falls back to `<main>`.
 *
 * The layout marks the change in a layout effect, which React runs before any page's ordinary
 * effects, so a page that is already loaded can claim the mark as it mounts.
 */

let pending = false;

export function markRouteChange(): void {
  pending = true;
}

/** True once per route change: the first heading to ask takes focus. */
export function claimRouteFocus(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}

export function routeFocusPending(): boolean {
  return pending;
}

/**
 * Moves focus to `el` for a route change that is still waiting for it. Only a move that took counts:
 * while a dialog is open the page behind it is inert and refuses focus, and the change stays
 * pending for the layout's fallback instead of being used up.
 */
export function focusForRoute(el: HTMLElement | null | undefined, options?: FocusOptions): boolean {
  if (!pending || !el) return false;
  el.focus(options);
  if (document.activeElement !== el) return false;
  pending = false;
  return true;
}
