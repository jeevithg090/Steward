// Tempo's service worker (S5.2). A push only ever says "sync": it carries no names, amounts or
// companies. The notification is generic; the app fetches the details over its own session.
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Tempo", {
      body: "Something needs your OK. Open Tempo to see it.",
      tag: "tempo-sync", // one notification at a time, replaced rather than stacked
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => "focus" in w);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
