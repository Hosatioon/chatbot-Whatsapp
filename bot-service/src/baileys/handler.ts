/**
 * Handler de mensajes para el bot-service.
 * Procesa mensajes entrantes de WhatsApp y genera respuestas via LLM.
 * Usa Redis para rate limiting y BullMQ para outbox.
 */

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import {
  getOrCreateConversation,
  getRecentHistory,
  insertMessage,
  hasExceededDailyLimit,
  incrementDailyUsage,
  getActiveProducts,
  getTenantPlan,
  isTrialExpired,
} from "../db";
import { generateReply, type LLMResponse } from "../openrouter";
import { createOrder } from "../events";
import {
  checkRateLimit,
  getCachedProducts,
  setCachedProducts,
  invalidateProductsCache,
  generateLLMCacheKey,
  getCachedLLMResponse,
  setCachedLLMResponse,
} from "../redis";
import {
  enqueueOutboxMessage,
  setMessageSender,
  getOutboxWorker,
  drainOutboxQueue,
  closeOutboxQueue,
} from "../queue";

let rateLimitReady = false;

export async function initQueueHandlers(sock: WASocket): Promise<void> {
  setMessageSender(async (remoteJid: string, content: string) => {
    await sock.sendMessage(remoteJid, { text: content });
  });

  getOutboxWorker();
  rateLimitReady = true;
  console.log("[bot] Handlers de cola inicializados");
}

export async function shutdownQueueHandlers(): Promise<void> {
  await drainOutboxQueue();
  await closeOutboxQueue();
  rateLimitReady = false;
}

function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  if (typeof m.conversation === "string" && m.conversation.length > 0) {
    return m.conversation;
  }
  const ext = m.extendedTextMessage?.text;
  if (typeof ext === "string" && ext.length > 0) return ext;
  return null;
}

function jidToPhone(jid: string): string {
  const at = jid.indexOf("@");
  const base = at >= 0 ? jid.slice(0, at) : jid;
  const colon = base.indexOf(":");
  return colon >= 0 ? base.slice(0, colon) : base;
}

export async function handleIncomingMessages(
  tenantId: number,
  sock: WASocket,
  messages: WAMessage[],
): Promise<void> {
  for (const msg of messages) {
    try {
      await handleSingleMessage(tenantId, sock, msg);
    } catch (err) {
      console.error(`[bot:${tenantId}] Error en mensaje individual:`, err);
    }
  }
}

async function handleSingleMessage(
  tenantId: number,
  sock: WASocket,
  msg: WAMessage,
): Promise<void> {
  const remoteJid = msg.key.remoteJid;
  const fromMe = msg.key.fromMe;
  const text = extractText(msg);

  if (fromMe) return;
  if (!remoteJid) return;
  if (remoteJid.endsWith("@g.us")) return;
  if (!remoteJid.endsWith("@s.whatsapp.net") && !remoteJid.endsWith("@lid")) {
    return;
  }

  if (!text) return;

  const phone = jidToPhone(remoteJid);
  const pushName = msg.pushName ?? null;

  const trimmed = text.trim();
  if (!trimmed) return;

  // Rate limiting con Redis
  if (rateLimitReady) {
    const rateLimit = await checkRateLimit(tenantId, phone, trimmed);
    if (!rateLimit.allowed) {
      console.warn(
        `[bot] Rate-limit [${rateLimit.reason}] para ${phone}, descartando`,
      );
      return;
    }
  }

  const convo = getOrCreateConversation(tenantId, phone, pushName, remoteJid);

  const today = new Date().toISOString().slice(0, 10);
  const lastMsgDate = convo.last_message_at
    ? new Date(convo.last_message_at * 1000).toISOString().slice(0, 10)
    : null;
  const isNewChatToday = !lastMsgDate || lastMsgDate !== today;

  if (isNewChatToday) {
    const tp = getTenantPlan(tenantId);
    if (tp && isTrialExpired(tp)) {
      const expiredMsg =
        "Tu prueba gratuita de 15 días ha terminado 😔\n\nContacta a tu proveedor para activar tu plan y seguir atendiendo a tus clientes.";
      try {
        await sock.sendMessage(remoteJid, { text: expiredMsg });
      } catch (e) {
        console.error("[bot] Error enviando mensaje de trial expirado:", e);
      }
      return;
    }
    if (hasExceededDailyLimit(tenantId)) {
      const limitMsg =
        "Hoy hemos atendido el límite de chats de tu plan 😔\n\nTu plan se renueva mañana.";
      try {
        await sock.sendMessage(remoteJid, { text: limitMsg });
      } catch (e) {
        console.error("[bot] Error enviando mensaje de límite:", e);
      }
      return;
    }
    incrementDailyUsage(tenantId, today, true, 1);
  } else {
    incrementDailyUsage(tenantId, today, false, 1);
  }

  console.log(`[bot:${tenantId}] ← Mensaje de ${phone} (${text.length} chars)`);
  insertMessage(convo.id, "user", text);

  if (convo.mode !== "AI") {
    console.log(`[bot] Conversación en modo ${convo.mode}, no respondo`);
    return;
  }

  const history = getRecentHistory(convo.id, 20);

  // Intentar caché LLM
  let llmResponse: LLMResponse;
  const cacheKey = generateLLMCacheKey(
    tenantId,
    history.map((m) => ({ role: m.role, content: m.content })),
  );

  if (rateLimitReady) {
    const cachedResponse = await getCachedLLMResponse(cacheKey);
    if (cachedResponse) {
      console.log(`[bot] LLM cache hit para ${phone}`);
      try {
        llmResponse = JSON.parse(cachedResponse);
      } catch {
        llmResponse = { intent: "chat", reply: cachedResponse };
      }
    } else {
      llmResponse = await generateReplyWithCache(history, tenantId, cacheKey);
    }
  } else {
    llmResponse = await generateReply(history, tenantId);
  }

  if (llmResponse.intent === "create_order" && llmResponse.order_data) {
    try {
      console.log(
        `[bot] Creando pedido para ${phone} con ${llmResponse.order_data.items.length} items`,
      );

      let products = rateLimitReady ? await getCachedProducts(tenantId) : null;

      if (!products) {
        products = getActiveProducts(tenantId);
        if (rateLimitReady) {
          await setCachedProducts(tenantId, products);
        }
      }

      const items = llmResponse.order_data.items.map((item) => {
        const itemNameLower = item.name.toLowerCase();
        const matched = (products as any[]).find(
          (p: any) =>
            p.name.toLowerCase().includes(itemNameLower) ||
            itemNameLower.includes(p.name.toLowerCase()),
        );
        return {
          product_name: matched?.name ?? item.name,
          quantity: item.quantity,
          unit_price: matched?.price ?? 0,
        };
      });

      const order = await createOrder({
        tenant_id: tenantId,
        customer_phone: phone,
        customer_name: pushName,
        items,
        notes: llmResponse.order_data.notes ?? null,
      });
      console.log(`[bot] Pedido #${order.id} creado exitosamente`);
    } catch (err) {
      console.error("[bot] Error procesando pedido:", err);
    }
  }

  insertMessage(convo.id, "assistant", llmResponse.reply);

  // Usar cola BullMQ para enviar mensaje
  try {
    if (rateLimitReady) {
      await enqueueOutboxMessage(
        tenantId,
        convo.id,
        phone,
        llmResponse.reply,
        remoteJid,
      );
      console.log(`[bot] → Encolado para ${phone}`);
    } else {
      await sock.sendMessage(remoteJid, { text: llmResponse.reply });
      console.log(`[bot] → Enviado directo a ${phone}`);
    }
  } catch (err) {
    console.error(`[bot] Error enviando a ${phone}:`, err);
  }

  const catalogUrl = process.env.CATALOG_URL;
  if (catalogUrl && history.length === 1) {
    try {
      await new Promise((r) => setTimeout(r, 800));
      const catalogMsg = `Aquí te dejo nuestro catálogo completo 😋\n\n${catalogUrl}`;
      await sock.sendMessage(remoteJid, { text: catalogMsg });
      insertMessage(convo.id, "assistant", catalogMsg);
      console.log(`[bot] → Catálogo enviado a ${phone}`);
    } catch (err) {
      console.error(`[bot] Error enviando catálogo a ${phone}:`, err);
    }
  }
}

async function generateReplyWithCache(
  history: any[],
  tenantId: number,
  cacheKey: string,
): Promise<LLMResponse> {
  console.log(`[bot] Llamando LLM con ${history.length} mensajes...`);
  const t0 = Date.now();

  let llmResponse: LLMResponse;
  try {
    llmResponse = await generateReply(history, tenantId);
  } catch (err) {
    console.error("[bot] Error llamando al LLM:", err);
    throw err;
  }

  console.log(`[bot] LLM respondió en ${Date.now() - t0}ms`);

  // Guardar en caché
  await setCachedLLMResponse(cacheKey, JSON.stringify(llmResponse), 3600);

  return llmResponse;
}
