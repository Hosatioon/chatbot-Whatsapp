import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/tenant";
import { getVapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

// La llave pública no es secreta (es literalmente lo que se manda a cada
// navegador para que sepa a quién debe dejar mandarle push), pero igual la
// servimos detrás de sesión — no tiene sentido exponerla a quien no está
// logueado en el panel.
export async function GET() {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "Notificaciones push no configuradas en el servidor" },
      { status: 503 },
    );
  }
  return NextResponse.json({ publicKey });
}
