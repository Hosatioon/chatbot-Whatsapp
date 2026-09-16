// Service worker de OrdiFast — solo existe para recibir notificaciones push
// del navegador y mostrarlas, incluso con el dashboard cerrado. No cachea
// nada ni intercepta peticiones normales (no es un service worker "offline
// first"), así que no interfiere con el resto de la app.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "OrdiFast", body: "Tenés algo nuevo por revisar" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload no era JSON — dejamos el mensaje genérico
  }

  const options = {
    body: data.body,
    icon: "/ordifast-icon.png",
    badge: "/ordifast-icon.png",
    tag: data.tag || "ordifast",
    data: { url: data.url || "/" },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Al hacer clic en la notificación: si ya hay una pestaña del dashboard
// abierta, la enfoca en vez de abrir una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(targetUrl).catch(() => {});
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
