"use client";

import { useState } from "react";

interface Props {
  phone: string | null;
  onDisconnected: () => void;
}

export default function DashboardHeader({ phone, onDisconnected }: Props) {
  const [pending, setPending] = useState(false);

  const handleDisconnect = async () => {
    if (pending) return;
    const ok = window.confirm(
      "¿Desconectar el número? Vas a tener que escanear el QR otra vez.",
    );
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch("/api/connection/disconnect", { method: "POST" });
      if (res.ok) onDisconnected();
    } finally {
      setPending(false);
    }
  };

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Agente WhatsApp
          </div>
          <div className="text-xs text-gray-500">
            Conectado{phone ? ` · +${phone}` : ""}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDisconnect}
        disabled={pending}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-gray-50 disabled:opacity-60"
      >
        {pending ? "Desconectando..." : "Desconectar"}
      </button>
    </header>
  );
}
