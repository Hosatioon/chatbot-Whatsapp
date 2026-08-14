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
  getLLMBudgetStatus,
  recordLLMUsage,
  getTenantById,
  getTenantLinks,
  parseBusinessHours,
  isWithinBusinessHours,
} from "../db";
import { generateReply, type LLMResponse } from "../openrouter";
import { createOrder } from "../events";
import { checkAndRecord } from "../rate-limit";
import {
  getStateForConversation,
  saveState,
  resetState,
  computeStateFromDraft,
  tryAddProductsFromText,
  detectDeliveryMethod,
  detectPaymentMethod,
  looksLikeAddress,
  isConfirmation,
  isCancellation,
  isDoneSelecting,
  computeDraftTotal,
  type ConversationState,
} from "../conversation-state";

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

// Delay aleatorio humanizado: nunca enviar dos mensajes en el mismo segundo
function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}

// Construir el bloque de links programático (sin IA)
function buildLinksMessage(tenantId: number): string | null {
  const tenant = getTenantById(tenantId);
  if (!tenant) return null;
  const links = getTenantLinks(tenant);
  if (links.length === 0) return null;
  const lines: string[] = [];
  const catalogMsg = tenant.catalog_message || "Aquí te dejo nuestro catálogo";
  const catalogLink = links.find((l) => l.label === "Catálogo");
  if (catalogLink) {
    lines.push(catalogMsg);
    lines.push(catalogLink.url);
  }
  const extraLinks = links.filter((l) => l.label !== "Catálogo");
  if (extraLinks.length > 0) {
    lines.push("");
    for (const l of extraLinks) {
      lines.push(`${l.label}: ${l.url}`);
    }
  }
  return lines.join("\n") || null;
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

  // === Check de horario de atención (programático, sin IA) ===
  const tenant = getTenantById(tenantId);
  if (tenant) {
    const hours = parseBusinessHours(tenant.business_hours);
    if (hours && hours.enabled && !isWithinBusinessHours(hours)) {
      const oohMsg =
        tenant.out_of_hours_message ||
        "¡Gracias por escribir! En este momento estamos cerrados. Te respondemos en nuestro horario de atención.";
      insertMessage(convo.id, "assistant", oohMsg);
      await humanDelay(1000, 3000);
      try {
        await sock.sendMessage(remoteJid, { text: oohMsg });
        console.log(`[bot] → Mensaje fuera de horario enviado a ${phone}`);
      } catch (e) {
        console.error(`[bot] Error enviando mensaje fuera de horario:`, e);
      }
      return;
    }
  }

  // === Saludo personalizado en primera interacción (programático, sin IA) ===
  const historyLimit = Math.min(
    Math.max(parseInt(process.env.LLM_HISTORY_MESSAGES || "10", 10) || 10, 4),
    15,
  );
  const history = getRecentHistory(convo.id, historyLimit);
  const isFirstMessage = history.length === 1;

  if (isFirstMessage && tenant?.custom_greeting) {
    const greeting = tenant.custom_greeting;
    insertMessage(convo.id, "assistant", greeting);
    await humanDelay(1000, 3000);
    try {
      await sock.sendMessage(remoteJid, { text: greeting });
      console.log(`[bot] → Saludo personalizado enviado a ${phone}`);
    } catch (e) {
      console.error(`[bot] Error enviando saludo:`, e);
    }

    // Enviar bloque de links después del saludo (delay humanizado)
    const linksMsg = buildLinksMessage(tenantId);
    if (linksMsg) {
      await humanDelay(800, 2000);
      insertMessage(convo.id, "assistant", linksMsg);
      try {
        await sock.sendMessage(remoteJid, { text: linksMsg });
        console.log(`[bot] → Links enviados a ${phone}`);
      } catch (e) {
        console.error(`[bot] Error enviando links:`, e);
      }
    }
    return; // No llamar al LLM, ya respondimos programáticamente
  }

  // Verificar presupuesto de IA antes de llamar al LLM
  const budget = getLLMBudgetStatus(tenantId);
  if (budget.exceeded) {
    console.warn(`[bot:${tenantId}] Presupuesto IA excedido: ${budget.reason}`);
    const budgetMsg =
      "En este momento te atenderá una persona del equipo. ¡Gracias por tu paciencia!";
    insertMessage(convo.id, "assistant", budgetMsg);
    try {
      await sock.sendMessage(remoteJid, { text: budgetMsg });
    } catch (e) {
      console.error("[bot] Error enviando mensaje de presupuesto:", e);
    }
    return;
  }

  // === Máquina de estados: procesar mensaje del cliente antes del LLM ===
  const convState = getStateForConversation(convo.id, tenantId);
  console.log(
    `[bot:${tenantId}] Estado conversación: ${convState.state}, items=${convState.draft_items.length}, delivery=${convState.draft_delivery_method ?? "no"}, addr=${convState.draft_address ? "sí" : "no"}, pay=${convState.draft_payment ?? "no"}`,
  );

  // Detectar cancelación
  if (isCancellation(text)) {
    resetState(convo.id);
    convState.draft_items = [];
    convState.draft_delivery_method = null;
    convState.draft_address = null;
    convState.draft_payment = null;
    convState.state = "SELECTING_PRODUCTS";
    console.log(`[bot:${tenantId}] Cliente canceló, estado reseteado`);
  }

  // Procesar según el estado actual
  if (convState.state === "SELECTING_PRODUCTS") {
    // Intentar extraer productos del mensaje
    const { added, products } = tryAddProductsFromText(convState, text);
    if (added) {
      console.log(
        `[bot:${tenantId}] Productos agregados al draft: ${products.map((p) => `${p.quantity}x ${p.name}`).join(", ")}`,
      );
    }
    // Si el cliente dice que no quiere nada más y ya tiene items, avanzar
    if (isDoneSelecting(text) && convState.draft_items.length > 0) {
      convState.state = "ASKING_DELIVERY_METHOD";
      console.log(
        `[bot:${tenantId}] Cliente terminó de seleccionar, pasando a ASKING_DELIVERY_METHOD`,
      );
    }
  } else if (convState.state === "ASKING_DELIVERY_METHOD") {
    const delivery = detectDeliveryMethod(text);
    if (delivery) {
      convState.draft_delivery_method = delivery;
      console.log(
        `[bot:${tenantId}] Método de entrega: ${convState.draft_delivery_method}`,
      );
      if (delivery === "recoger") {
        // Skip address, go straight to payment
        convState.state = "ASKING_PAYMENT";
      } else {
        convState.state = "ASKING_ADDRESS";
      }
    }
  } else if (convState.state === "ASKING_ADDRESS") {
    if (looksLikeAddress(text)) {
      convState.draft_address = text.trim();
      console.log(
        `[bot:${tenantId}] Dirección guardada: ${convState.draft_address}`,
      );
    }
  } else if (convState.state === "ASKING_PAYMENT") {
    const payment = detectPaymentMethod(text);
    if (payment) {
      convState.draft_payment = payment;
      console.log(
        `[bot:${tenantId}] Pago guardado: ${convState.draft_payment}`,
      );
    }
  } else if (convState.state === "WAITING_CONFIRMATION") {
    if (isConfirmation(text)) {
      // Crear pedido directamente desde el draft
      convState.state = "CONFIRMED";
      try {
        const order = await createOrder({
          tenant_id: tenantId,
          customer_phone: phone,
          customer_name: pushName,
          items: convState.draft_items.map((item) => ({
            product_name: item.name,
            quantity: item.quantity,
            unit_price: item.price,
          })),
          notes: `Entrega: ${convState.draft_address ?? "a convenir"}. Pago: ${convState.draft_payment ?? "a definir"}.`,
        });
        console.log(
          `[bot:${tenantId}] Pedido #${order.id} creado desde estado`,
        );

        // Guardar estado confirmado
        saveState(convState);

        // Enviar confirmación con datos de pago según método
        const total = computeDraftTotal(convState.draft_items);
        const paymentInfo = tenant?.payment_info || "";
        let confirmMsg: string;
        if (convState.draft_payment === "efectivo") {
          confirmMsg = `¡Pedido confirmado! 🎉\n\nTotal: $${total.toLocaleString("es-CO")}\n\nPago en efectivo. Tene listo el monto exacto para la entrega 😋\n\n¿Algo más en lo que te pueda ayudar?`;
        } else {
          confirmMsg = `¡Pedido confirmado! 🎉\n\nTotal: $${total.toLocaleString("es-CO")}\n\n${paymentInfo}\n\nMandame el comprobante cuando transfieras y te aviso cuando esté listo 😋`;
        }

        insertMessage(convo.id, "assistant", confirmMsg);
        await humanDelay(1000, 3000);
        try {
          await sock.sendMessage(remoteJid, { text: confirmMsg });
          console.log(`[bot] → Confirmación de pedido enviada a ${phone}`);
        } catch (e) {
          console.error(`[bot] Error enviando confirmación:`, e);
        }

        // Limpiar estado después de crear el pedido
        resetState(convo.id);
        return;
      } catch (err) {
        console.error(
          `[bot:${tenantId}] Error creando pedido desde estado:`,
          err,
        );
        // Si falla, dejar que el LLM maneje el error
        convState.state = "WAITING_CONFIRMATION";
      }
    }
  }

  // Recalcular estado basado en draft
  computeStateFromDraft(convState);
  saveState(convState);
  console.log(`[bot:${tenantId}] Estado actualizado: ${convState.state}`);

  // === Si el estado avanzó, generar respuesta directamente sin LLM ===
  if (convState.state === "ASKING_DELIVERY_METHOD" && isDoneSelecting(text)) {
    const msg = "¿Es para domicilio o lo recogés en tienda?";
    insertMessage(convo.id, "assistant", msg);
    await humanDelay(1000, 2000);
    try {
      await sock.sendMessage(remoteJid, { text: msg });
    } catch (e) {
      console.error(`[bot] Error enviando pregunta entrega:`, e);
    }
    return;
  }

  if (convState.state === "ASKING_ADDRESS" && convState.draft_delivery_method) {
    const msg = "¿Cuál es la dirección de entrega?";
    insertMessage(convo.id, "assistant", msg);
    await humanDelay(1000, 2000);
    try {
      await sock.sendMessage(remoteJid, { text: msg });
    } catch (e) {
      console.error(`[bot] Error enviando pregunta dirección:`, e);
    }
    return;
  }

  if (
    convState.state === "ASKING_PAYMENT" &&
    (convState.draft_delivery_method === "recoger" || convState.draft_address)
  ) {
    const msg = "¿Transferencia o efectivo?";
    insertMessage(convo.id, "assistant", msg);
    await humanDelay(1000, 2000);
    try {
      await sock.sendMessage(remoteJid, { text: msg });
    } catch (e) {
      console.error(`[bot] Error enviando pregunta pago:`, e);
    }
    return;
  }

  if (convState.state === "WAITING_CONFIRMATION" && convState.draft_payment) {
    // Mostrar resumen y pedir confirmación
    const lines: string[] = [];
    for (const item of convState.draft_items) {
      const subtotal = item.price * item.quantity;
      lines.push(
        `${item.quantity} ${item.name} — $${subtotal.toLocaleString("es-CO")}`,
      );
    }
    const total = computeDraftTotal(convState.draft_items);
    const delivery =
      convState.draft_delivery_method === "recoger"
        ? "Recoger en tienda"
        : `Domicilio: ${convState.draft_address}`;
    const payment =
      convState.draft_payment === "efectivo" ? "Efectivo" : "Transferencia";
    const msg = `Perfecto, tu pedido sería:\n\n${lines.join("\n")}\nTotal: $${total.toLocaleString("es-CO")}\nEntrega: ${delivery}\nPago: ${payment}\n\n¿Confirmas el pedido?`;
    insertMessage(convo.id, "assistant", msg);
    await humanDelay(1000, 2000);
    try {
      await sock.sendMessage(remoteJid, { text: msg });
    } catch (e) {
      console.error(`[bot] Error enviando resumen:`, e);
    }
    return;
  }

  console.log(`[bot] llamando LLM con ${history.length} mensajes...`);
  const t0 = Date.now();
  let llmResponse: LLMResponse;
  let usage: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
  } | null = null;
  try {
    const result = await generateReply(history, tenantId, {
      customerPhone: phone,
      customerName: pushName,
      conversationState: convState,
    });
    llmResponse = result.response;
    usage = result.usage;
  } catch (err) {
    console.error("[bot] Error llamando al LLM:", err);
    recordLLMUsage({
      tenant_id: tenantId,
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      duration_ms: Date.now() - t0,
      success: false,
      error_message: (err as Error).message?.slice(0, 500) ?? String(err),
    });

    const fallbackMsg =
      "Ups, tuve un problema procesando tu mensaje. ¿Me lo puedes repetir de otra forma? O si prefieres, te conecto con una persona del equipo.";
    insertMessage(convo.id, "assistant", fallbackMsg);
    try {
      await sock.sendMessage(remoteJid, { text: fallbackMsg });
    } catch (e) {
      console.error("[bot] Error enviando mensaje de fallback:", e);
    }
    return;
  }
  console.log(`[bot] LLM respondió en ${Date.now() - t0}ms`);

  // Registrar uso de tokens y costo
  if (usage) {
    recordLLMUsage({
      tenant_id: tenantId,
      model: usage.model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      cost_usd: usage.costUsd,
      duration_ms: usage.durationMs,
      success: true,
    });
    console.log(
      `[bot:${tenantId}] LLM usage: ${usage.totalTokens} tokens, $${usage.costUsd.toFixed(6)} USD, ${usage.durationMs}ms`,
    );
  }

  // Si estamos en SELECTING_PRODUCTS con items y el LLM no preguntó "algo más", forzarlo
  if (
    convState.state === "SELECTING_PRODUCTS" &&
    convState.draft_items.length > 0 &&
    llmResponse.intent !== "create_order"
  ) {
    const replyLower = llmResponse.reply.toLowerCase();
    if (
      !replyLower.includes("algo más") &&
      !replyLower.includes("algo mas") &&
      !replyLower.includes("algo más?")
    ) {
      llmResponse.reply += " ¿Querés algo más?";
    }
  }

  insertMessage(convo.id, "assistant", llmResponse.reply);

  // Delay aleatorio 1-3s para parecer más humano y evitar detección
  await humanDelay(1000, 3000);
  console.log(`[bot] Enviando respuesta LLM a ${phone}...`);

  try {
    await sock.sendMessage(remoteJid, { text: llmResponse.reply });
    console.log(`[bot] → Enviado a ${phone}`);
  } catch (err) {
    console.error(`[bot] Error enviando a ${phone}:`, err);
  }

  // Si es la primera interacción y NO hubo saludo programático,
  // enviar el bloque de links después de la respuesta del LLM
  // (solo si el LLM no incluyó el catálogo en su respuesta)
  if (isFirstMessage && !tenant?.custom_greeting) {
    const linksMsg = buildLinksMessage(tenantId);
    const catalogUrl = tenant?.catalog_url || "";
    const llmAlreadySentCatalog =
      catalogUrl && llmResponse.reply.includes(catalogUrl);
    if (linksMsg && !llmAlreadySentCatalog) {
      await humanDelay(800, 2000);
      try {
        await sock.sendMessage(remoteJid, { text: linksMsg });
        insertMessage(convo.id, "assistant", linksMsg);
        console.log(`[bot] → Links enviados a ${phone}`);
      } catch (err) {
        console.error(`[bot] Error enviando links a ${phone}:`, err);
      }
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
