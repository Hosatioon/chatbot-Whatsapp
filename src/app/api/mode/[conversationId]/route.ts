import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getConversationById, setMode } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

const ModeBody = z.object({ mode: z.enum(["AI", "HUMAN"]) });

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await requireTenantId();
    const { conversationId } = await params;
    const id = Number(conversationId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    const convo = getConversationById(id, tenantId);
    if (!convo) {
      return NextResponse.json(
        { error: "conversación no existe" },
        { status: 404 },
      );
    }

    const parsed = ModeBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "mode debe ser 'AI' o 'HUMAN'" },
        { status: 400 },
      );
    }

    setMode(tenantId, id, parsed.data.mode);
    return NextResponse.json({ ok: true, mode: parsed.data.mode });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
