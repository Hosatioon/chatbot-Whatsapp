import { NextResponse } from "next/server";
import { getTenantsAdminOverview } from "@/lib/db";
import { requireOwnerAdmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireOwnerAdmin();
  } catch (res) {
    return res as Response;
  }

  const tenants = getTenantsAdminOverview();

  const globalTotals = tenants.reduce(
    (acc, t) => ({
      tokens: acc.tokens + t.tokens_today,
      costToday: acc.costToday + t.cost_today_usd,
      costMonth: acc.costMonth + t.cost_month_usd,
      chats: acc.chats + t.chats_today,
      messages: acc.messages + t.messages_today,
      orders: acc.orders + t.orders_today,
    }),
    { tokens: 0, costToday: 0, costMonth: 0, chats: 0, messages: 0, orders: 0 },
  );

  return NextResponse.json({
    tenants,
    totals: globalTotals,
    budgets: {
      dailyUsd: parseFloat(process.env.LLM_DAILY_BUDGET_USD || "1.0"),
      monthlyUsd: parseFloat(process.env.LLM_MONTHLY_BUDGET_USD || "25.0"),
      globalDailyUsd: parseFloat(
        process.env.LLM_GLOBAL_DAILY_BUDGET_USD || "10.0",
      ),
    },
  });
}
