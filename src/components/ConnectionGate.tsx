"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { ConversationListItem, Mode } from "@/lib/db";
import QRScreen, { type StatusResponse } from "./QRScreen";
import DashboardHeader from "./DashboardHeader";
import ConversationList from "./ConversationList";
import ConversationPanel from "./ConversationPanel";
import ProductsPanel from "./ProductsPanel";
import OrdersPanel from "./OrdersPanel";
import ConfigPanel from "./ConfigPanel";
import OperationsCenter from "./OperationsCenter";

type Status = "disconnected" | "qr" | "connecting" | "connected";
type View = "chats" | "products" | "orders" | "config" | "ops";

function getStoredTenantId(): number {
  try {
    const raw = localStorage.getItem("selectedTenantId");
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function setStoredTenantId(id: number) {
  try {
    localStorage.setItem("selectedTenantId", String(id));
  } catch {
    /* ignore */
  }
}

export default function ConnectionGate() {
  const { data: session } = useSession();
  const isSuperAdmin =
    (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin ?? false;

  const [status, setStatus] = useState<Status>("disconnected");
  const [phone, setPhone] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<View>("chats");
  const [selectedTenantId, setSelectedTenantId] =
    useState<number>(getStoredTenantId);

  // Polling estado de conexión cada 2s. Si el super-admin seleccionó un tenant,
  // consultamos el estado de ESE tenant; si no, el del usuario.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const qs = selectedTenantId > 0 ? `?tenantId=${selectedTenantId}` : "";
        const res = await fetch(`/api/connection/status${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setStatus(data.status);
        setPhone(data.phone ?? null);
        setQrPng(data.qrPng ?? null);
      } catch {
        /* ignore */
      }
    };
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selectedTenantId]);

  // Polling de conversaciones cada 2s, sólo cuando estamos conectados
  const loadConversations = useCallback(async () => {
    try {
      const qs = selectedTenantId > 0 ? `?tenantId=${selectedTenantId}` : "";
      const res = await fetch(`/api/conversations${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversations: ConversationListItem[];
      };
      setConversations(data.conversations);
      // Auto-seleccionar la primera si no hay seleccionada
      setSelectedId((curr) => {
        if (curr && data.conversations.some((c) => c.id === curr)) return curr;
        return data.conversations[0]?.id ?? null;
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    void loadConversations();
    const t = setInterval(() => void loadConversations(), 2000);
    return () => clearInterval(t);
  }, [status, loadConversations, selectedTenantId]);

  const handleDeleted = () => {
    setSelectedId(null);
    void loadConversations();
  };

  const handleModeChange = (id: number, mode: Mode) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, mode } : c)),
    );
  };

  const botDisconnected = status !== "connected";

  if (botDisconnected && !isSuperAdmin) {
    return <QRScreen status={status} qrPng={qrPng} />;
  }

  return (
    <div className="flex h-screen flex-col">
      {botDisconnected && isSuperAdmin && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-800 flex items-center justify-between">
          <span>
            <strong>Modo administrador:</strong> El bot de WhatsApp está
            desconectado. Los operadores no podrán atender chats hasta que se
            reconecte.
          </span>
          <span className="text-xs text-amber-600">
            {status === "qr"
              ? "QR disponible"
              : status === "connecting"
                ? "Conectando..."
                : "Desconectado"}
          </span>
        </div>
      )}
      <DashboardHeader
        phone={phone}
        onDisconnected={() => {
          setStatus("disconnected");
          setQrPng(null);
          setPhone(null);
          setConversations([]);
          setSelectedId(null);
        }}
        selectedTenantId={selectedTenantId}
        onTenantChange={(id) => {
          setSelectedTenantId(id);
          setStoredTenantId(id);
          setSelectedId(null);
        }}
      />
      <div className="flex border-b border-gray-200 bg-white px-6 py-2 gap-2">
        <button
          onClick={() => setView("chats")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "chats"
              ? "bg-slate-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Chats
        </button>
        <button
          onClick={() => setView("products")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "products"
              ? "bg-slate-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Inventario
        </button>
        <button
          onClick={() => setView("ops")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "ops"
              ? "bg-slate-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Operaciones
        </button>
        <button
          onClick={() => setView("orders")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "orders"
              ? "bg-slate-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Pedidos
        </button>
        <button
          onClick={() => setView("config")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            view === "config"
              ? "bg-slate-900 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Configuración
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {view === "chats" ? (
          <>
            <aside className="w-80 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
              <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </aside>
            <main className="flex-1 bg-gray-50">
              {selectedId ? (
                <ConversationPanel
                  key={selectedId}
                  conversationId={selectedId}
                  onDeleted={handleDeleted}
                  onModeChange={handleModeChange}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  Seleccioná una conversación de la lista.
                </div>
              )}
            </main>
          </>
        ) : view === "ops" ? (
          <main className="flex-1 bg-gray-50 overflow-hidden">
            <OperationsCenter selectedTenantId={selectedTenantId} />
          </main>
        ) : view === "orders" ? (
          <main className="flex-1 bg-gray-50 overflow-hidden">
            <OrdersPanel selectedTenantId={selectedTenantId} />
          </main>
        ) : view === "config" ? (
          <main className="flex-1 bg-gray-50 overflow-y-auto">
            <ConfigPanel />
          </main>
        ) : (
          <main className="flex-1 bg-gray-50 overflow-y-auto">
            <ProductsPanel selectedTenantId={selectedTenantId} />
          </main>
        )}
      </div>
    </div>
  );
}
