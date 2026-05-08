import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getConnectionState } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getConnectionState();

  // Defensivo: mostrar QR si qr_string existe, aunque el status no sea
  // exactamente 'qr' (puede haber transicionado a 'connecting' por race).
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
      updatedAt: state.updated_at,
    });
  }

  return NextResponse.json({
    status: state.status,
    phone: state.phone,
    updatedAt: state.updated_at,
  });
}
