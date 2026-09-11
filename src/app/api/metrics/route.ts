import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireTenantId();
    const { searchParams } = new URL(request.url);
    const queryTenant = Number(searchParams.get("tenantId") ?? 0);
    const tenantId =
      ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;
    const period = searchParams.get("period") || "today";

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    let fromTs: number;
    let label: string;

    switch (period) {
      case "week": {
        const day = todayStart.getDay();
        const weekStart = new Date(todayStart.getTime() - day * 86400000);
        fromTs = Math.floor(weekStart.getTime() / 1000);
        label = "Esta semana";
        break;
      }
      case "month": {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        fromTs = Math.floor(monthStart.getTime() / 1000);
        label = "Este mes";
        break;
      }
      default: {
        fromTs = Math.floor(todayStart.getTime() / 1000);
        label = "Hoy";
        break;
      }
    }

    const nowTs = Math.floor(now.getTime() / 1000);

    // Conversaciones
    const conversationsToday = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM conversations
      WHERE tenant_id = ? AND created_at >= ?
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    const conversationsTotal = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM conversations WHERE tenant_id = ?
    `,
        )
        .get(tenantId) as { count: number }
    ).count;

    const convsByAI = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM conversations
      WHERE tenant_id = ? AND mode = 'AI' AND created_at >= ?
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    const convsByHuman = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM conversations
      WHERE tenant_id = ? AND mode = 'HUMAN' AND created_at >= ?
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    // Pedidos
    const ordersCreated = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND created_at >= ? AND deleted_at IS NULL
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    const ordersDelivered = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND status = 'DELIVERED' AND updated_at >= ? AND deleted_at IS NULL
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    const ordersCancelled = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND status = 'CANCELLED' AND updated_at >= ? AND deleted_at IS NULL
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    const ordersPending = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND status = 'PENDING' AND deleted_at IS NULL
    `,
        )
        .get(tenantId) as { count: number }
    ).count;

    const ordersPreparing = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND status = 'PREPARING' AND deleted_at IS NULL
    `,
        )
        .get(tenantId) as { count: number }
    ).count;

    const ordersOnTheWay = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND status = 'ON_THE_WAY' AND deleted_at IS NULL
    `,
        )
        .get(tenantId) as { count: number }
    ).count;

    const ordersConfirmed = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM orders
      WHERE tenant_id = ? AND status = 'CONFIRMED' AND deleted_at IS NULL
    `,
        )
        .get(tenantId) as { count: number }
    ).count;

    // Valor vendido
    const salesToday = (
      db
        .prepare(
          `
      SELECT COALESCE(SUM(total_amount), 0) as total FROM orders
      WHERE tenant_id = ? AND status = 'DELIVERED' AND updated_at >= ? AND deleted_at IS NULL
    `,
        )
        .get(tenantId, fromTs) as { total: number }
    ).total;

    const salesMonth = (
      db
        .prepare(
          `
      SELECT COALESCE(SUM(total_amount), 0) as total FROM orders
      WHERE tenant_id = ? AND status = 'DELIVERED'
      AND updated_at >= ? AND deleted_at IS NULL
    `,
        )
        .get(
          tenantId,
          Math.floor(
            new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000,
          ),
        ) as { total: number }
    ).total;

    // Tiempo promedio de respuesta (primer mensaje del usuario -> primera respuesta)
    const avgResponseTime = (
      db
        .prepare(
          `
      SELECT AVG(resp.created_at - firstMsg.created_at) as avg_time
      FROM messages firstMsg
      JOIN conversations c ON firstMsg.conversation_id = c.id
      JOIN messages resp ON resp.conversation_id = firstMsg.conversation_id
        AND resp.role IN ('assistant', 'human')
        AND resp.id = (
          SELECT MIN(id) FROM messages
          WHERE conversation_id = firstMsg.conversation_id
            AND role IN ('assistant', 'human')
            AND created_at >= firstMsg.created_at
        )
      WHERE c.tenant_id = ?
        AND firstMsg.role = 'user'
        AND firstMsg.id = (
          SELECT MIN(id) FROM messages
          WHERE conversation_id = firstMsg.conversation_id AND role = 'user'
        )
        AND firstMsg.created_at >= ?
    `,
        )
        .get(tenantId, fromTs) as { avg_time: number | null }
    ).avg_time;

    // Tiempo promedio de entrega (creación -> entrega)
    const avgDeliveryTime = (
      db
        .prepare(
          `
      SELECT AVG(o.updated_at - o.created_at) as avg_time FROM orders o
      WHERE o.tenant_id = ? AND o.status = 'DELIVERED'
        AND o.updated_at >= ? AND o.deleted_at IS NULL
    `,
        )
        .get(tenantId, fromTs) as { avg_time: number | null }
    ).avg_time;

    // Productos más vendidos (top 5)
    const topProducts = db
      .prepare(
        `
      SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.total_price) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.tenant_id = ? AND o.created_at >= ? AND o.status != 'CANCELLED' AND o.deleted_at IS NULL
      GROUP BY oi.product_name
      ORDER BY qty DESC
      LIMIT 5
    `,
      )
      .all(tenantId, fromTs) as {
      product_name: string;
      qty: number;
      revenue: number;
    }[];

    // Productos menos vendidos (bottom 5)
    const bottomProducts = db
      .prepare(
        `
      SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.total_price) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.tenant_id = ? AND o.created_at >= ? AND o.status != 'CANCELLED' AND o.deleted_at IS NULL
      GROUP BY oi.product_name
      ORDER BY qty ASC
      LIMIT 5
    `,
      )
      .all(tenantId, fromTs) as {
      product_name: string;
      qty: number;
      revenue: number;
    }[];

    // Productos sin ventas en el periodo
    const productsNoSales = db
      .prepare(
        `
      SELECT p.name, p.stock, p.price
      FROM products p
      WHERE p.tenant_id = ? AND p.active = 1
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.tenant_id = ? AND o.created_at >= ?
            AND o.status != 'CANCELLED' AND o.deleted_at IS NULL
            AND oi.product_name = p.name
        )
      ORDER BY p.name ASC
    `,
      )
      .all(tenantId, tenantId, fromTs) as {
      name: string;
      stock: number;
      price: number;
    }[];

    // Productos con stock bajo (<= 5)
    const lowStockProducts = db
      .prepare(
        `
      SELECT name, stock, price FROM products
      WHERE tenant_id = ? AND active = 1 AND stock <= 5
      ORDER BY stock ASC
    `,
      )
      .all(tenantId) as { name: string; stock: number; price: number }[];

    // Total de productos activos
    const totalActiveProducts = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM products WHERE tenant_id = ? AND active = 1
    `,
        )
        .get(tenantId) as { count: number }
    ).count;

    // Clientes nuevos
    const newCustomers = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM (
        SELECT customer_phone, MIN(created_at) as first_order
        FROM orders
        WHERE tenant_id = ? AND deleted_at IS NULL
        GROUP BY customer_phone
        HAVING first_order >= ?
      )
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    // Clientes recurrentes (2+ pedidos en el periodo)
    const recurringCustomers = (
      db
        .prepare(
          `
      SELECT COUNT(*) as count FROM (
        SELECT customer_phone, COUNT(*) as order_count
        FROM orders
        WHERE tenant_id = ? AND created_at >= ? AND deleted_at IS NULL
          AND status != 'CANCELLED'
        GROUP BY customer_phone
        HAVING order_count >= 2
      )
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    // Top clientes (más pedidos en el periodo)
    const topCustomers = db
      .prepare(
        `
      SELECT customer_phone, customer_name,
             COUNT(*) as order_count,
             SUM(total_amount) as total_spent,
             MAX(created_at) as last_order
      FROM orders
      WHERE tenant_id = ? AND created_at >= ? AND deleted_at IS NULL
        AND status != 'CANCELLED'
      GROUP BY customer_phone
      ORDER BY order_count DESC
      LIMIT 5
    `,
      )
      .all(tenantId, fromTs) as {
      customer_phone: string;
      customer_name: string | null;
      order_count: number;
      total_spent: number;
      last_order: number;
    }[];

    // Total de clientes únicos en el periodo
    const totalCustomers = (
      db
        .prepare(
          `
      SELECT COUNT(DISTINCT customer_phone) as count FROM orders
      WHERE tenant_id = ? AND created_at >= ? AND deleted_at IS NULL
        AND status != 'CANCELLED'
    `,
        )
        .get(tenantId, fromTs) as { count: number }
    ).count;

    // Tasa de cancelación
    const totalOrders = ordersCreated + ordersCancelled;
    const cancellationRate =
      totalOrders > 0 ? Math.round((ordersCancelled / totalOrders) * 100) : 0;

    // Ventas por día (últimos 7 días)
    const salesByDay = db
      .prepare(
        `
      SELECT DATE(o.created_at, 'unixepoch') as date,
             COUNT(*) as orders,
             COALESCE(SUM(CASE WHEN o.status = 'DELIVERED' THEN o.total_amount ELSE 0 END), 0) as revenue
      FROM orders o
      WHERE o.tenant_id = ? AND o.created_at >= ? AND o.deleted_at IS NULL
      GROUP BY DATE(o.created_at, 'unixepoch')
      ORDER BY date DESC
      LIMIT 7
    `,
      )
      .all(tenantId, Math.floor((now.getTime() - 7 * 86400000) / 1000)) as {
      date: string;
      orders: number;
      revenue: number;
    }[];

    return NextResponse.json({
      period: label,
      metrics: {
        conversations: {
          today: conversationsToday,
          total: conversationsTotal,
          byAI: convsByAI,
          byHuman: convsByHuman,
          avgResponseTime: avgResponseTime ? Math.round(avgResponseTime) : null,
        },
        orders: {
          created: ordersCreated,
          delivered: ordersDelivered,
          cancelled: ordersCancelled,
          pending: ordersPending,
          preparing: ordersPreparing,
          onTheWay: ordersOnTheWay,
          confirmed: ordersConfirmed,
          cancellationRate,
          avgDeliveryTime: avgDeliveryTime ? Math.round(avgDeliveryTime) : null,
        },
        sales: {
          today: salesToday,
          month: salesMonth,
        },
        products: {
          top: topProducts,
          bottom: bottomProducts,
          noSales: productsNoSales,
          lowStock: lowStockProducts,
          totalActive: totalActiveProducts,
        },
        customers: {
          new: newCustomers,
          recurring: recurringCustomers,
          total: totalCustomers,
          top: topCustomers,
        },
        salesByDay,
      },
    });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
