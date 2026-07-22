import { NextResponse } from "next/server";
import { listConversations, listAllConversations } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { tenantId, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    const { searchParams } = new URL(req.url);
    const filterTenant = searchParams.get("tenantId");

    if (isSuperAdmin) {
      if (filterTenant) {
        return NextResponse.json({
          conversations: listConversations(Number(filterTenant)),
        });
      }
      return NextResponse.json({ conversations: listAllConversations() });
    }

    const conversations = listConversations(tenantId);
    return NextResponse.json({ conversations });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
