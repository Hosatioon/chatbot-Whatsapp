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
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-medium transition sm:gap-2 sm:px-3 sm:text-sm ${
        isAi
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
      } ${pending ? "opacity-60" : ""}`}
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          isAi ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {/* Etiqueta corta en mobile ("IA"/"Humano") — la versión larga
          ("Modo IA"/"Modo Humano") no cabía junto al botón Borrar en
          pantallas angostas y quedaba cortada contra el borde. */}
      <span className="sm:hidden">{isAi ? "IA" : "Humano"}</span>
      <span className="hidden sm:inline">
        {isAi ? "Modo IA" : "Modo Humano"}
      </span>
      <span className="hidden text-xs text-gray-500 lg:inline">
        (click para cambiar)
      </span>
    </button>
  );
}
