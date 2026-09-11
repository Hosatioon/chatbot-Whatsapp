"use client";

import { useEffect, useState } from "react";

interface Tenant {
  id: number;
  name: string;
}

interface Props {
  selectedTenantId: number;
  onChange: (tenantId: number) => void;
}

export default function TenantSelector({ selectedTenantId, onChange }: Props) {
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    fetch("/api/tenants")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setTenants(data);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (tenants.length === 0) return null;

  return (
    <div className="relative flex items-center">
      <svg
        className="pointer-events-none absolute left-2 h-4 w-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        />
      </svg>
      <select
        value={selectedTenantId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer truncate rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-sm font-medium text-slate-700 transition hover:border-gray-300 hover:bg-gray-50 focus:border-emerald-300 focus:outline-none"
      >
        <option value={0}>Todos los tenants</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
