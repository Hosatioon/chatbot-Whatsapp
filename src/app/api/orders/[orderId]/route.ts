import { NextRequest, NextResponse } from "next/server";
import { getOrderById } from "@/lib/db";
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

    return NextResponse.json({ order });
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
    const { status } = body;

    if (!status) {
      return NextResponse.json(
        { error: "Status is required" },
        { status: 400 },
      );
    }

    // Validar status
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

    // Verificar que el pedido existe
    const existingOrder = await getOrderById(tenantId, orderId);
    if (!existingOrder) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Actualizar estado (con emisión de eventos)
    const updatedOrder = await updateOrderStatus(tenantId, orderId, status);

    // TODO: Emitir evento ORDER_STATUS_UPDATED via Socket.IO
    // TODO: Enviar notificación si corresponde

    return NextResponse.json({
      success: true,
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
