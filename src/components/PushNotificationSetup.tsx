"use client";

import { useEffect, useState } from "react";

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

async function subscribeThisDevice(): Promise<boolean> {
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

const DISMISS_KEY = "ordifast_push_banner_dismissed";

// Componente "invisible" la mayor parte del tiempo: si el navegador ya
// tiene permiso concedido de antes, re-suscribe en silencio (por si se
// perdió la suscripción — pasa al limpiar datos del sitio) y no muestra
// nada. Si nunca se decidió, muestra una barra chiquita para pedirlo. Si el
// dueño ya dijo que no, o el navegador no soporta push (ej: iPhone sin
// instalar como app en la pantalla de inicio), no molesta con nada.
export default function PushNotificationSetup() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      return;
    }

    if (Notification.permission === "granted") {
      void subscribeThisDevice();
      return;
    }

    if (Notification.permission === "default") {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        /* ignore */
      }
      if (!dismissed) setShow(true);
    }
  }, []);

  async function handleActivate() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setErrorMsg(
          "No se activó — podés habilitarlo luego desde los permisos del sitio en tu navegador.",
        );
        return;
      }
      const ok = await subscribeThisDevice();
      if (!ok) {
        setErrorMsg("No se pudo activar en este dispositivo. Probá de nuevo.");
        return;
      }
      setShow(false);
    } catch {
      setErrorMsg("No se pudo activar en este dispositivo. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!show) return null;

  return (
    <div className="animate-slide-down flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 sm:flex-nowrap sm:px-6">
      <span>
        🔔 Activá las notificaciones en este dispositivo para enterarte al
        toque cuando escriba un cliente o entre un pedido.
      </span>
      {errorMsg && <span className="text-xs text-red-600">{errorMsg}</span>}
      <div className="ml-0 flex shrink-0 items-center gap-2 sm:ml-auto">
        <button
          type="button"
          onClick={handleActivate}
          disabled={busy}
          className="rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Activando..." : "Activar"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
