import type { AppNotification } from "@steward/shared";

/**
 * Browser notifications, for when Steward needs the person and the tab is in the background. They
 * are shown only after the person turns them on, and only while the page is hidden: on screen, the
 * in-app toast is enough.
 */

export type NotificationPermissionState = NotificationPermission | "unsupported";

export function notificationPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Shows a system notification if allowed and the page is hidden. `open` runs when it is clicked. */
export function showBrowserNotification(n: AppNotification, open?: (href: string) => void): void {
  if (notificationPermission() !== "granted" || !document.hidden) return;
  try {
    const shown = new Notification(n.title, { body: n.body, tag: n.id });
    shown.onclick = () => {
      window.focus();
      if (n.href) open?.(n.href);
      shown.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the toast still shows.
  }
}
