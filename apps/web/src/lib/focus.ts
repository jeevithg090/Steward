/**
 * Focus after navigation. A single-page app does not move focus when the route changes, so a
 * screen reader stays on the link that was pressed and hears nothing. The layout marks each route
 * change; the new page's heading claims the mark when it mounts and takes focus, so the reader
 * announces where the person has arrived. A page with no heading (chat) falls back to `<main>`.
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
