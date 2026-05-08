import { NextResponse, type NextRequest } from "next/server";
import {
  enqueueOutbox,
  getConversationById,
  getMessages,
  insertMessage,
} from "@/lib/db";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
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
  const messages = getMessages(id, 200);
  return NextResponse.json({ conversation: convo, messages });
}

export async function POST(req: NextRequest, { params }: Ctx) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const content =
    body && typeof body === "object" && "content" in body
      ? String((body as { content: unknown }).content ?? "").trim()
      : "";
  if (!content) {
    return NextResponse.json({ error: "content vacío" }, { status: 400 });
  }

  // 1. Insert visible inmediatamente en el dashboard
  const messageId = insertMessage(id, "human", content);
  // 2. Encolar para que el bot lo envíe vía Baileys.
  //    Pasamos el jid completo guardado para soportar contactos con @lid.
  enqueueOutbox(id, convo.phone, content, convo.jid);

  return NextResponse.json({ ok: true, messageId });
}
