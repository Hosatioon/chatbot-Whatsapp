import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { setConnectionState } from "@/lib/db";
import { requireAuth } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const url = new URL(req.url);
  const queryTenant = Number(url.searchParams.get("tenantId") ?? 0);
  // Super-admin: puede desconectar cualquier tenant.
  // Usuario normal: SOLO su propio tenant.
  const tenantId =
    ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
  }

  // 1. Marcar estado disconnected en DB
  setConnectionState(tenantId, {
    status: "disconnected",
    qr_string: null,
    phone: null,
  });

  // 2. Borrar carpeta auth/{tenantId}/
  const authDir = path.resolve(process.cwd(), "auth", String(tenantId));
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[api] No se pudo borrar auth/${tenantId}/:`, err);
  }

  // 3. Crear flag de restart para que el bot reinicie ese tenant
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `.restart-${tenantId}`), "");

  return NextResponse.json({ ok: true, tenantId });
}
