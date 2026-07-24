"use client";

import { useState, useEffect } from "react";

interface Metrics {
  conversations: {
    today: number;
    total: number;
    byAI: number;
    byHuman: number;
    avgResponseTime: number | null;
  };
  orders: {
    created: number;
    delivered: number;
    cancelled: number;
    pending: number;
    preparing: number;
    onTheWay: number;
    confirmed: number;
    cancellationRate: number;
    avgDeliveryTime: number | null;
  };
  sales: {
    today: number;
    month: number;
  };
  products: {
    top: { product_name: string; qty: number; revenue: number }[];
    bottom: { product_name: string; qty: number; revenue: number }[];
    noSales: { name: string; stock: number; price: number }[];
    lowStock: { name: string; stock: number; price: number }[];
    totalActive: number;
  };
  customers: {
    new: number;
    recurring: number;
    total: number;
    top: { customer_phone: string; customer_name: string | null; order_count: number; total_spent: number; last_order: number }[];
  };
  salesByDay: { date: string; orders: number; revenue: number }[];
}

interface Props {
  selectedTenantId: number;
}

const PERIODS = [
  { label: "Hoy", value: "today" },
  { label: "Esta semana", value: "week" },
  { label: "Este mes", value: "month" },
] as const;

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}min`;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("es-CO")}`;
}

export default function OperationsCenter({ selectedTenantId }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("today");
  const [periodLabel, setPeriodLabel] = useState("Hoy");

  const loadMetrics = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await fetch(`/api/metrics?period=${period}`);
      if (!res.ok) throw new Error("Error al cargar métricas");
      const data = await res.json();
      setMetrics(data.metrics);
      setPeriodLabel(data.period);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [selectedTenantId, period]);

  useEffect(() => {
    const interval = setInterval(() => loadMetrics(true), 15000);
    return () => clearInterval(interval);
  }, [selectedTenantId, period]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-500">Cargando Centro de Operaciones...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!metrics) return null;

  const m = metrics;

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Centro de Operaciones</h1>
          <p className="text-sm text-gray-500">Periodo: {periodLabel}</p>
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                period === p.value
                  ? "bg-slate-900 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Resumen operativo */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Operación</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Pedidos pendientes */}
          <div className="rounded-xl border border-yellow-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-100 text-yellow-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Pendientes</span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{m.orders.pending}</div>
          </div>

          {/* Pedidos confirmados */}
          <div className="rounded-xl border border-blue-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Confirmados</span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{m.orders.confirmed}</div>
          </div>

          {/* En preparación */}
          <div className="rounded-xl border border-purple-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <span className="text-xs font-medium text-gray-500">Preparando</span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{m.orders.preparing}</div>
          </div>

          {/* En camino */}
          <div className="rounded-xl border border-orange-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1" /></svg>
              </div>
              <span className="text-xs font-medium text-gray-500">En camino</span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{m.orders.onTheWay}</div>
          </div>
        </div>
      </div>

      {/* Conversaciones */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Conversaciones</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Conversaciones del periodo</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{m.conversations.today}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Atendidas por IA</span>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{m.conversations.byAI}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Transferidas a humano</span>
            <div className="mt-1 text-2xl font-bold text-amber-700">{m.conversations.byHuman}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Tiempo prom. respuesta</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {m.conversations.avgResponseTime ? formatTime(m.conversations.avgResponseTime) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Ventas */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Ventas</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-green-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Pedidos creados</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{m.orders.created}</div>
          </div>
          <div className="rounded-xl border border-green-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Entregados</span>
            <div className="mt-1 text-2xl font-bold text-green-700">{m.orders.delivered}</div>
          </div>
          <div className="rounded-xl border border-red-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Cancelados</span>
            <div className="mt-1 text-2xl font-bold text-red-700">{m.orders.cancelled}</div>
            {m.orders.cancellationRate > 0 && (
              <div className="text-xs text-red-500">{m.orders.cancellationRate}% tasa</div>
            )}
          </div>
          <div className="rounded-xl border border-green-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Valor vendido ({periodLabel})</span>
            <div className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(m.sales.today)}</div>
          </div>
        </div>

        {/* Valor del mes + tiempo entrega */}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Valor vendido este mes</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{formatCurrency(m.sales.month)}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Tiempo prom. pedido → entrega</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {m.orders.avgDeliveryTime ? formatTime(m.orders.avgDeliveryTime) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Productos · {m.products.totalActive} activos
        </h2>

        {/* Top y bottom en dos columnas */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Más vendidos */}
          {m.products.top.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold text-emerald-700">Más vendidos</h3>
              <div className="space-y-2">
                {m.products.top.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                        {idx + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-900">{p.product_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">{p.qty} und.</span>
                      <span className="text-sm font-semibold text-slate-900">{formatCurrency(p.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Menos vendidos */}
          {m.products.bottom.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold text-orange-700">Menos vendidos</h3>
              <div className="space-y-2">
                {m.products.bottom.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">
                        {idx + 1}
                      </span>
                      <span className="text-sm font-medium text-slate-900">{p.product_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">{p.qty} und.</span>
                      <span className="text-sm font-semibold text-slate-900">{formatCurrency(p.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sin ventas */}
        {m.products.noSales.length > 0 && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-gray-500">
              Sin ventas en {periodLabel} · {m.products.noSales.length} productos
            </h3>
            <div className="flex flex-wrap gap-2">
              {m.products.noSales.map((p, idx) => (
                <span key={idx} className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                  {p.name} <span className="text-gray-400">· stock: {p.stock}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stock bajo */}
        {m.products.lowStock.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="mb-3 text-xs font-semibold text-red-700">
              Stock bajo (≤ 5) · {m.products.lowStock.length} productos
            </h3>
            <div className="space-y-2">
              {m.products.lowStock.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900">{p.name}</span>
                  <span className={`text-sm font-bold ${p.stock === 0 ? "text-red-600" : "text-red-500"}`}>
                    {p.stock} und.
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Clientes */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Clientes</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Total</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{m.customers.total}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Nuevos</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{m.customers.new}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <span className="text-xs font-medium text-gray-500">Recurrentes</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{m.customers.recurring}</div>
          </div>
        </div>

        {/* Top clientes */}
        {m.customers.top.length > 0 && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold text-gray-500">Clientes más frecuentes</h3>
            <div className="space-y-2">
              {m.customers.top.map((c, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {idx + 1}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-slate-900">
                        {c.customer_name || c.customer_phone}
                      </span>
                      {c.customer_name && (
                        <span className="ml-2 text-xs text-gray-400">{c.customer_phone}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-500">{c.order_count} ped.</span>
                    <span className="text-sm font-semibold text-slate-900">{formatCurrency(c.total_spent)}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(c.last_order * 1000).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ventas por día */}
      {m.salesByDay.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Ventas por día (últimos 7 días)</h2>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="space-y-2">
              {m.salesByDay.map((day) => {
                const maxRevenue = Math.max(...m.salesByDay.map((d) => d.revenue), 1);
                const barWidth = Math.round((day.revenue / maxRevenue) * 100);
                return (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-24 text-xs text-gray-500">
                      {new Date(day.date + "T00:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "2-digit", month: "2-digit" })}
                    </span>
                    <div className="flex-1">
                      <div className="h-6 rounded bg-gray-100 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-20 text-right text-sm font-medium text-slate-900">{formatCurrency(day.revenue)}</span>
                    <span className="w-12 text-right text-xs text-gray-500">{day.orders} ped.</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="pb-6 text-center text-xs text-gray-400">
        Actualización automática cada 15 segundos
      </div>
    </div>
  );
}
