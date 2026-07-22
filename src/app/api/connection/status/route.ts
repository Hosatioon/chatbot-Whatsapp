import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getConnectionState } from "@/lib/db";
import { requireAuth } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const url = new URL(req.url);
  const queryTenant = Number(url.searchParams.get("tenantId") ?? 0);
  // Super-admin: puede consultar cualquier tenant.
  // Usuario normal: SOLO su propio tenant (ignoramos query param).
  const tenantId =
    ctx.isSuperAdmin && queryTenant > 0 ? queryTenant : ctx.tenantId;

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId requerido" }, { status: 400 });
  }

  const state = getConnectionState(tenantId);

  const shouldShowQr =
    !!state.qr_string &&
    (state.status === "qr" || state.status === "connecting");

  if (shouldShowQr && state.qr_string) {
    const qrPng = await QRCode.toDataURL(state.qr_string, {
      width: 320,
      margin: 2,
    });
    return NextResponse.json({
      status: "qr",
      qrPng,
      tenantId,
      updatedAt: state.updated_at,
    });
  }

  return NextResponse.json({
    status: state.status,
    phone: state.phone,
    tenantId,
    updatedAt: state.updated_at,
  });
}
