import type { OrderEvent, Order } from "./db";

// Listener de eventos
type EventListener<T = any> = (data: T) => void;

class EventEmitter {
  private listeners: Map<string, EventListener[]> = new Map();

  on(event: string, listener: EventListener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: EventListener) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  emit(event: string, data?: any) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }
}

// Eventos globales para pedidos
export const orderEvents = new EventEmitter();

// Datos de eventos
export interface OrderEventData {
  order: Order & { items: any[] };
  tenantId: number;
  previousStatus?: string;
}

// Funciones para emitir eventos de pedidos
export function emitOrderEvent(
  event: OrderEvent,
  order: Order & { items: any[] },
  previousStatus?: string,
) {
  const eventData: OrderEventData = {
    order,
    tenantId: order.tenant_id,
    previousStatus,
  };

  console.log(
    `[ORDER_EVENT] ${event}: Order ${order.id} for tenant ${order.tenant_id}`,
  );
  orderEvents.emit(event, eventData);

  // También emitir evento genérico para todos los eventos de pedidos
  orderEvents.emit("order:changed", { event, ...eventData });
}

// Wrapper para crear pedido con emisión de eventos
import { createOrder as baseCreateOrder, type CreateOrderInput } from "./db";

export async function createOrder(input: CreateOrderInput) {
  const order = await baseCreateOrder(input);
  emitOrderEvent("ORDER_CREATED", order);
  return order;
}

// Wrapper para actualizar estado con emisión de eventos
import { updateOrderStatus as baseUpdateOrderStatus, getOrderById } from "./db";

export async function updateOrderStatus(
  tenantId: number,
  orderId: number,
  newStatus: string,
  cancelReason?: string,
) {
  // Obtener pedido actual para saber el estado anterior
  const currentOrder = await getOrderById(tenantId, orderId);
  if (!currentOrder) {
    throw new Error("Order not found");
  }

  const previousStatus = currentOrder.status;

  // Actualizar estado
  const updated = baseUpdateOrderStatus(tenantId, orderId, newStatus as any, cancelReason);
  if (!updated) {
    throw new Error("Failed to update order");
  }

  // Obtener pedido actualizado
  const updatedOrder = await getOrderById(tenantId, orderId);
  if (!updatedOrder) {
    throw new Error("Order not found after update");
  }

  // Emitir evento específico según el nuevo estado
  const eventMap: Record<string, OrderEvent> = {
    CONFIRMED: "ORDER_CONFIRMED",
    PREPARING: "ORDER_PREPARING",
    ON_THE_WAY: "ORDER_ON_THE_WAY",
    DELIVERED: "ORDER_DELIVERED",
    CANCELLED: "ORDER_CANCELLED",
  };

  const event = eventMap[newStatus];
  if (event) {
    emitOrderEvent(event, updatedOrder, previousStatus);
  }

  return updatedOrder;
}
