"use client";

import type { ConversationListItem } from "@/lib/db";

interface Props {
  conversations: ConversationListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function relativeTime(unix: number | null): string {
  if (!unix) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: Props) {
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        Aún no hay conversaciones.
        <br />
        Esperando primer mensaje entrante...
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-200">
      {conversations.map((c) => {
        const isSelected = c.id === selectedId;
        const isAi = c.mode === "AI";
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${
                isSelected ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-900">
                  {c.name || c.phone}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    isAi
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {isAi ? "IA" : "HUMANO"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-gray-500">
                  {c.last_message_preview || "(sin mensajes)"}
                </span>
                <span className="shrink-0 text-[10px] text-gray-400">
                  {relativeTime(c.last_message_at)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
