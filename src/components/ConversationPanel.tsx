"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation, Message, Mode } from "@/lib/db";
import MessageBubble from "./MessageBubble";
import ModeToggle from "./ModeToggle";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  conversationId: number;
  onDeleted: () => void;
  onModeChange: (id: number, mode: Mode) => void;
  onBack?: () => void;
}

export default function ConversationPanel({
  conversationId,
  onDeleted,
  onModeChange,
  onBack,
}: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Polling cada 2s
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/messages/${conversationId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          conversation: Conversation;
          messages: Message[];
        };
        if (cancelled) return;
        setConversation(data.conversation);
        setMessages(data.messages);
      } catch {
        /* ignore */
      }
    };

    void load();
    const interval = setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  // Auto-scroll al final cuando llegan mensajes nuevos
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messages/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) setDraft("");
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (res.ok) onDeleted();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-500" />
        <span className="text-sm">Cargando conversación...</span>
      </div>
    );
  }

  const isHuman = conversation.mode === "HUMAN";

  return (
    // min-w-0: sin esto, un mensaje con una URL larga (los links de mapa que
    // manda el bot) puede forzar este flex-col a medir más ancho que la
    // pantalla — el navbar de arriba (con Modo/Borrar) y las burbujas de la
    // derecha terminaban empujadas fuera del viewport visible.
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 rounded-lg p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-slate-900 md:hidden"
              aria-label="Volver a la lista"
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
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">
              {conversation.name || conversation.phone}
            </div>
            <div className="truncate text-xs text-gray-500">
              {conversation.phone}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ModeToggle
            conversationId={conversation.id}
            mode={conversation.mode}
            onChange={(next) => {
              setConversation({ ...conversation, mode: next });
              onModeChange(conversation.id, next);
            }}
          />
          {/* Icono solo en mobile (con el nombre del contacto + el toggle de
              modo, "Borrar" con texto no cabía y quedaba cortado contra el
              borde de la pantalla). */}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            aria-label="Borrar conversación"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100 disabled:opacity-60 sm:px-3 sm:py-1.5 sm:text-sm sm:font-medium"
          >
            <svg
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
            <span className="hidden sm:inline">Borrar</span>
          </button>
        </div>
      </header>

      {/* Mensajes */}
      <div
        ref={scrollRef}
        className="min-w-0 flex-1 space-y-2 overflow-y-auto bg-gray-50 p-4"
      >
        {messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            Sin mensajes todavía.
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              role={m.role}
              content={m.content}
              createdAt={m.created_at}
              deliveryStatus={m.delivery_status}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <footer className="border-t border-gray-200 bg-white p-3">
        {isHuman ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Escribe un mensaje..."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending || !draft.trim()}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">
            El bot responde automáticamente. Pasa a modo Humano para escribir.
          </div>
        )}
      </footer>

      {/* Confirmación borrar conversación */}
      <ConfirmDialog
        open={confirmDelete}
        title="¿Borrar esta conversación?"
        description="Se eliminarán todos los mensajes y el estado del pedido. Esta acción no se puede deshacer."
        confirmText={deleting ? "Borrando..." : "Borrar"}
        cancelText="Cancelar"
        destructive={true}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
