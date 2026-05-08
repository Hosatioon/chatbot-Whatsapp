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

  useEffect(() => {
    if (status !== "disconnected") {
      setSecondsDisconnected(0);
      return;
    }
    const t = setInterval(() => setSecondsDisconnected((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-semibold text-slate-900">
          Conectar número de WhatsApp
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          Escaneá el código QR desde tu WhatsApp:{" "}
          <span className="font-medium">
            Configuración → Dispositivos vinculados → Vincular un dispositivo
          </span>
        </p>

        <div className="mt-6 flex h-80 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50">
          {qrPng ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrPng}
              alt="QR de WhatsApp"
              className="h-72 w-72 rounded-lg"
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
              <span className="text-amber-700">Esperando escaneo...</span>
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
