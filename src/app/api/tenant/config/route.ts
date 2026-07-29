import { NextRequest, NextResponse } from "next/server";
import { getTenantById, updateTenantConfig, type TenantLink } from "@/lib/db";
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
    return NextResponse.json(
      { error: "Tenant no encontrado" },
      { status: 404 },
    );
  }

  let extraLinks: TenantLink[] = [];
  if (tenant.extra_links) {
    try {
      const parsed = JSON.parse(tenant.extra_links);
      if (Array.isArray(parsed)) extraLinks = parsed;
    } catch {
      // ignore
    }
  }

  let businessHours = null;
  if (tenant.business_hours) {
    try {
      businessHours = JSON.parse(tenant.business_hours);
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    business_name: tenant.business_name,
    business_type: tenant.business_type,
    payment_info: tenant.payment_info,
    custom_greeting: tenant.custom_greeting,
    custom_prompt: tenant.custom_prompt,
    catalog_url: tenant.catalog_url,
    catalog_message: tenant.catalog_message,
    assistant_name: tenant.assistant_name,
    business_address: tenant.business_address,
    business_hours: businessHours ?? {
      enabled: false,
      days: [1, 2, 3, 4, 5, 6],
      open: "09:00",
      close: "18:00",
    },
    out_of_hours_message: tenant.out_of_hours_message,
    extra_links: extraLinks,
  });
}

export async function PUT(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const business_name = String(body.business_name ?? "")
    .trim()
    .slice(0, 100);
  const business_type = String(body.business_type ?? "")
    .trim()
    .slice(0, 100);
  const payment_info = String(body.payment_info ?? "")
    .trim()
    .slice(0, 1000);
  const custom_greeting = String(body.custom_greeting ?? "")
    .trim()
    .slice(0, 200);
  const custom_prompt = String(body.custom_prompt ?? "")
    .trim()
    .slice(0, 2000);
  const catalog_url = String(body.catalog_url ?? "")
    .trim()
    .slice(0, 300);
  const catalog_message = String(body.catalog_message ?? "")
    .trim()
    .slice(0, 300);
  const assistant_name = String(body.assistant_name ?? "")
    .trim()
    .slice(0, 50);
  const business_address = String(body.business_address ?? "")
    .trim()
    .slice(0, 300);
  const out_of_hours_message = String(body.out_of_hours_message ?? "")
    .trim()
    .slice(0, 300);

  // Validar y serializar business_hours
  let business_hours_json: string | null = null;
  const bh = body.business_hours as Record<string, unknown> | undefined;
  if (bh && typeof bh === "object") {
    const hours = {
      enabled: !!bh.enabled,
      days: Array.isArray(bh.days)
        ? (bh.days as number[]).filter((d) => d >= 1 && d <= 7)
        : [1, 2, 3, 4, 5, 6],
      open: String(bh.open ?? "09:00").slice(0, 5),
      close: String(bh.close ?? "18:00").slice(0, 5),
    };
    business_hours_json = JSON.stringify(hours);
  }

  // Validar y serializar extra_links (máx 5)
  let extra_links_json: string | null = null;
  if (Array.isArray(body.extra_links)) {
    const links = (body.extra_links as TenantLink[])
      .filter((l) => l && l.label && l.url)
      .slice(0, 5)
      .map((l) => ({
        label: String(l.label).trim().slice(0, 40),
        url: String(l.url).trim().slice(0, 300),
      }));
    if (links.length > 0) {
      extra_links_json = JSON.stringify(links);
    }
  }

  updateTenantConfig(ctx.tenantId, {
    business_name: business_name || null,
    business_type: business_type || null,
    payment_info: payment_info || null,
    custom_greeting: custom_greeting || null,
    custom_prompt: custom_prompt || null,
    catalog_url: catalog_url || null,
    catalog_message: catalog_message || null,
    assistant_name: assistant_name || null,
    business_address: business_address || null,
    business_hours: business_hours_json,
    out_of_hours_message: out_of_hours_message || null,
    extra_links: extra_links_json,
  });

  return NextResponse.json({ ok: true });
}
