"use client";

import { useSession } from "next-auth/react";
import TenantSelector from "./TenantSelector";
import SettingsDropdown from "./SettingsDropdown";

interface Props {
  phone: string | null;
  onDisconnected: () => void;
  selectedTenantId: number;
  onTenantChange: (tenantId: number) => void;
}

export default function DashboardHeader({
  phone,
  onDisconnected,
  selectedTenantId,
  onTenantChange,
}: Props) {
  const { data: session } = useSession();

  const isSuperAdmin =
    (session?.user as { isSuperAdmin?: boolean })?.isSuperAdmin ?? false;
  const role = (session?.user as { role?: string })?.role;
  const canChangeTheme = role === "ADMIN" || isSuperAdmin;

  return (
    <header className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="relative flex h-11 w-11 items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ordifast-icon.png"
            alt="OrdiFast"
            width={44}
            height={44}
            className="h-11 w-11 object-contain"
          />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            <span
              className="absolute inline-flex h-full w-full rounded-full bg-emerald-500"
              style={{ animation: "pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}
            />
            <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-tight text-slate-900">
            OrdiFast
          </div>
          <div className="truncate text-[11px] text-gray-500">
            {phone ? `+${phone}` : "Conectando..."}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {isSuperAdmin && (
          <a
            href="/admin"
            title="Panel Admin"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 transition-all hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 sm:px-3"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v5.25M3.75 3h5.25M3.75 3L9 8.25M21 3v5.25M21 3h-5.25M21 3l-5.25 5.25M3.75 21v-5.25M3.75 21h5.25M3.75 21L9 15.75M21 21v-5.25M21 21h-5.25M21 21l-5.25-5.25"
              />
            </svg>
            <span className="hidden sm:inline">Panel Admin</span>
          </a>
        )}
        {canChangeTheme && (
          <SettingsDropdown
            phone={phone}
            onDisconnected={onDisconnected}
            selectedTenantId={selectedTenantId}
          />
        )}
        {isSuperAdmin && (
          <div className="max-w-[8rem] sm:max-w-none">
            <TenantSelector
              selectedTenantId={selectedTenantId}
              onChange={onTenantChange}
            />
          </div>
        )}
      </div>
    </header>
  );
}
