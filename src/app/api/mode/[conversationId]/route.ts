import { NextResponse, type NextRequest } from "next/server";
import { getConversationById, setMode } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ conversationId: string }>;
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
  const mode =
    body && typeof body === "object" && "mode" in body
      ? (body as { mode: unknown }).mode
      : null;
  if (mode !== "AI" && mode !== "HUMAN") {
    return NextResponse.json(
      { error: "mode debe ser 'AI' o 'HUMAN'" },
      { status: 400 },
    );
  }

  setMode(id, mode);
  return NextResponse.json({ ok: true, mode });
}
