import { NextRequest, NextResponse } from "next/server";
import { getOrdersByTenant, searchOrders } from "@/lib/db";
import { createOrder } from "@/lib/events";
import { requireTenantId } from "@/lib/tenant";
import type { CreateOrderInput, OrderStatus } from "@/lib/db";

// GET - Listar pedidos del tenant
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantId();
    const { searchParams } = new URL(request.url);
    const queryTenant = Number(searchParams.get("tenantId") ?? 0);
    const tenantId =
      ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;
    const limit = Math.min(Number(searchParams.get("limit") || "50"), 100);
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Si hay búsqueda o filtro de fecha, usar searchOrders
    if (search || dateFrom || dateTo) {
      const validStatuses: OrderStatus[] = [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "ON_THE_WAY",
        "DELIVERED",
        "CANCELLED",
      ];
      if (status && !validStatuses.includes(status as OrderStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      const orders = searchOrders({
        tenantId,
        status: status as OrderStatus | undefined,
        search,
        dateFrom: dateFrom ? Number(dateFrom) : undefined,
        dateTo: dateTo ? Number(dateTo) : undefined,
        limit,
      });
      return NextResponse.json({ orders });
    }

    // Sin búsqueda: comportamiento original
    let orders;
    if (status) {
      const validStatuses = [
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
      const { getOrdersByStatus } = await import("@/lib/db");
      orders = getOrdersByStatus(tenantId, status as any, limit);
    } else {
      orders = getOrdersByTenant(tenantId, limit);
    }

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST - Crear un nuevo pedido
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireTenantId();
    const { searchParams } = new URL(request.url);
    const queryTenant = Number(searchParams.get("tenantId") ?? 0);
    const tenantId =
      ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;
    const body = await request.json();

    // Validar body
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "Items array is required and cannot be empty" },
        { status: 400 },
      );
    }

    // Validar cada item
    for (const item of body.items) {
      if (!item.product_name || !item.quantity || !item.unit_price) {
        return NextResponse.json(
          {
            error: "Each item must have product_name, quantity, and unit_price",
          },
          { status: 400 },
        );
      }
      if (item.quantity <= 0 || item.unit_price <= 0) {
        return NextResponse.json(
          { error: "Quantity and unit_price must be positive numbers" },
          { status: 400 },
        );
      }
    }

    const orderInput: CreateOrderInput = {
      tenant_id: tenantId,
      customer_phone: body.customer_phone,
      customer_name: body.customer_name || null,
      items: body.items.map((item: any) => ({
        product_name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
      })),
      notes: body.notes || null,
    };

    const order = await createOrder(orderInput);

    // TODO: Emitir evento ORDER_CREATED via Socket.IO
    // TODO: Enviar notificación (WhatsApp/email) si corresponde

    return NextResponse.json(
      {
        success: true,
        order,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
