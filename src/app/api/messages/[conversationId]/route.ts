import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  enqueueOutbox,
  getConversationById,
  getMessages,
  insertMessage,
} from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ conversationId: string }>;
}

const PostBody = z.object({
  content: z.string().trim().min(1).max(4000),
});

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
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
    const messages = getMessages(tenantId, id, 200);
    return NextResponse.json({ conversation: convo, messages });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
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

    const parsed = PostBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "content inválido" }, { status: 400 });
    }
    const content = parsed.data.content;

    const messageId = insertMessage(id, "human", content);
    enqueueOutbox(tenantId, id, convo.phone, content, convo.jid);

    return NextResponse.json({ ok: true, messageId });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
