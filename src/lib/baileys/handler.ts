import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import {
  getConversationById,
  getOrCreateConversation,
  getPendingOutbox,
  getRecentHistory,
  insertMessage,
  markOutboxSent,
  purgeOldMessageEvents,
  hasExceededDailyLimit,
  incrementDailyUsage,
} from "../db";
import { generateReply, type LLMResponse } from "../openrouter";
import { createOrder } from "../events";
import { getActiveProducts } from "../db";
import { checkAndRecord } from "../rate-limit";

// Limpieza periódica del registro de eventos para rate limiting
let lastPurge = 0;
function maybePurge() {
  const now = Date.now();
  if (now - lastPurge > 10 * 60 * 1000) {
    lastPurge = now;
    try {
      purgeOldMessageEvents(7200);
    } catch (e) {
      console.error("[bot] purgeOldMessageEvents error:", e);
    }
  }
}

// ---------------------------------------------------------------------------
// Mensajes entrantes
// ---------------------------------------------------------------------------

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
  const msgKeys = msg.message ? Object.keys(msg.message) : [];

  console.log(
    `[bot] msg recibido jid=${remoteJid} fromMe=${fromMe} text="${text}" tipos=${msgKeys.join(",")}`,
  );

  // Filtros
  if (fromMe) return; // mensaje propio (eco)
  if (!remoteJid) return;
  if (remoteJid.endsWith("@g.us")) return; // grupos fuera de scope
  if (!remoteJid.endsWith("@s.whatsapp.net") && !remoteJid.endsWith("@lid")) {
    console.log(`[bot] descartado: jid no soportado (${remoteJid})`);
    return;
  }

  if (!text) {
    console.log(
      `[bot] descartado: sin texto extraíble (tipos=${msgKeys.join(",")})`,
    );
    return;
  }

  const phone = jidToPhone(remoteJid);
  const pushName = msg.pushName ?? null;

  // Rate limiting / detección de spam
  maybePurge();
  const verdict = checkAndRecord(tenantId, phone, text);
  if (!verdict.ok) {
    console.warn(
      `[bot] rate-limit ${verdict.reason} desde ${phone}, descartando`,
    );
    return;
  }

  // Guardamos el JID completo (puede ser @s.whatsapp.net o @lid). Es lo
  // único que nos permite responder a contactos con Linked ID, donde el
  // "phone" guardado no se puede convertir a un JID público válido.
  const convo = getOrCreateConversation(tenantId, phone, pushName, remoteJid);

  // Verificar límite diario de chats por plan
  const today = new Date().toISOString().slice(0, 10);
  const lastMsgDate = convo.last_message_at
    ? new Date(convo.last_message_at * 1000).toISOString().slice(0, 10)
    : null;
  const isNewChatToday = !lastMsgDate || lastMsgDate !== today;

  if (isNewChatToday) {
    if (hasExceededDailyLimit(tenantId)) {
      const limitMsg =
        "Hoy hemos atendido el límite de chats de tu plan 😔\n\nTu plan se renueva mañana. Si necesitás más, contactá a tu administrador para actualizar.";
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

  // Por privacidad: no loguear el texto completo. Solo metadatos.
  console.log(`[bot:${tenantId}] ← Mensaje de ${phone} (${text.length} chars)`);
  insertMessage(convo.id, "user", text);

  // Re-leer por si el toggle cambió entre creación y este punto
  const fresh = getConversationById(convo.id, tenantId);
  if (!fresh || fresh.mode !== "AI") {
    console.log(
      `[bot] Conversación en modo ${fresh?.mode ?? "?"}, no respondo`,
    );
    return;
  }

  const history = getRecentHistory(convo.id, 20);
  console.log(`[bot] llamando LLM con ${history.length} mensajes...`);
  const t0 = Date.now();
  let llmResponse: LLMResponse;
  try {
    llmResponse = await generateReply(history, tenantId);
  } catch (err) {
    console.error("[bot] Error llamando al LLM:", err);
    return;
  }
  console.log(`[bot] LLM respondió en ${Date.now() - t0}ms`);

  // Procesar intención del LLM
  if (llmResponse.intent === "create_order" && llmResponse.order_data) {
    try {
      console.log(
        `[bot] Creando pedido para ${phone} con ${llmResponse.order_data.items.length} items`,
      );

      // Resolver precios de productos desde el catálogo
      const products = getActiveProducts(tenantId);
      const items = llmResponse.order_data.items.map((item) => {
        // Buscar producto por coincidencia parcial del nombre (case-insensitive)
        const itemNameLower = item.name.toLowerCase();
        const matched = products.find(
          (p) =>
            p.name.toLowerCase().includes(itemNameLower) ||
            itemNameLower.includes(p.name.toLowerCase()),
        );
        return {
          product_name: matched?.name ?? item.name,
          quantity: item.quantity,
          unit_price: matched?.price ?? 0,
        };
      });

      // Llamada directa a createOrder (más confiable que HTTP)
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

  // Guardar y enviar respuesta del LLM
  insertMessage(convo.id, "assistant", llmResponse.reply);

  try {
    await sock.sendMessage(remoteJid, { text: llmResponse.reply });
    console.log(`[bot] → Enviado a ${phone}`);
  } catch (err) {
    console.error(`[bot] Error enviando a ${phone}:`, err);
  }

  // Si es la primera interacción, enviar el catálogo después del saludo
  const catalogUrl = process.env.CATALOG_URL;
  if (catalogUrl && history.length === 1) {
    try {
      // Pequeña pausa para que no sea tan robótico
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

// ---------------------------------------------------------------------------
// Outbox (mensajes humanos desde el dashboard)
// ---------------------------------------------------------------------------

export async function processOutbox(
  tenantId: number,
  sock: WASocket,
): Promise<void> {
  // No intentar enviar si el socket aún no está autenticado/abierto.
  // Sin esto el loop spam-falla con errores 428 "Connection Closed"
  // mientras el bot está reconectando o esperando QR.
  if (!sock.user) return;

  const pending = getPendingOutbox(tenantId, 20);
  if (pending.length === 0) return;
  for (const item of pending) {
    // Preferir el remote_jid guardado (soporta @lid). Fallback a
    // construirlo desde el phone para outbox legacy.
    const jid = item.remote_jid ?? `${item.phone}@s.whatsapp.net`;
    try {
      await sock.sendMessage(jid, { text: item.content });
      markOutboxSent(item.id);
      console.log(`[bot] → Outbox #${item.id} enviado a ${jid}`);
    } catch (err) {
      console.error(
        `[bot] Error enviando outbox #${item.id} a ${item.phone}:`,
        (err as Error).message ?? err,
      );
      // Dejar sent=0 → reintenta en próximo tick
    }
  }
}
