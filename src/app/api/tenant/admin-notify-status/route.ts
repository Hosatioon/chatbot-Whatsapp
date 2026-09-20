import { NextRequest, NextResponse } from "next/server";
import {
  getTenantById,
  findConversationByPhoneSuffix,
  getRecentHistory,
} from "@/lib/db";
import { requireAuth } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Le dice al panel si el número configurado como admin_phone ya "activó"
// las notificaciones — es decir, si ya existe una conversación con ese
// número que tiene al menos un mensaje escrito POR ese número (no basta con
// que el bot le haya escrito). Mismo criterio (adminHasUserMessage) que usa
// src/lib/baileys/handler.ts antes de encolar una notificación de pedido.
export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const queryTenant = Number(req.nextUrl.searchParams.get("tenantId") ?? 0);
  const tenantId =
    ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;
  if (tenantId == null) {
    return NextResponse.json(
      { error: "Tenant no encontrado en la sesión" },
      { status: 403 },
    );
  }

  const tenant = getTenantById(tenantId);

  // Estado de UN número: configurado + ya "activó" (existe una conversación
  // con ese número que tiene al menos un mensaje escrito POR él).
  function statusOf(raw: string | null | undefined) {
    const normalized = (raw?.trim() ?? "").replace(/[^\d]/g, "");
    if (normalized.length < 7) return { configured: false, activated: false };
    const convo = findConversationByPhoneSuffix(tenantId as number, normalized);
    if (!convo) return { configured: true, activated: false };
    const activated = getRecentHistory(convo.id, 50).some(
      (m) => m.role === "user",
    );
    return { configured: true, activated };
  }

  const first = statusOf(tenant?.admin_phone);
  // Compat: los campos planos siguen siendo los del primer número.
  return NextResponse.json({
    ...first,
    second: statusOf(tenant?.admin_phone_2),
  });
}
