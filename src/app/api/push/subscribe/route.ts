import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/tenant";
import { savePushSubscription } from "@/lib/db";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (res) {
    return res as Response;
  }
  if (ctx.tenantId == null) {
    return NextResponse.json(
      { error: "Tenant no encontrado en la sesión" },
      { status: 403 },
    );
  }

  const rl = checkApiRateLimit(`tenant:${ctx.tenantId}:push-subscribe`);
  if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  savePushSubscription(
    ctx.tenantId,
    parsed.data.endpoint,
    parsed.data.keys.p256dh,
    parsed.data.keys.auth,
  );

  return NextResponse.json({ ok: true });
}
