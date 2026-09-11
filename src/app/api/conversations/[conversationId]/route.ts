import { NextResponse, type NextRequest } from "next/server";
import { deleteConversation, getConversationById } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, isSuperAdmin } = await requireTenantId();
    const { conversationId } = await params;
    const id = Number(conversationId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    let convo = getConversationById(id, tenantId);
    if (!convo && isSuperAdmin) convo = getConversationById(id);
    if (!convo) {
      return NextResponse.json(
        { error: "conversación no existe" },
        { status: 404 },
      );
    }
    deleteConversation(convo.tenant_id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
