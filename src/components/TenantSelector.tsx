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
      .catch(() => {/* ignore */});
  }, []);

  if (tenants.length === 0) return null;

  return (
    <select
      value={selectedTenantId}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-gray-50"
    >
      <option value={0}>Todos los tenants</option>
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
