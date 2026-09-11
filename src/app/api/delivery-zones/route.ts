import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getDeliveryZones,
  addDeliveryZone,
  updateDeliveryZone,
  deleteDeliveryZone,
} from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  zone_name: z.string().trim().min(1).max(100),
  price: z.number().int().nonnegative(),
  tenantId: z.number().int().positive().optional(),
});

const UpdateBody = CreateBody.extend({
  id: z.number().int().positive(),
});

const DeleteBody = z.object({
  id: z.number().int().positive(),
  tenantId: z.number().int().positive().optional(),
});

function resolveTenantId(
  authTenantId: number,
  isSuperAdmin: boolean,
  bodyTenantId?: number,
): number {
  if (isSuperAdmin && bodyTenantId && bodyTenantId > 0) return bodyTenantId;
  return authTenantId;
}

function handleErr(e: unknown) {
  if (e instanceof Response) return e;
  console.error("[api/delivery-zones]", e);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const { tenantId, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    const { searchParams } = new URL(req.url);
    const filterTenant = searchParams.get("tenantId");

    if (isSuperAdmin && filterTenant) {
      return NextResponse.json(getDeliveryZones(Number(filterTenant)));
    }
    return NextResponse.json(getDeliveryZones(tenantId));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const target = resolveTenantId(tenantId, isSuperAdmin, parsed.data.tenantId);
    const zone = addDeliveryZone(target, parsed.data.zone_name, parsed.data.price);
    return NextResponse.json(zone, { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const target = resolveTenantId(tenantId, isSuperAdmin, parsed.data.tenantId);
    updateDeliveryZone(parsed.data.id, target, parsed.data.zone_name, parsed.data.price);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role !== "ADMIN" && !isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }
    const target = resolveTenantId(tenantId, isSuperAdmin, parsed.data.tenantId);
    deleteDeliveryZone(parsed.data.id, target);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleErr(e);
  }
}
