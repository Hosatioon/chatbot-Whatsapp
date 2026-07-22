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
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <div>
          <div className="text-sm font-semibold text-slate-900">OrdiFast</div>
          <div className="text-xs text-gray-500">
            Conectado{phone ? ` · +${phone}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {canChangeTheme && (
          <SettingsDropdown
            phone={phone}
            onDisconnected={onDisconnected}
            selectedTenantId={selectedTenantId}
          />
        )}
        {isSuperAdmin && (
          <TenantSelector
            selectedTenantId={selectedTenantId}
            onChange={onTenantChange}
          />
        )}
      </div>
    </header>
  );
}
