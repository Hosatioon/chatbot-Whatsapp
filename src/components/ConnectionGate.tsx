"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
type View = "home" | "chats" | "products" | "orders" | "config" | "ops";

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
  // BUG real encontrado (2026-09-15): el polling de conversaciones (cada
  // 2s) auto-seleccionaba la primera conversación cada vez que selectedId
  // era null — incluyendo cuando el usuario acababa de volver a la lista a
  // propósito en mobile (botón "<"). El resultado: dabas "atrás" y en
  // menos de 2 segundos el poll te metía otra vez al mismo chat, sin poder
  // revisar los demás. Esta ref marca "el usuario salió a propósito, no
  // reselecciones sola" — se prende en el botón atrás y se apaga en
  // cualquier selección real (manual, cambio de tenant, reconexión).
  const skipAutoSelectRef = useRef(false);
  const [view, setView] = useState<View>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get("view");
      if (
        v === "home" ||
        v === "chats" ||
        v === "orders" ||
        v === "products" ||
        v === "config" ||
        v === "ops"
      ) {
        return v as View;
      }
    } catch {
      /* ignore */
    }
    return isSuperAdmin ? "home" : "chats";
  });
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
      // Auto-seleccionar la primera solo si no estamos en la vista home de admin
      setSelectedId((curr) => {
        if (curr && data.conversations.some((c) => c.id === curr)) return curr;
        if (view === "home") return null;
        if (skipAutoSelectRef.current) return null;
        return data.conversations[0]?.id ?? null;
      });
    } catch {
      /* ignore */
    }
  }, [selectedTenantId]);

  useEffect(() => {
    if (status !== "connected") return;
    void loadConversations();
    const t = setInterval(() => void loadConversations(), 2000);
    return () => clearInterval(t);
  }, [status, loadConversations, selectedTenantId]);

  const handleDeleted = () => {
    skipAutoSelectRef.current = false;
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

  const TAB_ICONS: Record<View, string> = {
    home: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25",
    chats:
      "M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z",
    products:
      "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
    orders:
      "M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
    config:
      "M9.594 3.94c.09-.522.23-.94.37-1.216l.002-.002c.164-.338.413-.6.68-.774C10.913 2.774 11.27 2.7 11.62 2.7h.76c.35 0 .708.074 1.064.248.267.174.516.436.68.774l.002.002c.14.275.28.694.37 1.216.068.39.124.834.184 1.272l.054.382c.45.078.896.193 1.332.342l.275-.227c.336-.276.672-.527.999-.727.252-.154.536-.276.838-.327.372-.062.787-.023 1.178.197.39.22.658.544.834.874l.38.658c.176.33.293.745.23 1.118-.053.302-.176.586-.33.838-.251.327-.502.663-.778.999l-.197.239c.149.436.264.882.342 1.332l.329.047c.438.06.878.116 1.272.184.522.09.94.23 1.216.37l.002.002c.338.164.6.413.774.68.174.356.248.714.248 1.064v.76c0 .35-.074.708-.248 1.064-.174.267-.436.516-.774.68l-.002.002c-.275.14-.694.28-1.216.37-.39.068-.834.124-1.272.184l-.329.047c-.078.45-.193.896-.342 1.332l.197.239c.276.336.527.672.778.999.154.252.277.536.327.838.063.372.023.787-.197 1.178-.22.39-.544.658-.874.834l-.658.38c-.33.176-.745.293-1.118.23-.302-.053-.586-.176-.838-.33-.327-.251-.663-.502-.999-.778l-.239-.197c-.436.149-.882.264-1.332.342l-.047.329c-.06.438-.116.878-.184 1.272-.09.522-.23.94-.37 1.216l-.002.002c-.164.338-.413.6-.68.774-.356.174-.714.248-1.064.248h-.76c-.35 0-.708-.074-1.064-.248a1.55 1.55 0 01-.68-.774l-.002-.002c-.14-.275-.28-.694-.37-1.216-.068-.39-.124-.834-.184-1.272l-.054-.382a8.5 8.5 0 01-1.332-.342l-.275.227c-.336.276-.672.527-.999.727-.252.154-.536.276-.838.327-.372.062-.787.023-1.178-.197-.39-.22-.658-.544-.834-.874l-.38-.658c-.176-.33-.293-.745-.23-1.118.053-.302.176-.586.33-.838.251-.327.502-.663.778-.999l.197-.239a8.5 8.5 0 01-.342-1.332l-.329-.047c-.438-.06-.878-.116-1.272-.184-.522-.09-.94-.23-1.216-.37l-.002-.002a1.55 1.55 0 01-.774-.68 2.36 2.36 0 01-.248-1.064v-.76c0-.35.074-.708.248-1.064.174-.267.436-.516.774-.68l.002-.002c.275-.14.694-.28 1.216-.37.39-.068.834-.124 1.272-.184l.329-.047c.078-.45.193-.896.342-1.332l-.197-.239a8.5 8.5 0 01-.778-.999 2.36 2.36 0 01-.327-.838 1.55 1.55 0 01.197-1.178c.22-.39.544-.658.874-.834l.658-.38c.33-.176.745-.293 1.118-.23.302.053.586.176.838.33.327.251.663.502.999.778l.239.197c.436-.149.882-.264 1.332-.342l.047-.329c.06-.438.116-.878.184-1.272z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    ops: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625C9.75 8.004 10.254 7.5 10.875 7.5h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  };

  const TABS: { key: View; label: string }[] = isSuperAdmin
    ? [
        { key: "home", label: "Inicio" },
        { key: "chats", label: "Chats" },
        { key: "products", label: "Inventario" },
        { key: "ops", label: "Operaciones" },
        { key: "orders", label: "Pedidos" },
        { key: "config", label: "Configuración" },
      ]
    : [
        { key: "chats", label: "Chats" },
        { key: "products", label: "Inventario" },
        { key: "ops", label: "Operaciones" },
        { key: "orders", label: "Pedidos" },
        { key: "config", label: "Configuración" },
      ];

  return (
    // BUG real encontrado (2026-09-15): `h-screen` (100vh) en un layout
    // hijo de un <body> con `min-h-screen` se ve mal en el navegador móvil
    // — 100vh no descuenta la barra de direcciones, así que el shell mide
    // más que el área visible real y el body (que sí puede crecer, por el
    // min-height) deja hacer scroll de TODA la página para alcanzar lo que
    // "sobra" abajo. `fixed inset-0` fija este shell al viewport visual
    // real del navegador, sin importar el body — nunca hace falta mover la
    // pantalla completa; solo las listas internas (chats, mensajes)
    // scrollean, como en WhatsApp Web.
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      {botDisconnected && isSuperAdmin && (
        <div className="animate-slide-down flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:flex-nowrap sm:px-6">
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <span>
            <strong>Modo administrador:</strong>{" "}
            <span className="hidden sm:inline">
              El bot de WhatsApp está desconectado. Los operadores no podrán
              atender chats hasta que se reconecte.
            </span>
            <span className="sm:hidden">Bot de WhatsApp desconectado.</span>
          </span>
          <span className="ml-0 shrink-0 text-xs text-amber-600 sm:ml-auto">
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
          skipAutoSelectRef.current = false;
          setSelectedId(null);
        }}
        selectedTenantId={selectedTenantId}
        onTenantChange={(id) => {
          setSelectedTenantId(id);
          setStoredTenantId(id);
          skipAutoSelectRef.current = false;
          setSelectedId(null);
        }}
      />
      {/* En mobile cada tab ocupa una porción igual de TODO el ancho —
          blanco táctil grande, fácil de acertar con el dedo, como una
          bottom-nav real. Desde sm+ vuelve al tamaño ajustado al
          contenido, empacado a la izquierda (así queda en PC). */}
      <nav className="flex items-stretch border-b border-gray-200 bg-white sm:items-center sm:gap-1 sm:overflow-x-auto sm:px-6 sm:py-2">
        {TABS.map((tab) => {
          const isActive = view === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              title={tab.label}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-all duration-200 sm:flex-none sm:flex-row sm:gap-1.5 sm:rounded-lg sm:px-3 sm:py-1.5 sm:text-sm ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm sm:bg-slate-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-slate-900"
              }`}
            >
              <svg
                className="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={TAB_ICONS[tab.key]}
                />
              </svg>
              <span className="max-w-full truncate px-0.5 sm:hidden">
                {tab.label}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="flex min-h-0 flex-1">
        {view === "home" && isSuperAdmin ? (
          <main className="flex-1 animate-fade-in overflow-y-auto bg-gray-50 p-6 sm:p-10">
            <div className="mx-auto max-w-4xl">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">
                  Bienvenido, Super Admin
                </h1>
                <p className="text-sm text-gray-500">
                  Panel de control general de OrdiFast. Seleccioná un tenant
                  para operar.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <a
                  href="/admin"
                  className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.75 3v5.25M3.75 3h5.25M3.75 3L9 8.25M21 3v5.25M21 3h-5.25M21 3l-5.25 5.25M3.75 21v-5.25M3.75 21h5.25M3.75 21L9 15.75M21 21v-5.25M21 21h-5.25M21 21l-5.25-5.25"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-emerald-700">
                      Panel Super-Admin
                    </div>
                    <div className="text-xs text-gray-500">
                      Métricas, tenants y estado global
                    </div>
                  </div>
                </a>

                <a
                  href="/admin/tenants"
                  className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-blue-700">
                      Crear tenant
                    </div>
                    <div className="text-xs text-gray-500">
                      Nuevo negocio con usuario admin
                    </div>
                  </div>
                </a>

                <button
                  onClick={() => setView("chats")}
                  className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-amber-700">
                      Chats del tenant
                    </div>
                    <div className="text-xs text-gray-500">
                      Ver conversaciones del tenant seleccionado
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setView("ops")}
                  className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625C9.75 8.004 10.254 7.5 10.875 7.5h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-violet-700">
                      Operaciones
                    </div>
                    <div className="text-xs text-gray-500">
                      Métricas del tenant activo
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setView("orders")}
                  className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-rose-700">
                      Pedidos
                    </div>
                    <div className="text-xs text-gray-500">
                      Gestión de pedidos del tenant
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setView("config")}
                  className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left transition-all hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.594 3.94c.09-.522.23-.94.37-1.216l.002-.002c.164-.338.413-.6.68-.774C10.913 2.774 11.27 2.7 11.62 2.7h.76c.35 0 .708.074 1.064.248.267.174.516.436.68.774l.002.002c.14.275.28.694.37 1.216.068.39.124.834.184 1.272l.054.382c.45.078.896.193 1.332.342l.275-.227c.336-.276.672-.527.999-.727.252-.154.536-.276.838-.327.372-.062.787-.023 1.178.197.39.22.658.544.834.874l.38.658c.176.33.293.745.23 1.118-.053.302-.176.586-.33.838-.251.327-.502.663-.778.999l-.197.239c.149.436.264.882.342 1.332l.329.047c.438.06.878.116 1.272.184.522.09.94.23 1.216.37l.002.002c.338.164.6.413.774.68.174.356.248.714.248 1.064v.76c0 .35-.074.708-.248 1.064-.174.267-.436.516-.774.68l-.002.002c-.275.14-.694.28-1.216.37-.39.068-.834.124-1.272.184l-.329.047c-.078.45-.193.896-.342 1.332l.197.239c.276.336.527.672.778.999.154.252.277.536.327.838.063.372.023.787-.197 1.178-.22.39-.544.658-.874.834l-.658.38c-.33.176-.745.293-1.118.23-.302-.053-.586-.176-.838-.33-.327-.251-.663-.502-.999-.778l-.239-.197c-.436.149-.882.264-1.332.342l-.047.329c-.06.438-.116.878-.184 1.272-.09.522-.23.94-.37 1.216l-.002.002c-.164.338-.413.6-.68.774-.356.174-.714.248-1.064.248h-.76c-.35 0-.708-.074-1.064-.248a1.55 1.55 0 01-.68-.774l-.002-.002c-.14-.275-.28-.694-.37-1.216-.068-.39-.124-.834-.184-1.272l-.054-.382a8.5 8.5 0 01-1.332-.342l-.275.227c-.336.276-.672.527-.999.727-.252.154-.536.276-.838.327-.372.062-.787.023-1.178-.197-.39-.22-.658-.544-.834-.874l-.38-.658c-.176-.33-.293-.745-.23-1.118.053-.302.176-.586.33-.838.251-.327.502-.663.778-.999l.197-.239a8.5 8.5 0 01-.342-1.332l-.329-.047c-.438-.06-.878-.116-1.272-.184-.522-.09-.94-.23-1.216-.37l-.002-.002a1.55 1.55 0 01-.774-.68 2.36 2.36 0 01-.248-1.064v-.76c0-.35.074-.708.248-1.064.174-.267.436-.516.774-.68l.002-.002c.275-.14.694-.28 1.216-.37.39-.068.834-.124 1.272-.184l.329-.047c.078-.45.193-.896.342-1.332l-.197-.239a8.5 8.5 0 01-.778-.999 2.36 2.36 0 01-.327-.838 1.55 1.55 0 01.197-1.178c.22-.39.544-.658.874-.834l.658-.38c.33-.176.745-.293 1.118-.23.302.053.586.176.838.33.327.251.663.502.999.778l.239.197c.436-.149.882-.264 1.332-.342l.047-.329c.06-.438.116-.878.184-1.272.09-.522.23-.94.37-1.216l.002-.002c.164-.338.413-.6.68-.774.356-.174.714-.248 1.064-.248h.76c.35 0 .708.074 1.064.248.267.174.516.436.68.774.164.338.354.415.68.774z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-gray-700">
                      Configuración
                    </div>
                    <div className="text-xs text-gray-500">
                      Ajustes del tenant seleccionado
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </main>
        ) : view === "chats" ? (
          <>
            <aside
              className={`${selectedId ? "hidden md:block" : "block"} w-full shrink-0 overflow-y-auto border-r border-gray-200 bg-white md:w-80`}
            >
              <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={(id) => {
                  skipAutoSelectRef.current = false;
                  setSelectedId(id);
                }}
              />
            </aside>
            <main
              className={`${selectedId ? "block" : "hidden md:block"} min-w-0 flex-1 bg-gray-50`}
            >
              {selectedId ? (
                <div key={selectedId} className="animate-fade-in h-full min-w-0">
                  <ConversationPanel
                    conversationId={selectedId}
                    onDeleted={handleDeleted}
                    onModeChange={handleModeChange}
                    onBack={() => {
                      skipAutoSelectRef.current = true;
                      setSelectedId(null);
                    }}
                  />
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
                  <svg
                    className="h-12 w-12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
                    />
                  </svg>
                  <span className="text-sm">
                    Seleccioná una conversación de la lista.
                  </span>
                </div>
              )}
            </main>
          </>
        ) : view === "ops" ? (
          <main className="flex-1 animate-fade-in bg-gray-50 overflow-hidden">
            <OperationsCenter selectedTenantId={selectedTenantId} />
          </main>
        ) : view === "orders" ? (
          <main className="flex-1 animate-fade-in bg-gray-50 overflow-hidden">
            <OrdersPanel selectedTenantId={selectedTenantId} />
          </main>
        ) : view === "config" ? (
          <main className="flex-1 animate-fade-in bg-gray-50 overflow-y-auto">
            <ConfigPanel
              key={selectedTenantId}
              selectedTenantId={selectedTenantId}
            />
          </main>
        ) : (
          <main className="flex-1 animate-fade-in bg-gray-50 overflow-y-auto">
            <ProductsPanel selectedTenantId={selectedTenantId} />
          </main>
        )}
      </div>
    </div>
  );
}
