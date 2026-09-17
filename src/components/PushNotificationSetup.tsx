"use client";

import { useEffect, useState } from "react";
import { subscribeThisDevice, detectPushStatus } from "@/lib/push-client";

const DISMISS_KEY = "ordifast_push_banner_dismissed";

// Barrita que aparece una sola vez por dispositivo para pedir el permiso.
// Si el navegador no puede preguntar solo (iPhone sin instalar como app,
// permiso ya bloqueado antes) o el dueño la descarta, esto no vuelve a
// aparecer — para esos casos existe la sección persistente en
// Configuración (ver ConfigPanel), que siempre muestra el estado real y
// qué hacer, sin depender de esta barra.
export default function PushNotificationSetup() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const status = detectPushStatus();

    if (status === "active") {
      void subscribeThisDevice();
      return;
    }

    if (status === "default") {
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
          "No se activó — podés habilitarlo luego desde Configuración.",
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
