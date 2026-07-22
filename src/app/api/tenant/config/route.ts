import { NextRequest, NextResponse } from "next/server";
import { getTenantById, updateTenantConfig } from "@/lib/db";
import { requireAuth } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const tenant = getTenantById(ctx.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    business_name: tenant.business_name,
    business_type: tenant.business_type,
    payment_info: tenant.payment_info,
    custom_greeting: tenant.custom_greeting,
    custom_prompt: tenant.custom_prompt,
  });
}

export async function PUT(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const business_name = (body.business_name ?? "").trim().slice(0, 100);
  const business_type = (body.business_type ?? "").trim().slice(0, 100);
  const payment_info = (body.payment_info ?? "").trim().slice(0, 1000);
  const custom_greeting = (body.custom_greeting ?? "").trim().slice(0, 200);
  const custom_prompt = (body.custom_prompt ?? "").trim().slice(0, 2000);

  updateTenantConfig(ctx.tenantId, {
    business_name: business_name || null,
    business_type: business_type || null,
    payment_info: payment_info || null,
    custom_greeting: custom_greeting || null,
    custom_prompt: custom_prompt || null,
  });

  return NextResponse.json({ ok: true });
}
