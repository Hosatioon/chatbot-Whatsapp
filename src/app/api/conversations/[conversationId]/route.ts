import { NextResponse, type NextRequest } from "next/server";
import { deleteConversation, getConversationById } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const convo = getConversationById(id);
  if (!convo) {
    return NextResponse.json(
      { error: "conversación no existe" },
      { status: 404 },
    );
  }
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
