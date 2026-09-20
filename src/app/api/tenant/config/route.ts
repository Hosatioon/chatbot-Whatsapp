import { NextRequest, NextResponse } from "next/server";
import {
  getTenantById,
  updateTenantConfig,
  setTenantAdminPhone2,
  type TenantLink,
} from "@/lib/db";
import { requireAuth } from "@/lib/tenant";
import { extractLatLngFromUrl } from "@/lib/geo";

export const dynamic = "force-dynamic";

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
    feedback_message: tenant.feedback_message,
    admin_phone: tenant.admin_phone,
    admin_phone_2: tenant.admin_phone_2,
    delivery_price: tenant.delivery_price,
    business_location_url: tenant.business_location_url,
    business_location_detected:
      tenant.business_lat != null && tenant.business_lng != null,
    price_per_km: tenant.price_per_km,
    max_delivery_km: tenant.max_delivery_km,
    min_order_amount: tenant.min_order_amount,
    min_delivery_price: tenant.min_delivery_price,
    bot_paused: tenant.bot_paused === 1,
    paused_message: tenant.paused_message,
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
  const feedback_message = String(body.feedback_message ?? "")
    .trim()
    .slice(0, 500);
  const admin_phone = String(body.admin_phone ?? "")
    .trim()
    .slice(0, 20);
  const admin_phone_2 = String(body.admin_phone_2 ?? "")
    .trim()
    .slice(0, 20);
  // Máximo 2 números de notificación (más se parece demasiado a una
  // difusión y sube el riesgo de bloqueo de WhatsApp), y no pueden ser el
  // mismo número escrito de dos formas.
  const d1 = admin_phone.replace(/\D/g, "");
  const d2 = admin_phone_2.replace(/\D/g, "");
  if (d2 && d1 && (d1.endsWith(d2) || d2.endsWith(d1))) {
    return NextResponse.json(
      { error: "El segundo número de notificaciones no puede ser el mismo que el primero." },
      { status: 400 },
    );
  }
  const delivery_price =
    body.delivery_price != null
      ? Math.max(0, Math.floor(Number(body.delivery_price)))
      : null;
  const business_location_url = String(body.business_location_url ?? "")
    .trim()
    .slice(0, 500);
  const price_per_km =
    body.price_per_km != null
      ? Math.max(0, Math.floor(Number(body.price_per_km)))
      : null;
  const min_order_amount =
    body.min_order_amount != null && body.min_order_amount !== ""
      ? Math.max(0, Math.floor(Number(body.min_order_amount)))
      : null;
  const min_delivery_price =
    body.min_delivery_price != null && body.min_delivery_price !== ""
      ? Math.max(0, Math.floor(Number(body.min_delivery_price)))
      : null;

  // max_delivery_km, bot_paused y paused_message son "solo super-admin" —
  // ya estaban sacados del panel del tenant en la UI, pero el PUT los
  // seguía aceptando de CUALQUIER usuario autenticado (un tenant con
  // devtools/curl podía mandarlos igual). Se calculan solo si quien llama
  // es super-admin; si no, más abajo se preservan los valores que ya
  // tenía el tenant en vez de dejar que el body los pise.
  const max_delivery_km =
    body.max_delivery_km != null && body.max_delivery_km !== ""
      ? Math.min(200, Math.max(0.5, Number(body.max_delivery_km)))
      : null;
  const bot_paused = !!body.bot_paused;
  const paused_message = String(body.paused_message ?? "")
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

  const queryTenant = Number(req.nextUrl.searchParams.get("tenantId") ?? 0);
  const tenantId =
    ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;
  if (tenantId == null) {
    return NextResponse.json(
      { error: "Tenant no encontrado en la sesión" },
      { status: 403 },
    );
  }

  // Extraer lat/lng del URL de Google Maps si se proporcionó
  let business_lat: number | null = null;
  let business_lng: number | null = null;
  if (business_location_url) {
    const coords = await extractLatLngFromUrl(business_location_url);
    if (coords) {
      business_lat = coords.lat;
      business_lng = coords.lng;
    }
  }

  // Campos solo-super-admin: si quien llama es un tenant normal, no dejar
  // que el body los cambie — preservar lo que ya había guardado.
  let effectiveMaxDeliveryKm = max_delivery_km;
  let effectiveBotPaused = bot_paused;
  let effectivePausedMessage = paused_message || null;
  if (!ctx.isSuperAdmin) {
    const current = getTenantById(tenantId);
    effectiveMaxDeliveryKm = current?.max_delivery_km ?? null;
    effectiveBotPaused = current?.bot_paused === 1;
    effectivePausedMessage = current?.paused_message ?? null;
  }

  updateTenantConfig(tenantId, {
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
    feedback_message: feedback_message || null,
    admin_phone: admin_phone || null,
    delivery_price: delivery_price,
    business_location_url: business_location_url || null,
    price_per_km: price_per_km,
    max_delivery_km: effectiveMaxDeliveryKm,
    min_order_amount: min_order_amount,
    min_delivery_price: min_delivery_price,
    bot_paused: effectiveBotPaused,
    paused_message: effectivePausedMessage,
  });

  setTenantAdminPhone2(tenantId, admin_phone_2 || null);

  // Guardar lat/lng directamente en la BD
  if (business_lat !== null && business_lng !== null) {
    const db = (await import("@/lib/db")).default;
    db.prepare(
      "UPDATE tenants SET business_lat = ?, business_lng = ? WHERE id = ?",
    ).run(business_lat, business_lng, tenantId);
  }

  return NextResponse.json({ ok: true });
}
