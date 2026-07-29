"use client";

import { useState, useEffect, useRef } from "react";
import type {
  Order,
  OrderStatus,
  OrderItem,
  OrderHistoryEntry,
} from "@/lib/db";

// Reproducir un "ding" de notificación con Web Audio API (sin archivos)
function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Dos tonos cortos tipo "ding-dong"
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.3, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    };

    playTone(880, 0, 0.18); // La5
    playTone(1175, 0.18, 0.25); // Re6
  } catch (err) {
    console.error("No se pudo reproducir el sonido:", err);
  }
}

// Mostrar notificación del navegador
function showNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: "new-order",
    });
  } catch (err) {
    console.error("No se pudo mostrar notificación:", err);
  }
}

interface Props {
  selectedTenantId: number;
}

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "ON_THE_WAY",
  "DELIVERED",
  "CANCELLED",
];

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  CONFIRMED: "bg-blue-100 text-blue-800 border-blue-200",
  PREPARING: "bg-purple-100 text-purple-800 border-purple-200",
  ON_THE_WAY: "bg-orange-100 text-orange-800 border-orange-200",
  DELIVERED: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  PREPARING: "Preparando",
  ON_THE_WAY: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

const FLOW_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "ON_THE_WAY",
  "DELIVERED",
];

const CANCEL_REASONS = [
  "Cliente canceló",
  "Sin stock",
  "Error del operador",
  "Duplicado",
  "Otro",
];

const DATE_FILTERS = [
  { label: "Todos", value: "all" },
  { label: "Hoy", value: "today" },
  { label: "Ayer", value: "yesterday" },
  { label: "Esta semana", value: "week" },
  { label: "Este mes", value: "month" },
] as const;

function getDateRange(filter: string): { from?: number; to?: number } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  switch (filter) {
    case "today":
      return {
        from: Math.floor(todayStart.getTime() / 1000),
        to: Math.floor(todayEnd.getTime() / 1000),
      };
    case "yesterday":
      return {
        from: Math.floor(todayStart.getTime() / 1000) - 86400,
        to: Math.floor(todayStart.getTime() / 1000),
      };
    case "week": {
      const day = todayStart.getDay();
      const weekStart = new Date(todayStart.getTime() - day * 86400000);
      return { from: Math.floor(weekStart.getTime() / 1000) };
    }
    case "month": {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: Math.floor(monthStart.getTime() / 1000) };
    }
    default:
      return {};
  }
}

export default function OrdersPanel({ selectedTenantId }: Props) {
  const [orders, setOrders] = useState<(Order & { item_count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<"ALL" | OrderStatus>(
    "ALL",
  );
  const [selectedOrder, setSelectedOrder] = useState<
    (Order & { items: OrderItem[] }) | null
  >(null);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    customer_name: "",
    customer_phone: "",
    notes: "",
  });

  const connected = true;
  const seenOrderIdsRef = useRef<Set<number>>(new Set());
  const initializedRef = useRef(false);

  const loadOrders = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (selectedTenantId > 0)
        params.append("tenantId", String(selectedTenantId));
      if (selectedStatus !== "ALL") params.append("status", selectedStatus);
      params.append("limit", "50");

      const range = getDateRange(dateFilter);
      if (range.from) params.append("dateFrom", String(range.from));
      if (range.to) params.append("dateTo", String(range.to));
      if (searchQuery.trim()) params.append("search", searchQuery.trim());

      const response = await fetch(`/api/orders?${params.toString()}`);
      if (!response.ok) throw new Error("Error al cargar pedidos");

      const data = await response.json();
      const newOrders = data.orders || [];

      if (initializedRef.current && notificationsEnabled) {
        const fresh = newOrders.filter(
          (o: Order) => !seenOrderIdsRef.current.has(o.id),
        );
        if (fresh.length > 0) {
          playNotificationSound();
          const first = fresh[0];
          showNotification(
            `Nuevo pedido #${first.id}`,
            `${first.customer_name || first.customer_phone} · ${fresh.length > 1 ? `+${fresh.length - 1} más` : ""}`.trim(),
          );
        }
      }

      seenOrderIdsRef.current = new Set(newOrders.map((o: Order) => o.id));
      initializedRef.current = true;
      setOrders(newOrders);
    } catch (err) {
      if (!silent)
        setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result !== "granted") {
          alert("Permiso de notificaciones denegado.");
          return;
        }
      } else if (Notification.permission === "denied") {
        alert("Las notificaciones están bloqueadas.");
        return;
      }
    }
    setNotificationsEnabled(true);
    playNotificationSound();
  };

  const tenantQs = selectedTenantId > 0 ? `?tenantId=${selectedTenantId}` : "";

  const loadOrderDetail = async (orderId: number) => {
    try {
      const response = await fetch(`/api/orders/${orderId}${tenantQs}`);
      if (!response.ok) throw new Error("Error al cargar detalle");
      const data = await response.json();
      setSelectedOrder(data.order);
      setOrderHistory(data.history || []);
      setEditing(false);
    } catch (err) {
      console.error("Error loading order detail:", err);
    }
  };

  const handleStatusChange = async (
    orderId: number,
    newStatus: OrderStatus,
  ) => {
    if (newStatus === "CANCELLED") {
      setShowCancelModal(true);
      setCancelReason("");
      return;
    }
    try {
      const response = await fetch(`/api/orders/${orderId}${tenantQs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error("Error al actualizar estado");
      if (selectedOrder?.id === orderId) {
        const data = await response.json();
        setSelectedOrder(data.order);
        await loadOrderDetail(orderId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar");
    }
  };

  const confirmCancel = async () => {
    if (!cancelReason || !selectedOrder) return;
    try {
      const response = await fetch(
        `/api/orders/${selectedOrder.id}${tenantQs}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "CANCELLED", cancelReason }),
        },
      );
      if (!response.ok) throw new Error("Error al cancelar");
      setShowCancelModal(false);
      setCancelReason("");
      await loadOrderDetail(selectedOrder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cancelar");
    }
  };

  const handleDuplicate = async (orderId: number) => {
    try {
      const response = await fetch(`/api/orders/${orderId}${tenantQs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate" }),
      });
      if (!response.ok) throw new Error("Error al duplicar");
      await loadOrders(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al duplicar");
    }
  };

  const handleDelete = async () => {
    if (!selectedOrder) return;
    try {
      const response = await fetch(
        `/api/orders/${selectedOrder.id}${tenantQs}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete" }),
        },
      );
      if (!response.ok) throw new Error("Error al eliminar");
      setShowDeleteModal(false);
      setSelectedOrder(null);
      await loadOrders(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
    }
  };

  const startEdit = () => {
    if (!selectedOrder) return;
    setEditForm({
      customer_name: selectedOrder.customer_name || "",
      customer_phone: selectedOrder.customer_phone,
      notes: selectedOrder.notes || "",
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedOrder) return;
    try {
      const response = await fetch(
        `/api/orders/${selectedOrder.id}${tenantQs}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editForm),
        },
      );
      if (!response.ok) throw new Error("Error al editar");
      setEditing(false);
      await loadOrderDetail(selectedOrder.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al editar");
    }
  };

  useEffect(() => {
    loadOrders();
  }, [selectedTenantId, selectedStatus, dateFilter, searchQuery]);
  useEffect(() => {
    const interval = setInterval(() => loadOrders(true), 5000);
    return () => clearInterval(interval);
  }, [selectedStatus, dateFilter, searchQuery]);

  const canEditItems =
    selectedOrder &&
    (selectedOrder.status === "PENDING" ||
      selectedOrder.status === "CONFIRMED");
  const canEditFields = selectedOrder && selectedOrder.status !== "DELIVERED";
  const canDelete = selectedOrder && selectedOrder.status === "PENDING";
  const canChangeStatus =
    selectedOrder &&
    selectedOrder.status !== "DELIVERED" &&
    selectedOrder.status !== "CANCELLED";

  const currentStepIndex = selectedOrder
    ? FLOW_STATUSES.indexOf(selectedOrder.status)
    : -1;

  return (
    <div className="flex h-full">
      {/* Lista de pedidos */}
      <div className="w-1/2 border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Pedidos</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleNotifications}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${notificationsEnabled ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-300 bg-white text-gray-600"}`}
              >
                <span>{notificationsEnabled ? "🔔" : "🔕"}</span>
                <span>{notificationsEnabled ? "ON" : "Alertas"}</span>
              </button>
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-400"}`}
                />
                <span className="text-xs text-gray-500">
                  {connected ? "Conectado" : "Desconectado"}
                </span>
              </div>
            </div>
          </div>

          {/* Buscar */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 Buscar por cliente, teléfono o producto..."
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm mb-2"
          />

          {/* Filtros de fecha */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {DATE_FILTERS.map((df) => (
              <button
                key={df.value}
                onClick={() => setDateFilter(df.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${dateFilter === df.value ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              >
                {df.label}
              </button>
            ))}
          </div>

          {/* Filtro por estado */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedStatus("ALL")}
              className={`px-3 py-1 rounded-full text-xs font-medium ${selectedStatus === "ALL" ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              Todos
            </button>
            {ORDER_STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${selectedStatus === status ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div
          className="overflow-y-auto"
          style={{ height: "calc(100% - 180px)" }}
        >
          {loading ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Cargando pedidos...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-red-600">{error}</div>
          ) : orders.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No hay pedidos
              {selectedStatus !== "ALL" &&
                ` con estado "${STATUS_LABELS[selectedStatus]}"`}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => loadOrderDetail(order.id)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 ${selectedOrder?.id === order.id ? "bg-blue-50" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-900">
                          #{order.id}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[order.status]}`}
                        >
                          {STATUS_LABELS[order.status]}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        {order.customer_name || order.customer_phone}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {order.item_count}{" "}
                        {order.item_count === 1 ? "producto" : "productos"} · $
                        {order.total_amount.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(order.created_at * 1000).toLocaleString([], {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detalle del pedido */}
      <div className="flex-1 bg-gray-50">
        {selectedOrder ? (
          <div className="h-full flex flex-col">
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-slate-900">
                  Pedido #{selectedOrder.id}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDuplicate(selectedOrder.id)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    title="Duplicar pedido"
                  >
                    📋 Duplicar
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => setShowDeleteModal(true)}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      title="Eliminar (solo pendientes)"
                    >
                      🗑 Eliminar
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Timeline visual */}
              {selectedOrder.status !== "CANCELLED" ? (
                <div className="flex items-center gap-1 mt-3">
                  {FLOW_STATUSES.map((status, idx) => (
                    <div key={status} className="flex items-center">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${idx <= currentStepIndex ? STATUS_COLORS[status].split(" ")[0] + " " + STATUS_COLORS[status].split(" ")[1] : "bg-gray-100 text-gray-400"}`}
                        >
                          {idx < currentStepIndex ? "✓" : idx + 1}
                        </div>
                        <span
                          className={`text-[10px] mt-1 ${idx <= currentStepIndex ? "text-gray-700 font-medium" : "text-gray-400"}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      {idx < FLOW_STATUSES.length - 1 && (
                        <div
                          className={`w-6 h-0.5 mx-1 ${idx < currentStepIndex ? "bg-green-400" : "bg-gray-200"}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <strong>Cancelado</strong>
                  {selectedOrder.cancel_reason &&
                    ` — ${selectedOrder.cancel_reason}`}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Datos del cliente */}
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-slate-900">
                    Cliente
                  </h4>
                  {canEditFields && !editing && (
                    <button
                      onClick={startEdit}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Editar
                    </button>
                  )}
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editForm.customer_name}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          customer_name: e.target.value,
                        })
                      }
                      placeholder="Nombre"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="text"
                      value={editForm.customer_phone}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          customer_phone: e.target.value,
                        })
                      }
                      placeholder="Teléfono"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <textarea
                      value={editForm.notes}
                      onChange={(e) =>
                        setEditForm({ ...editForm, notes: e.target.value })
                      }
                      placeholder="Notas"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="rounded bg-gray-300 px-3 py-1 text-xs font-medium text-gray-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-gray-500">Nombre:</span>{" "}
                      <span className="font-medium">
                        {selectedOrder.customer_name || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Teléfono:</span>{" "}
                      <span className="font-medium">
                        {selectedOrder.customer_phone}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Total:</span>{" "}
                      <span className="font-medium">
                        ${selectedOrder.total_amount.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Creado:</span>{" "}
                      <span className="font-medium">
                        {new Date(
                          selectedOrder.created_at * 1000,
                        ).toLocaleString([], {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {selectedOrder.notes && (
                      <div>
                        <span className="text-gray-500">Notas:</span>{" "}
                        {selectedOrder.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Cambiar estado */}
              {canChangeStatus && (
                <div className="bg-white rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-900 mb-3">
                    Cambiar estado
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {ORDER_STATUSES.filter(
                      (s) => s !== selectedOrder.status,
                    ).map((status) => (
                      <button
                        key={status}
                        onClick={() =>
                          handleStatusChange(selectedOrder.id, status)
                        }
                        className={`px-3 py-2 rounded-lg text-xs font-medium border ${STATUS_COLORS[status]} hover:opacity-80`}
                      >
                        {STATUS_LABELS[status]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Items */}
              <div className="bg-white rounded-lg p-4">
                <h4 className="text-sm font-medium text-slate-900 mb-3">
                  Productos
                </h4>
                <div className="space-y-2">
                  {selectedOrder.items.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                    >
                      <div>
                        <div className="font-medium text-slate-900">
                          {item.product_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {item.quantity} × ${item.unit_price.toLocaleString()}
                        </div>
                      </div>
                      <div className="font-medium text-slate-900">
                        ${item.total_price.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
                {!canEditItems && (
                  <div className="mt-2 text-xs text-gray-400">
                    Los productos no se pueden modificar en este estado.
                  </div>
                )}
              </div>

              {/* Historial */}
              {orderHistory.length > 0 && (
                <div className="bg-white rounded-lg p-4">
                  <h4 className="text-sm font-medium text-slate-900 mb-3">
                    Historial
                  </h4>
                  <div className="space-y-3">
                    {orderHistory.map((entry) => (
                      <div key={entry.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5" />
                          {entry.id !==
                            orderHistory[orderHistory.length - 1].id && (
                            <div className="w-0.5 h-full bg-gray-200" />
                          )}
                        </div>
                        <div className="flex-1 pb-2">
                          <div className="text-sm text-slate-900">
                            {entry.description || entry.event}
                          </div>
                          <div className="text-xs text-gray-400">
                            {new Date(entry.created_at * 1000).toLocaleString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                              },
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <svg
                className="w-12 h-12 mx-auto mb-3 text-gray-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <p className="text-sm">
                Selecciona un pedido para ver los detalles
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Modal de cancelación */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              ¿Por qué se cancela?
            </h3>
            <div className="space-y-2 mb-4">
              {CANCEL_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="cancelReason"
                    value={reason}
                    checked={cancelReason === reason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="text-red-600"
                  />
                  <span className="text-sm text-gray-700">{reason}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelReason("");
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cerrar
              </button>
              <button
                onClick={confirmCancel}
                disabled={!cancelReason}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de eliminación */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">
              ¿Eliminar pedido?
            </h3>
            <p className="mb-6 text-sm text-gray-600">
              Estás por eliminar el pedido <strong>#{selectedOrder?.id}</strong>
              . Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
