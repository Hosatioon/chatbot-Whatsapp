import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { listActiveTenants } from "@/lib/baileys/client";
import { listTenants, getLLMBudgetStatus } from "@/lib/db";
import { requireOwnerAdmin } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Modo 1: Token via header (para uptime monitors externos como UptimeRobot)
  const healthToken = process.env.HEALTH_CHECK_TOKEN;
  const providedToken = req.headers.get("x-health-token");

  if (healthToken && providedToken === healthToken) {
    return NextResponse.json({ status: "ok" });
  }

  // Modo 2: Super-admin autenticado obtiene métricas completas
  let ctx;
  try {
    ctx = await requireOwnerAdmin();
  } catch (res) {
    return res as Response;
  }

  const activeTenants = listActiveTenants();
  const allTenants = listTenants();

  // Info de la base de datos
  const dbPath = path.resolve(process.cwd(), "data", "messages.db");
  let dbInfo: Record<string, unknown> = { exists: false };
  try {
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      dbInfo = {
        exists: true,
        sizeMB: Math.round((stat.size / 1024 / 1024) * 100) / 100,
        lastModified: stat.mtime.toISOString(),
      };
    }
  } catch {
    /* ignore */
  }

  // Info de backups
  const backupDir = path.resolve(process.cwd(), "data", "backups");
  let backupInfo: Record<string, unknown> = { exists: false };
  try {
    if (fs.existsSync(backupDir)) {
      const backups = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith(".db"))
        .map((f) => ({
          name: f,
          size: fs.statSync(path.join(backupDir, f)).size,
          mtime: fs.statSync(path.join(backupDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      backupInfo = {
        exists: true,
        count: backups.length,
        latest: backups[0]?.name ?? null,
        latestDate: backups[0]?.mtime.toISOString() ?? null,
      };
    }
  } catch {
    /* ignore */
  }

  // Costo global de LLM hoy
  let llmGlobalCost = 0;
  let llmGlobalCalls = 0;
  try {
    for (const t of allTenants) {
      const budget = getLLMBudgetStatus(t.id);
      llmGlobalCost += budget.dailyCostUsd;
      llmGlobalCalls += budget.dailyCalls;
    }
  } catch {
    /* ignore */
  }

  // Estado de conexiones por tenant
  const tenantStatus = allTenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    botActive: activeTenants.includes(t.id),
  }));

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    tenants: {
      total: allTenants.length,
      activeBots: activeTenants.length,
      details: tenantStatus,
    },
    database: dbInfo,
    backups: backupInfo,
    llm: {
      dailyCostUsd: Math.round(llmGlobalCost * 10000) / 10000,
      dailyCalls: llmGlobalCalls,
      globalBudgetUsd: parseFloat(
        process.env.LLM_GLOBAL_DAILY_BUDGET_USD || "10.0",
      ),
    },
  });
}
