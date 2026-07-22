"use client";

import { useTheme, type TenantTheme } from "./ThemeProvider";

const THEME_OPTIONS: { value: TenantTheme; label: string; swatch: string }[] = [
  { value: "light", label: "Claro", swatch: "#f3f4f6" },
  { value: "dark", label: "Oscuro", swatch: "#0f172a" },
  { value: "blue", label: "Azul", swatch: "#bfdbfe" },
  { value: "pink", label: "Rosa", swatch: "#fbcfe8" },
  { value: "whatsapp", label: "WhatsApp", swatch: "#25D366" },
];

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white p-1">
      {THEME_OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => void setTheme(opt.value)}
            title={opt.label}
            aria-label={`Tema ${opt.label}`}
            className={`flex h-7 w-7 items-center justify-center rounded-md border-2 transition ${
              active
                ? "border-emerald-500 ring-2 ring-emerald-200"
                : "border-transparent hover:border-gray-300"
            }`}
            style={{ backgroundColor: opt.swatch }}
          >
            {active && (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke={opt.value === "dark" ? "#f1f5f9" : "#0f172a"}
                strokeWidth={3}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
