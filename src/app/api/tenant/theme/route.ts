import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getTenantTheme,
  setTenantTheme,
  TENANT_THEMES,
  type TenantTheme,
} from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  theme: z.enum(["light", "dark", "blue", "pink", "whatsapp"] as const),
});

export async function GET() {
  try {
    const { tenantId } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);

    const theme = getTenantTheme(tenantId);
    return NextResponse.json({ theme, available: TENANT_THEMES });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function PATCH(req: Request) {
  try {
    const { tenantId, role } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo ADMIN puede cambiar el tema" },
        { status: 403 },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Tema inválido. Opciones: light, dark, blue, pink" },
        { status: 400 },
      );
    }

    const theme: TenantTheme = parsed.data.theme;
    setTenantTheme(tenantId, theme);
    return NextResponse.json({ ok: true, theme });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
