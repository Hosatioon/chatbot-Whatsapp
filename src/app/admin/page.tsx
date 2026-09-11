"use client";

import { useEffect, useState, useCallback } from "react";

interface TenantOverview {
  id: number;
  name: string;
  slug: string;
  plan_name: string | null;
  plan_slug: string | null;
  daily_chat_limit: number;
  chats_today: number;
  messages_today: number;
  tokens_today: number;
  cost_today_usd: number;
  cost_month_usd: number;
  llm_calls_today: number;
  orders_today: number;
  active_products: number;
  total_conversations: number;
  status: "active" | "warning" | "critical";
}

interface GlobalTotals {
  tokens: number;
  costToday: number;
  costMonth: number;
  chats: number;
  messages: number;
  orders: number;
}

interface TenantMetrics {
  tenantId: number;
  period: string;
  metrics: {
    conversations: { today: number; total: number };
    orders: {
      created: number;
      delivered: number;
      cancelled: number;
      pending: number;
      cancellationRate: number;
    };
    sales: { today: number; month: number };
    products: {
      totalActive: number;
      top: { product_name: string; qty: number; revenue: number }[];
    };
    customers: { total: number };
    salesByDay: { date: string; orders: number; revenue: number }[];
    llm: {
      dailyCostUsd: number;
      monthlyCostUsd: number;
      dailyTokens: number;
      monthlyTokens: number;
      dailyCalls: number;
      monthlyCalls: number;
      exceeded: boolean;
      reason?: string;
      dailyUsage: {
        date: string;
        tokens: number;
        cost_usd: number;
        calls: number;
        avg_duration_ms: number;
      }[];
    };
  };
}

const STATUS_CONFIG = {
  active: {
    label: "Activo",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  warning: {
    label: "Advertencia",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
  },
  critical: {
    label: "Crítico",
    dot: "bg-red-500",
    badge: "bg-red-50 text-red-700 border-red-200",
  },
};

function formatCOP(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

function formatUSD(n: number): string {
  return `$${n.toFixed(4)}`;
}

export default function SuperAdminPage() {
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  const [totals, setTotals] = useState<GlobalTotals | null>(null);
  const [selected, setSelected] = useState<TenantOverview | null>(null);
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [period, setPeriod] = useState("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview");
      if (res.status === 403) {
        setError("Solo el super-admin puede ver esta página");
        return;
      }
      if (!res.ok) {
        setError("Error cargando datos");
        return;
      }
      const data = await res.json();
      setTenants(data.tenants);
      setTotals(data.totals);
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, []);

  const [metricsError, setMetricsError] = useState<string | null>(null);

  const loadMetrics = useCallback(async (tenantId: number, p: string) => {
    setMetricsError(null);
    try {
      const res = await fetch(
        `/api/admin/tenant/${tenantId}/metrics?period=${p}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMetricsError(j.error ?? `Error ${res.status}`);
        return;
      }
      setMetrics(await res.json());
    } catch {
      setMetricsError("Error de conexión");
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (selected) {
      setMetrics(null);
      loadMetrics(selected.id, period);
    }
  }, [selected, period, loadMetrics]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-500" />
          <p className="text-sm text-gray-500">Cargando panel...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4 flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-red-50">
            <svg
              className="h-6 w-6 text-red-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
          <p className="mb-4 text-sm text-red-600">{error}</p>
          <a
            href="/"
            className="text-sm font-medium text-emerald-600 hover:underline"
          >
            ← Volver
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <svg
                className="h-5 w-5 text-emerald-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v5.25M3.75 3h5.25M3.75 3L9 8.25M21 3v5.25M21 3h-5.25M21 3l-5.25 5.25M3.75 21v-5.25M3.75 21h5.25M3.75 21L9 15.75M21 21v-5.25M21 21h-5.25M21 21l-5.25-5.25"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Panel Super-Admin
              </h1>
              <p className="text-sm text-gray-500">
                Vista global de todos los tenants
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/admin/tenants"
              className="text-sm font-medium text-emerald-600 hover:underline"
            >
              Gestionar tenants →
            </a>
            <a
              href="/"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-gray-50"
            >
              Dashboard →
            </a>
          </div>
        </div>

        {/* Global totals */}
        {totals && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Tenants"
              value={String(tenants.length)}
              icon="building"
            />
            <StatCard
              label="Chats hoy"
              value={String(totals.chats)}
              icon="chat"
            />
            <StatCard
              label="Tokens hoy"
              value={totals.tokens.toLocaleString()}
              icon="token"
            />
            <StatCard
              label="Costo hoy"
              value={formatUSD(totals.costToday)}
              sub="USD"
              icon="cost"
            />
            <StatCard
              label="Costo mes"
              value={formatUSD(totals.costMonth)}
              sub="USD"
              icon="cost"
            />
            <StatCard
              label="Pedidos hoy"
              value={String(totals.orders)}
              icon="order"
            />
          </div>
        )}

        {/* Tenants table */}
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Estado</th>
                  <th className="px-4 py-2.5 text-left font-medium">Negocio</th>
                  <th className="px-4 py-2.5 text-left font-medium">Plan</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Chats hoy
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Tokens hoy
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Costo hoy
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Costo mes
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Pedidos
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Productos
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Contactos
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenants.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className={`cursor-pointer transition-colors ${
                      selected?.id === t.id
                        ? "bg-emerald-50"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_CONFIG[t.status].badge}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${STATUS_CONFIG[t.status].dot}`}
                        />
                        {STATUS_CONFIG[t.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{t.name}</div>
                      <div className="font-mono text-xs text-gray-400">
                        {t.slug}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {t.plan_name ?? (
                        <span className="text-gray-400">Sin plan</span>
                      )}
                      {t.daily_chat_limit > 0 && (
                        <span className="block text-xs text-gray-400">
                          límite: {t.daily_chat_limit}/día
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {t.chats_today}
                      {t.daily_chat_limit > 0 && (
                        <span className="block text-xs text-gray-400">
                          /{t.daily_chat_limit}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {t.tokens_today.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {formatUSD(t.cost_today_usd)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">
                      {formatUSD(t.cost_month_usd)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {t.orders_today}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {t.active_products}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {t.total_conversations}
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-gray-400"
                    >
                      Sin tenants
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="animate-slide-up rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {selected.name}
                </h2>
                <p className="text-sm text-gray-500">
                  ID: {selected.id} · {selected.slug}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {["today", "week", "month"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                      period === p
                        ? "bg-slate-900 text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {p === "today" ? "Hoy" : p === "week" ? "Semana" : "Mes"}
                  </button>
                ))}
                <button
                  onClick={() => setSelected(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-slate-700"
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
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {metrics ? (
              <div className="space-y-6">
                {/* Quick stats */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  <StatCard
                    label="Conversaciones"
                    value={String(metrics.metrics.conversations.today)}
                    sub={`de ${metrics.metrics.conversations.total} total`}
                  />
                  <StatCard
                    label="Pedidos"
                    value={String(metrics.metrics.orders.created)}
                    sub={`${metrics.metrics.orders.delivered} entregados`}
                  />
                  <StatCard
                    label="Ventas"
                    value={formatCOP(metrics.metrics.sales.today)}
                    sub={`mes: ${formatCOP(metrics.metrics.sales.month)}`}
                  />
                  <StatCard
                    label="Clientes"
                    value={String(metrics.metrics.customers.total)}
                  />
                  <StatCard
                    label="LLM costo hoy"
                    value={formatUSD(metrics.metrics.llm.dailyCostUsd)}
                    sub="USD"
                  />
                  <StatCard
                    label="LLM costo mes"
                    value={formatUSD(metrics.metrics.llm.monthlyCostUsd)}
                    sub="USD"
                  />
                </div>

                {/* LLM budget warning */}
                {metrics.metrics.llm.exceeded && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <svg
                      className="h-4 w-4 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                      />
                    </svg>
                    {metrics.metrics.llm.reason}
                  </div>
                )}

                {/* LLM usage detail */}
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">
                    Uso LLM (últimos 7 días)
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">
                            Fecha
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Tokens
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Costo USD
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Llamadas
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Latencia prom
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {metrics.metrics.llm.dailyUsage.map((d) => (
                          <tr
                            key={d.date}
                            className="transition-colors hover:bg-gray-50"
                          >
                            <td className="px-3 py-2 text-slate-700">
                              {d.date}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {d.tokens.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {formatUSD(d.cost_usd)}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">
                              {d.calls}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-500">
                              {Math.round(d.avg_duration_ms)}ms
                            </td>
                          </tr>
                        ))}
                        {metrics.metrics.llm.dailyUsage.length === 0 && (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-3 py-6 text-center text-gray-400"
                            >
                              Sin datos de LLM
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Top products + Sales by day */}
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700">
                      Top productos
                    </h3>
                    <div className="space-y-2">
                      {metrics.metrics.products.top.map((p, i) => (
                        <div
                          key={i}
                          className="flex justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-slate-800">
                            {p.product_name}
                          </span>
                          <span className="text-gray-500">
                            {p.qty}u · {formatCOP(p.revenue)}
                          </span>
                        </div>
                      ))}
                      {metrics.metrics.products.top.length === 0 && (
                        <p className="text-sm text-gray-400">
                          Sin ventas en este período
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-700">
                      Ventas por día
                    </h3>
                    <div className="space-y-2">
                      {metrics.metrics.salesByDay.map((d, i) => (
                        <div
                          key={i}
                          className="flex justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-slate-800">
                            {d.date}
                          </span>
                          <span className="text-gray-500">
                            {d.orders} pedidos · {formatCOP(d.revenue)}
                          </span>
                        </div>
                      ))}
                      {metrics.metrics.salesByDay.length === 0 && (
                        <p className="text-sm text-gray-400">Sin datos</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : metricsError ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <p className="text-sm text-red-600">{metricsError}</p>
                  <button
                    onClick={() => loadMetrics(selected.id, period)}
                    className="mt-3 text-sm font-medium text-emerald-600 hover:underline"
                  >
                    Reintentar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-emerald-500" />
                  <p className="text-sm text-gray-500">Cargando métricas...</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="animate-slide-up rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
