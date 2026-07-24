import { NextRequest, NextResponse } from "next/server";
import {
  getOrderById,
  getOrderHistory,
  deleteOrder,
  updateOrder,
  duplicateOrder,
} from "@/lib/db";
import { updateOrderStatus } from "@/lib/events";
import { requireTenantId } from "@/lib/tenant";
import type { OrderStatus } from "@/lib/db";

// GET - Obtener un pedido específico
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const { tenantId } = await requireTenantId();
    const { orderId: orderIdParam } = await params;
    const orderId = Number(orderIdParam);

    if (isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const order = await getOrderById(tenantId, orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const history = getOrderHistory(orderId);

    return NextResponse.json({ order, history });
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH - Actualizar estado de un pedido
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const { tenantId } = await requireTenantId();
    const { orderId: orderIdParam } = await params;
    const orderId = Number(orderIdParam);

    if (isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const body = await request.json();

    // Si trae "status", es cambio de estado
    if (body.status) {
      const { status, cancelReason } = body;

      const validStatuses: OrderStatus[] = [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "ON_THE_WAY",
        "DELIVERED",
        "CANCELLED",
      ];

      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }

      const existingOrder = await getOrderById(tenantId, orderId);
      if (!existingOrder) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      // Entregado no se puede cambiar
      if (existingOrder.status === "DELIVERED") {
        return NextResponse.json({ error: "No se puede modificar un pedido entregado" }, { status: 400 });
      }

      // Cancelar requiere motivo
      if (status === "CANCELLED" && !cancelReason) {
        return NextResponse.json({ error: "cancelReason is required to cancel" }, { status: 400 });
      }

      const updatedOrder = await updateOrderStatus(tenantId, orderId, status, cancelReason);

      return NextResponse.json({ success: true, order: updatedOrder });
    }

    // Si trae "action", es duplicar o eliminar
    if (body.action === "duplicate") {
      const newOrder = duplicateOrder(tenantId, orderId);
      if (!newOrder) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, order: newOrder }, { status: 201 });
    }

    if (body.action === "delete") {
      const ok = deleteOrder(tenantId, orderId);
      if (!ok) {
        return NextResponse.json({ error: "Solo se pueden eliminar pedidos pendientes" }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    // Si no, es edición del pedido
    const existingOrder = await getOrderById(tenantId, orderId);
    if (!existingOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const updated = updateOrder(tenantId, orderId, {
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      notes: body.notes,
      items: body.items,
    });

    if (!updated) {
      return NextResponse.json({ error: "No se pudo editar el pedido" }, { status: 400 });
    }

    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
