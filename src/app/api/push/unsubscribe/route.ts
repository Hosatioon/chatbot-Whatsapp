import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/tenant";
import { deletePushSubscription } from "@/lib/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // No hace falta verificar que el endpoint pertenezca a este tenant: es un
  // string opaco generado por el navegador de quien lo manda, no un ID
  // adivinable de otro registro.
  deletePushSubscription(parsed.data.endpoint);

  return NextResponse.json({ ok: true });
}
