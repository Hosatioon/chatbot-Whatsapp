import { NextRequest, NextResponse } from "next/server";
import { listActiveTenants } from "@/lib/baileys/client";
import { requireAuth } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Modo 1: Token via header (para uptime monitors externos como UptimeRobot)
  const healthToken = process.env.HEALTH_CHECK_TOKEN;
  const providedToken = req.headers.get("x-health-token");

  if (healthToken && providedToken === healthToken) {
    // Healthcheck mínimo, sin info sensible
    return NextResponse.json({ status: "ok" });
  }

  // Modo 2: Super-admin autenticado obtiene métricas completas
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const activeTenants = listActiveTenants();
  return NextResponse.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    activeTenants,
    activeTenantCount: activeTenants.length,
    memory: process.memoryUsage(),
  });
}
