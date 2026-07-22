"use client";

import { useState, useEffect, useRef } from "react";
import type { Order, OrderStatus } from "@/lib/db";

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

export default function OrdersPanel({ selectedTenantId }: Props) {
  const [orders, setOrders] = useState<(Order & { item_count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<"ALL" | OrderStatus>(
    "ALL",
  );
  const [selectedOrder, setSelectedOrder] = useState<
    (Order & { items: any[] }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const connected = true; // polling siempre activo
  const seenOrderIdsRef = useRef<Set<number>>(new Set());
  const initializedRef = useRef(false);

  // Cargar pedidos. silent=true para refresh por polling (no muestra spinner)
  const loadOrders = async (status?: OrderStatus, silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (status && (status as string) !== "ALL") {
        params.append("status", status);
      }
      params.append("limit", "50");

      const response = await fetch(`/api/orders?${params.toString()}`);
      if (!response.ok) throw new Error("Error al cargar pedidos");

      const data = await response.json();
      const newOrders = data.orders || [];

      // Detectar pedidos realmente nuevos (no estaban en la última carga)
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

      // Actualizar set de IDs vistos
      seenOrderIdsRef.current = new Set(newOrders.map((o: Order) => o.id));
      initializedRef.current = true;

      setOrders(newOrders);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Toggle de notificaciones (solicita permiso al navegador)
  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result !== "granted") {
          alert(
            "Permiso de notificaciones denegado. Habilítalo desde la configuración del navegador.",
          );
          return;
        }
      } else if (Notification.permission === "denied") {
        alert(
          "Las notificaciones están bloqueadas. Habilítalas desde la configuración del navegador (icono 🔒 en la URL).",
        );
        return;
      }
    }
    setNotificationsEnabled(true);
    // Reproducir sonido de prueba al activar (también desbloquea AudioContext)
    playNotificationSound();
  };

  // Cargar detalle de un pedido
  const loadOrderDetail = async (orderId: number) => {
    try {
      const response = await fetch(`/api/orders/${orderId}`);
      if (!response.ok) throw new Error("Error al cargar detalle");

      const data = await response.json();
      setSelectedOrder(data.order);
    } catch (err) {
      console.error("Error loading order detail:", err);
    }
  };

  // Actualizar estado de un pedido
  const updateOrderStatus = async (orderId: number, newStatus: OrderStatus) => {
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Error al actualizar estado");

      // El evento Socket.IO actualizará la lista automáticamente
      if (selectedOrder?.id === orderId) {
        const data = await response.json();
        setSelectedOrder(data.order);
      }
    } catch (err) {
      console.error("Error updating order status:", err);
      setError(err instanceof Error ? err.message : "Error al actualizar");
    }
  };

  // Cargar pedidos al montar y cuando cambia el filtro
  useEffect(() => {
    loadOrders(selectedStatus === "ALL" ? undefined : selectedStatus);
  }, [selectedTenantId, selectedStatus]);

  // Polling cada 5 segundos en silencio (sin spinner) para mantener la lista actualizada
  useEffect(() => {
    const interval = setInterval(() => {
      loadOrders(
        selectedStatus === "ALL" ? undefined : selectedStatus,
        true, // silent
      );
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedStatus]);

  return (
    <div className="flex h-full">
      {/* Lista de pedidos */}
      <div className="w-1/2 border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Pedidos</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleNotifications}
                title={
                  notificationsEnabled
                    ? "Notificaciones activas — clic para desactivar"
                    : "Activar sonido y notificaciones de nuevos pedidos"
                }
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                  notificationsEnabled
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span>{notificationsEnabled ? "🔔" : "🔕"}</span>
                <span>
                  {notificationsEnabled
                    ? "Notificaciones ON"
                    : "Activar alertas"}
                </span>
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

          {/* Filtro por estado */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedStatus("ALL")}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedStatus === "ALL"
                  ? "bg-slate-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Todos
            </button>
            {ORDER_STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedStatus === status
                    ? "bg-slate-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div
          className="overflow-y-auto"
          style={{ height: "calc(100% - 120px)" }}
        >
          {loading ? (
            <div className="p-4 text-center text-sm text-gray-500">
              Cargando pedidos...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-red-600">{error}</div>
          ) : orders.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No hay pedidos{" "}
              {selectedStatus !== "ALL" &&
                `con estado "${STATUS_LABELS[selectedStatus]}"`}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => loadOrderDetail(order.id)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedOrder?.id === order.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-900">
                          Pedido #{order.id}
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
                      {new Date(order.created_at * 1000).toLocaleTimeString(
                        [],
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
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

              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Cliente:</span>
                  <span className="ml-1 font-medium">
                    {selectedOrder.customer_name ||
                      selectedOrder.customer_phone}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Total:</span>
                  <span className="ml-1 font-medium">
                    ${selectedOrder.total_amount.toLocaleString()}
                  </span>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="mt-2 text-sm">
                  <span className="text-gray-500">Notas:</span>
                  <span className="ml-1">{selectedOrder.notes}</span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Cambiar estado */}
              <div className="bg-white rounded-lg p-4 mb-4">
                <h4 className="text-sm font-medium text-slate-900 mb-3">
                  Actualizar estado
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {ORDER_STATUSES.map((status) => (
                    <button
                      key={status}
                      onClick={() =>
                        updateOrderStatus(selectedOrder.id, status)
                      }
                      disabled={status === selectedOrder.status}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        status === selectedOrder.status
                          ? "bg-slate-900 text-white cursor-not-allowed"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items del pedido */}
              <div className="bg-white rounded-lg p-4">
                <h4 className="text-sm font-medium text-slate-900 mb-3">
                  Productos
                </h4>
                <div className="space-y-3">
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
              </div>
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
    </div>
  );
}
