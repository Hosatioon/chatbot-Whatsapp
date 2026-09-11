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
      <div className="flex flex-col items-center gap-3 p-8 text-center text-gray-400">
        <svg
          className="h-10 w-10"
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
        <div className="text-sm">
          Aún no hay conversaciones.
          <br />
          Esperando primer mensaje entrante...
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {conversations.map((c, i) => {
        const isSelected = c.id === selectedId;
        const isAi = c.mode === "AI";
        const initial = (c.name || c.phone || "?").charAt(0).toUpperCase();
        const staggerClass = i < 6 ? `stagger-${i + 1}` : "";
        return (
          <li key={c.id} className={`animate-slide-in-left ${staggerClass}`}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-all duration-200 ${
                isSelected ? "bg-emerald-50" : "hover:bg-gray-50"
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  isSelected
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {initial}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
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
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
