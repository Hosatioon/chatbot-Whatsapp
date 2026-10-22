"use client";

import type { ReactNode } from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export default function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: SwitchProps) {
  return (
    <label
      className={`flex items-start gap-2 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className="relative mt-0.5 h-5 w-9 flex-none rounded-full bg-gray-300 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300 peer-focus-visible:ring-offset-1"
        aria-hidden="true"
      />
      <span className="text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}
