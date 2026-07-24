import { NextRequest, NextResponse } from "next/server";
import { getLLMBudgetStatus } from "@/lib/db";
import { requireOwnerAdmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireOwnerAdmin();
  } catch (res) {
    return res as Response;
  }

  const url = new URL(req.url);
  const queryTenant = Number(url.searchParams.get("tenantId") ?? 0);
  const tenantId =
    ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId requerido" },
      { status: 400 },
    );
  }

  const status = getLLMBudgetStatus(tenantId);

  return NextResponse.json({
    tenantId,
    ...status,
    budgets: {
      dailyUsd: parseFloat(process.env.LLM_DAILY_BUDGET_USD || "1.0"),
      monthlyUsd: parseFloat(process.env.LLM_MONTHLY_BUDGET_USD || "25.0"),
      globalDailyUsd: parseFloat(
        process.env.LLM_GLOBAL_DAILY_BUDGET_USD || "10.0",
      ),
    },
  });
}
