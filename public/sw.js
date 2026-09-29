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

// BUG real encontrado (2026-09-29): sin ESTE listener, Chrome en Android no
// considera la página "instalable de verdad" — "Agregar a pantalla de
// inicio" queda como un simple acceso directo del navegador (abre una
// pestaña normal), no como una app aparte. Eso rompía justo lo que se
// necesitaba: para que las notificaciones push funcionen bien en el
// celular, hace falta la instalación completa, no el acceso directo. No
// cacheamos nada a propósito (ver comentario de arriba): esto solo deja
// pasar la petición tal cual, existe nada más para cumplir el requisito.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
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
