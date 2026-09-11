"use client";

import { useState } from "react";
import type { Mode } from "@/lib/db";

interface Props {
  conversationId: number;
  mode: Mode;
  onChange: (next: Mode) => void;
}

export default function ModeToggle({ conversationId, mode, onChange }: Props) {
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    if (pending) return;
    const next: Mode = mode === "AI" ? "HUMAN" : "AI";
    setPending(true);
    try {
      const res = await fetch(`/api/mode/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (res.ok) onChange(next);
    } finally {
      setPending(false);
    }
  };

  const isAi = mode === "AI";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        isAi
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
      } ${pending ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          isAi ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {isAi ? "Modo IA" : "Modo Humano"}
      <span className="hidden text-xs text-gray-500 sm:inline">
        (click para cambiar)
      </span>
    </button>
  );
}
