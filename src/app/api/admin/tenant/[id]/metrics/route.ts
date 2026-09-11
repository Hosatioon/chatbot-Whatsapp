import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getLLMBudgetStatus, getLLMDailyUsage } from "@/lib/db";
import { requireOwnerAdmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOwnerAdmin();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const tenantId = Number(id);
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "today";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

  // Reutilizar las mismas queries de /api/metrics pero con tenantId parametrizado
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

  const totalActiveProducts = (
    db
      .prepare(
        `
    SELECT COUNT(*) as count FROM products WHERE tenant_id = ? AND active = 1
  `,
      )
      .get(tenantId) as { count: number }
  ).count;

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

  // LLM usage data
  const llmBudget = getLLMBudgetStatus(tenantId);
  const llmDaily = getLLMDailyUsage(tenantId, 7);

  return NextResponse.json({
    tenantId,
    period: label,
    metrics: {
      conversations: {
        today: conversationsToday,
        total: conversationsTotal,
      },
      orders: {
        created: ordersCreated,
        delivered: ordersDelivered,
        cancelled: ordersCancelled,
        pending: ordersPending,
        cancellationRate:
          ordersCreated + ordersCancelled > 0
            ? Math.round(
                (ordersCancelled / (ordersCreated + ordersCancelled)) * 100,
              )
            : 0,
      },
      sales: {
        today: salesToday,
        month: salesMonth,
      },
      products: {
        totalActive: totalActiveProducts,
        top: topProducts,
      },
      customers: {
        total: totalCustomers,
      },
      salesByDay,
      llm: {
        dailyCostUsd: llmBudget.dailyCostUsd,
        monthlyCostUsd: llmBudget.monthlyCostUsd,
        dailyTokens: llmBudget.dailyTokens,
        monthlyTokens: llmBudget.monthlyTokens,
        dailyCalls: llmBudget.dailyCalls,
        monthlyCalls: llmBudget.monthlyCalls,
        exceeded: llmBudget.exceeded,
        reason: llmBudget.reason,
        dailyUsage: llmDaily,
      },
    },
  });
}
