"use client";

import { useState, useRef, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import ThemeSelector from "./ThemeSelector";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  phone: string | null;
  onDisconnected: () => void;
  selectedTenantId: number;
}

export default function SettingsDropdown({
  phone,
  onDisconnected,
  selectedTenantId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: session } = useSession();

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const handleDisconnect = async () => {
    if (pendingDisconnect) return;
    setPendingDisconnect(true);
    try {
      const qs = selectedTenantId > 0 ? `?tenantId=${selectedTenantId}` : "";
      const res = await fetch(`/api/connection/disconnect${qs}`, {
        method: "POST",
      });
      if (res.ok) onDisconnected();
    } finally {
      setPendingDisconnect(false);
    }
  };

  const handleSignOut = () => {
    signOut({ callbackUrl: "/login" });
  };

  const isSuperAdmin =
    (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin ?? false;

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Ajustes"
          aria-label="Abrir ajustes"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
            {/* Usuario */}
            {session?.user && (
              <div className="mb-4 border-b border-gray-100 pb-3">
                <div className="text-sm font-medium text-slate-900">
                  {session.user.name}
                </div>
                <div className="text-xs text-gray-500">{session.user.role}</div>
              </div>
            )}

            {/* Apariencia */}
            <div className="mb-4">
              <div className="mb-2 text-sm font-semibold text-slate-800">
                Apariencia
              </div>
              <ThemeSelector />
            </div>

            {/* Conexión */}
            <div className="mb-4">
              <div className="mb-2 text-sm font-semibold text-slate-800">
                Conexión
              </div>
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                disabled={pendingDisconnect}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {pendingDisconnect
                  ? "Desconectando..."
                  : "Desconectar WhatsApp"}
              </button>
            </div>

            {/* Admin */}
            {isSuperAdmin && (
              <div className="mb-4">
                <div className="mb-2 text-sm font-semibold text-slate-800">
                  Admin
                </div>
                <a
                  href="/admin/tenants"
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-gray-50"
                >
                  Tenants
                </a>
              </div>
            )}

            {/* Sesión */}
            <div>
              <button
                type="button"
                onClick={() => setConfirmSignOut(true)}
                className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Salir
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmación desconectar */}
      <ConfirmDialog
        open={confirmDisconnect}
        title="¿Desconectar WhatsApp?"
        description="Vas a tener que escanear el QR otra vez para volver a conectar."
        confirmText="Desconectar"
        cancelText="Cancelar"
        destructive={true}
        onConfirm={() => {
          setConfirmDisconnect(false);
          setOpen(false);
          handleDisconnect();
        }}
        onCancel={() => setConfirmDisconnect(false)}
      />

      {/* Confirmación salir */}
      <ConfirmDialog
        open={confirmSignOut}
        title="¿Salir de la cuenta?"
        description="Se cerrará tu sesión actual y volverás a la pantalla de login."
        confirmText="Salir"
        cancelText="Cancelar"
        destructive={true}
        onConfirm={() => {
          setConfirmSignOut(false);
          setOpen(false);
          handleSignOut();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </>
  );
}
