/*
 * Steward's service worker. A push carries only `{ level, c, localId }`: `c` is the notification
 * sealed with this phone's own data key, so the relay, Apple and Google never saw the words. It is
 * opened here with the key kept (non-extractable) in IndexedDB, and shown only when it was sealed
 * as a notification (`{ topic: "notifications", value }`, packages/remote/src/calls.ts), so the
 * relay cannot push some other sealed message as one. Tapping opens the app at what it is about.
 */
const DB = "steward-phone";

function loadKey() {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const get = open.result.transaction("keys", "readonly").objectStore("keys").get("device");
      get.onsuccess = () => resolve(get.result?.dataKey);
      get.onerror = () => resolve(undefined);
    };
  });
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function open(c) {
  const key = await loadKey();
  if (!key || typeof c !== "string") return undefined;
  const bytes = fromBase64(c);
  if (bytes[0] !== 0 || bytes.length < 29) return undefined;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(1, 13) },
      key,
      bytes.slice(13),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return undefined;
  }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {}
      const sealed = await open(data.c);
      const note = sealed && sealed.topic === "notifications" && sealed.value ? sealed.value : {};
      await self.registration.showNotification(note.title || "Steward", {
        body: note.body || "Open Steward to see what's new.",
        tag: data.localId,
        data: { href: note.href || "#today" },
        requireInteraction: data.level === "needs_you",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = new URL(event.notification.data?.href || "#today", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.navigate(href).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(href);
    })(),
  );
});
