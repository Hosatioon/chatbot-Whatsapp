"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationListItem, Mode } from "@/lib/db";
import QRScreen, { type StatusResponse } from "./QRScreen";
import DashboardHeader from "./DashboardHeader";
import ConversationList from "./ConversationList";
import ConversationPanel from "./ConversationPanel";

type Status = "disconnected" | "qr" | "connecting" | "connected";

export default function ConnectionGate() {
  const [status, setStatus] = useState<Status>("disconnected");
  const [phone, setPhone] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Polling estado de conexión cada 2s
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/connection/status", {
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
  }, []);

  // Polling de conversaciones cada 2s, sólo cuando estamos conectados
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
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
  }, [status, loadConversations]);

  const handleDeleted = () => {
    setSelectedId(null);
    void loadConversations();
  };

  const handleModeChange = (id: number, mode: Mode) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, mode } : c)),
    );
  };

  if (status !== "connected") {
    return <QRScreen status={status} qrPng={qrPng} />;
  }

  return (
    <div className="flex h-screen flex-col">
      <DashboardHeader
        phone={phone}
        onDisconnected={() => {
          setStatus("disconnected");
          setQrPng(null);
          setPhone(null);
          setConversations([]);
          setSelectedId(null);
        }}
      />
      <div className="flex min-h-0 flex-1">
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
      </div>
    </div>
  );
}
