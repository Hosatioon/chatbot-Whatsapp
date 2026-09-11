"use client";

import { useEffect, useState } from "react";

type Status = "disconnected" | "qr" | "connecting" | "connected";

interface StatusResponse {
  status: Status;
  qrPng?: string;
  phone?: string | null;
  updatedAt?: number;
}

interface Props {
  status: Status;
  qrPng: string | null;
}

export default function QRScreen({ status, qrPng }: Props) {
  const [secondsDisconnected, setSecondsDisconnected] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [qrAge, setQrAge] = useState(0);

  useEffect(() => {
    if (status !== "disconnected") {
      setSecondsDisconnected(0);
      return;
    }
    const t = setInterval(() => setSecondsDisconnected((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status !== "qr") {
      setQrAge(0);
      return;
    }
    const t = setInterval(() => setQrAge((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status, qrPng]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/connection/disconnect", { method: "POST" });
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setRefreshing(false), 3000);
    }
  };

  const qrExpiresIn = Math.max(0, 60 - qrAge);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-emerald-50/30 p-4 sm:p-6">
      <div className="animate-slide-up w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl sm:p-8">
        <h1 className="text-center text-xl font-semibold text-slate-900">
          Conectar número de WhatsApp
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          Escaneá el código QR desde tu WhatsApp:{" "}
          <span className="font-medium">
            Configuración → Dispositivos vinculados → Vincular un dispositivo
          </span>
        </p>

        <div className="mt-6 flex aspect-square w-full items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50">
          {qrPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrPng}
              alt="QR de WhatsApp"
              className="animate-scale-in h-[85%] w-[85%] rounded-lg"
            />
          ) : status === "connecting" ? (
            <div className="flex flex-col items-center gap-3">
              <div className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
              <span className="text-sm text-blue-700">Conectando...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-slate-700" />
              <span className="text-sm text-gray-600">
                Esperando QR del bot...
              </span>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs">
          {status === "qr" && (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <span className="text-amber-700">
                Esperando escaneo... expira en {qrExpiresIn}s
              </span>
            </>
          )}
          {status === "connecting" && (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              <span className="text-blue-700">Conectando a WhatsApp...</span>
            </>
          )}
          {status === "disconnected" && (
            <>
              <span className="h-2 w-2 rounded-full bg-gray-400" />
              <span className="text-gray-600">Desconectado</span>
            </>
          )}
        </div>

        {(status === "qr" || status === "disconnected") && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {refreshing
              ? "Refrescando..."
              : status === "qr"
                ? "Refrescar QR"
                : "Reintentar conexión"}
          </button>
        )}

        {status === "qr" && qrExpiresIn <= 10 && (
          <p className="mt-2 text-center text-xs text-amber-600">
            El QR expira pronto. Refrescá para obtener uno nuevo.
          </p>
        )}

        {status === "disconnected" && secondsDisconnected > 10 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            El bot no respondió en {secondsDisconnected}s. Verificá que el
            proceso del bot esté corriendo (<code>npm run start:bot</code>) y
            mirá los logs de la terminal.
          </div>
        )}
      </div>
    </div>
  );
}

// Helper export para que ConnectionGate reutilice el shape del response
export type { StatusResponse };
