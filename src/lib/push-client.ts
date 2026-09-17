"use client";

// Lógica de Web Push compartida entre la barrita de arriba
// (PushNotificationSetup, aparece una vez y se puede descartar) y la
// sección persistente en Configuración (siempre visible, para cuando el
// navegador no preguntó solo, o el dueño descartó la barra y quiere
// activarlo después). Un solo lugar para no repetir la lógica dos veces.

// Convierte la llave pública VAPID (base64url) al Uint8Array que pide
// pushManager.subscribe — es la conversión estándar que recomienda la
// documentación de Web Push, no hay forma más corta de hacerlo con las APIs
// del navegador.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeThisDevice(): Promise<boolean> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const keyRes = await fetch("/api/push/vapid-public-key");
  if (!keyRes.ok) return false;
  const { publicKey } = (await keyRes.json()) as { publicKey?: string };
  if (!publicKey) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
  return true;
}

export type PushDeviceStatus =
  | "checking" // todavía no se evaluó (solo en el primer render, SSR)
  | "unsupported" // el navegador no tiene las APIs necesarias
  | "ios-needs-install" // iPhone/iPad en Safari normal — necesita agregarse a la pantalla de inicio
  | "denied" // el usuario bloqueó el permiso antes
  | "default" // todavía no se decidió — se puede pedir
  | "active"; // permiso concedido (asumimos que subscribeThisDevice ya corrió o corre solo)

// BUG real encontrado (2026-09-16): la barrita de arriba solo pedía el
// permiso UNA vez y, si el navegador no preguntaba (iPhone en Safari sin
// instalar como app) o el dueño la descartaba, no quedaba ningún otro lugar
// donde volver a intentarlo — parecía que "no pasaba nada" sin explicación.
// Esta función es la que usa la sección persistente en Configuración para
// mostrar SIEMPRE el estado real y qué hacer en cada caso, sin depender de
// que el navegador haya preguntado por su cuenta.
export function detectPushStatus(): PushDeviceStatus {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "checking";
  }

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  // En iPhone/iPad, Safari solo permite Web Push si la página está
  // instalada en la pantalla de inicio (iOS 16.4+) — en una pestaña normal
  // ni siquiera existe `PushManager`, así que hay que detectarlo ANTES de
  // chequear las APIs (si no, cae en "unsupported" sin explicar por qué).
  if (isIOS && !isStandalone) return "ios-needs-install";

  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return "unsupported";
  }

  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  return "active";
}
