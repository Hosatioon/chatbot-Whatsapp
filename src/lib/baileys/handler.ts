import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import {
  getConversationById,
  getOrCreateConversation,
  getPendingOutbox,
  getRecentHistory,
  insertMessage,
  markOutboxSent,
  enqueueOutbox,
  purgeOldMessageEvents,
  hasExceededDailyLimit,
  incrementDailyUsage,
  getLLMBudgetStatus,
  recordLLMUsage,
  getTenantById,
  getTenantLinks,
  parseBusinessHours,
  isWithinBusinessHours,
  isMessageProcessed,
  markMessageProcessed,
  purgeOldProcessedMessages,
  findConversationByPhoneSuffix,
  searchProducts,
  getOrderById,
  markMessageSent,
  markMessageFailed,
  markOutboxExpired,
  getConfirmReminderCandidates,
} from "../db";
import { generateReply, type LLMResponse } from "../openrouter";
import { buildOrderSummaryForCustomer } from "../system-prompt";
import { sendPushToTenant } from "../push";
import { sendTextWithSafePreview } from "./send";
import { checkAndRecord } from "../rate-limit";
import { debounceMessage, hasPendingDebounce } from "../debounce";
import { acquireLLMSlot } from "../llm-concurrency";
import {
  getStateForConversation,
  resetState,
  isCancellation,
  computeDraftTotal,
  tryAddProductsFromText,
  saveState,
  computeStateFromDraft,
} from "../conversation-state";

// Limpieza periódica del registro de eventos para rate limiting
let lastPurge = 0;
function maybePurge() {
  const now = Date.now();
  if (now - lastPurge > 10 * 60 * 1000) {
    lastPurge = now;
    try {
      purgeOldMessageEvents(7200);
      purgeOldProcessedMessages(86400);
    } catch (e) {
      console.error("[bot] purgeOldMessageEvents error:", e);
    }
  }
}

// Dedup de mensajes re-entregados por WhatsApp (mismo msg.key.id)
const processedMsgIds = new Map<string, number>();
function isDuplicateMessage(id: string | null | undefined): boolean {
  if (!id) return false;
  if (processedMsgIds.has(id)) return true;
  const now = Date.now();
  processedMsgIds.set(id, now);
  if (processedMsgIds.size > 2000) {
    for (const [k, ts] of processedMsgIds) {
      if (now - ts > 10 * 60 * 1000) processedMsgIds.delete(k);
    }
  }
  return false;
}

// Delay aleatorio humanizado: nunca enviar dos mensajes en el mismo segundo
function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}

// Pregunta de confirmación que va en su propio mensaje después del resumen.
// Constante compartida: el recordatorio (processConfirmReminders) la usa para
// reconocer "el último mensaje de la conversación es esta pregunta".
export const CONFIRM_FOLLOWUP_TEXT = "¿Confirmas para agendar tu pedido? 😊";

// Manda un texto por WhatsApp y lo vincula con su fila de `messages` (para
// los chulitos del dashboard): al salir guarda el id del mensaje de
// WhatsApp y lo marca "sent"; si falla lo marca "failed" y vuelve a lanzar el
// error para que cada caller mantenga su propio try/catch y su log.
async function sendTracked(
  sock: WASocket,
  jid: string,
  text: string,
  messageId: number | null,
): Promise<void> {
  try {
    const waId = await sendTextWithSafePreview(sock, jid, text);
    if (messageId) markMessageSent(messageId, waId);
  } catch (e) {
    if (messageId) markMessageFailed(messageId);
    throw e;
  }
}

// Números de notificación configurados (máximo 2), solo dígitos y sin repetir.
// Se guardan tal cual los escribe el dueño (normalmente SIN indicativo de
// país), por eso todas las comparaciones son por sufijo.
function getAdminNumbers(
  tenant: { admin_phone?: string | null; admin_phone_2?: string | null } | null,
): string[] {
  const out: string[] = [];
  for (const raw of [tenant?.admin_phone, tenant?.admin_phone_2]) {
    const d = raw?.replace(/[^\d]/g, "") ?? "";
    if (d.length < 7) continue;
    if (out.some((o) => o.endsWith(d) || d.endsWith(o))) continue;
    out.push(d);
  }
  return out;
}

function isAdminNumber(
  adminNumbers: string[],
  phone: string,
  realPhone: string | null,
): boolean {
  return adminNumbers.some(
    (n) =>
      phone === n ||
      phone.endsWith(n) ||
      (realPhone != null && realPhone.endsWith(n)),
  );
}

// Avisa de un pedido nuevo a cada número de notificación que ya "activó" (es
// decir, que ya le escribió al bot alguna vez — así nunca somos nosotros los
// que iniciamos el chat en frío). Con 2 números el aviso sale de a uno: con
// el texto un poco distinto y una pausa de unos segundos entre los dos, para
// no parecer una difusión del mismo mensaje idéntico a varios destinatarios
// (que es justo lo que los antispam de WhatsApp miran).
async function notifyAdminNumbers(opts: {
  tenantId: number;
  adminNumbers: string[];
  orderId: number;
  customerLabel: string;
  total: number;
  viewToken: string | null;
}): Promise<void> {
  const { tenantId, adminNumbers, orderId, customerLabel, total, viewToken } =
    opts;
  if (adminNumbers.length === 0) return;

  const dashboardUrl =
    process.env.DASHBOARD_URL || process.env.NEXTAUTH_URL || "";
  const base = dashboardUrl.replace(/\/$/, "");
  // Link directo a ESTE pedido (token, sirve sin login — ver
  // src/app/o/[token]/page.tsx); si no hay token, al módulo de pedidos.
  const link = base
    ? viewToken
      ? `${base}/o/${viewToken}`
      : `${base}/?view=orders`
    : "";
  const money = `$${total.toLocaleString("es-CO")}`;
  const variants = [
    `🔔 Nuevo pedido #${orderId}\nCliente: ${customerLabel}\nTotal: ${money}${link ? `\nVer: ${link}` : ""}`,
    `🛎️ Entró el pedido #${orderId} · ${customerLabel}\nTotal: ${money}${link ? `\nDetalle: ${link}` : ""}`,
  ];

  let sentCount = 0;
  for (const [i, num] of adminNumbers.entries()) {
    const adminConvo = findConversationByPhoneSuffix(tenantId, num);
    if (!adminConvo) {
      console.log(
        `[bot:${tenantId}] Número de notificación ${num} sin conversación previa — no se notifica`,
      );
      continue;
    }
    const hasUserMessage = getRecentHistory(adminConvo.id, 50).some(
      (m) => m.role === "user",
    );
    if (!hasUserMessage) {
      console.log(
        `[bot:${tenantId}] Número de notificación ${num} no ha activado (sin mensajes previos)`,
      );
      continue;
    }
    if (sentCount > 0) await humanDelay(4000, 9000);
    const text = variants[i % variants.length];
    const messageId = insertMessage(adminConvo.id, "assistant", text, "pending");
    enqueueOutbox(
      tenantId,
      adminConvo.id,
      adminConvo.phone,
      text,
      adminConvo.jid,
      messageId,
    );
    sentCount++;
    console.log(
      `[bot:${tenantId}] Notificación de pedido #${orderId} encolada para ${num}`,
    );
  }
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
  // Capturar ubicación GPS de WhatsApp
  const loc = m.locationMessage;
  if (loc) {
    const lat = loc.degreesLatitude;
    const lng = loc.degreesLongitude;
    if (lat != null && lng != null) {
      return `Ubicación GPS: https://maps.google.com/?q=${lat},${lng}`;
    }
  }
  const liveLoc = m.liveLocationMessage;
  if (liveLoc) {
    const lat = liveLoc.degreesLatitude;
    const lng = liveLoc.degreesLongitude;
    if (lat != null && lng != null) {
      return `Ubicación GPS: https://maps.google.com/?q=${lat},${lng}`;
    }
  }
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

  // Dedup: memoria (rápido) + SQLite (sobrevive reinicios del proceso, evita
  // que un mensaje re-entregado por WhatsApp tras un reinicio se procese 2 veces)
  if (
    msg.key.id &&
    (isDuplicateMessage(msg.key.id) || isMessageProcessed(msg.key.id))
  ) {
    console.log(`[bot] duplicado msg.id=${msg.key.id}, ignorado`);
    return;
  }
  if (msg.key.id) {
    markMessageProcessed(msg.key.id);
  }

  const phone = jidToPhone(remoteJid);
  const pushName = msg.pushName ?? null;
  let realPhone: string | null = null;

  // Si el JID es un LID, intentar resolver el número real vía lidMapping
  if (remoteJid.endsWith("@lid")) {
    try {
      const lid = remoteJid;
      const repo = (sock as unknown as Record<string, unknown>)
        .signalRepository as
        | {
            lidMapping?: {
              getPNForLID?: (l: string) => Promise<string | null>;
            };
          }
        | undefined;
      const pn = await repo?.lidMapping?.getPNForLID?.(lid);
      if (pn) {
        realPhone = jidToPhone(pn);
        console.log(`[bot:${tenantId}] LID ${phone} resuelto a ${realPhone}`);
      }
    } catch (e) {
      console.warn(`[bot:${tenantId}] No se pudo resolver LID→PN:`, e);
    }
  }

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
  const convo = getOrCreateConversation(
    tenantId,
    phone,
    pushName,
    remoteJid,
    realPhone,
  );

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
        await sendTextWithSafePreview(sock, remoteJid, limitMsg);
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

  // Push a los dispositivos del panel (PC/celular) — no depende de si la
  // conversación está en modo IA o Humano, porque justamente en modo
  // Humano es cuando más falta hace que alguien se entere de que el
  // cliente escribió (bug real encontrado 2026-09-16: una conversación se
  // quedó en modo Humano sin que nadie contestara por una hora). No se
  // espera esta llamada ni se deja que una falla acá frene el flujo del
  // bot — es solo una notificación de cortesía.
  void sendPushToTenant(tenantId, {
    title: `💬 ${pushName || phone}`,
    body: text.length > 120 ? `${text.slice(0, 117)}...` : text,
    tag: `convo-${convo.id}`,
    url: "/?view=chats",
  }).catch((e) => console.error("[bot] Error mandando push:", e));

  // Re-leer por si el toggle cambió entre creación y este punto
  const fresh = getConversationById(convo.id, tenantId);
  if (!fresh || fresh.mode !== "AI") {
    console.log(
      `[bot] Conversación en modo ${fresh?.mode ?? "?"}, no respondo`,
    );
    return;
  }

  // === Check de número de notificaciones del admin (programático, prioridad
  // sobre todo lo demás) — este número no es un cliente, es a donde le
  // llegan los avisos de pedido nuevo. No debe recibir saludo, catálogo, ni
  // el flujo de IA. admin_phone se guarda tal cual lo escribe el dueño en el
  // panel (normalmente SIN indicativo de país, ej. "3217780643"), mientras
  // que "phone"/"realPhone" vienen del JID de WhatsApp CON indicativo (ej.
  // "573217780643") — por eso comparamos por sufijo, no por igualdad exacta.
  const tenant = getTenantById(tenantId);
  const isAdminNotifNumber = isAdminNumber(
    getAdminNumbers(tenant),
    phone,
    realPhone,
  );
  if (isAdminNotifNumber) {
    const adminInfoMsg =
      "📌 Este número está configurado para recibir las notificaciones de pedidos del negocio, no es el chat de atención a clientes.";
    const adminInfoMsgId = insertMessage(convo.id, "assistant", adminInfoMsg, "pending");
    await humanDelay(500, 1200);
    try {
      await sendTracked(sock, remoteJid, adminInfoMsg, adminInfoMsgId);
      console.log(
        `[bot:${tenantId}] → Mensaje informativo enviado al número de notificaciones ${phone}`,
      );
    } catch (e) {
      console.error(
        `[bot] Error enviando mensaje al número de notificaciones:`,
        e,
      );
    }
    return;
  }

  // === Check de bot pausado (programático, sin IA, prioridad sobre horarios) ===
  if (tenant?.bot_paused) {
    const pausedMsg =
      tenant.paused_message ||
      "En este momento no estamos recibiendo pedidos. ¡Gracias por tu paciencia, pronto volvemos!";
    const pausedMsgId = insertMessage(convo.id, "assistant", pausedMsg, "pending");
    await humanDelay(1000, 3000);
    try {
      await sendTracked(sock, remoteJid, pausedMsg, pausedMsgId);
      console.log(`[bot:${tenantId}] → Mensaje de pausa enviado a ${phone}`);
    } catch (e) {
      console.error(`[bot] Error enviando mensaje de pausa:`, e);
    }
    return;
  }

  // === Check de horario de atención (programático, sin IA) ===
  if (tenant) {
    const hours = parseBusinessHours(tenant.business_hours);
    if (hours && hours.enabled && !isWithinBusinessHours(hours)) {
      const oohMsg =
        tenant.out_of_hours_message ||
        "¡Gracias por escribir! En este momento estamos cerrados. Te respondemos en nuestro horario de atención.";
      const oohMsgId = insertMessage(convo.id, "assistant", oohMsg, "pending");
      await humanDelay(1000, 3000);
      try {
        await sendTracked(sock, remoteJid, oohMsg, oohMsgId);
        console.log(`[bot] → Mensaje fuera de horario enviado a ${phone}`);
      } catch (e) {
        console.error(`[bot] Error enviando mensaje fuera de horario:`, e);
      }
      return;
    }
  }

  // === Saludo en primera interacción (programático, sin IA) ===
  const historyLimit = Math.min(
    Math.max(parseInt(process.env.LLM_HISTORY_MESSAGES || "10", 10) || 10, 4),
    15,
  );
  const history = getRecentHistory(convo.id, historyLimit);
  const isFirstMessage = history.length === 1;

  // Si hay saludo personalizado, enviarlo y no llamar al LLM
  if (isFirstMessage && tenant?.custom_greeting) {
    const greeting = tenant.custom_greeting;
    const greetingId = insertMessage(convo.id, "assistant", greeting, "pending");
    try {
      await sendTracked(sock, remoteJid, greeting, greetingId);
      console.log(`[bot] → Saludo personalizado enviado a ${phone}`);
    } catch (e) {
      console.error(`[bot] Error enviando saludo:`, e);
    }

    // Enviar catálogo después del saludo
    const linksMsg = buildLinksMessage(tenantId);
    if (linksMsg) {
      await humanDelay(500, 1500);
      const linksMsgId = insertMessage(convo.id, "assistant", linksMsg, "pending");
      try {
        await sendTracked(sock, remoteJid, linksMsg, linksMsgId);
        console.log(`[bot] → Catálogo enviado a ${phone}`);
      } catch (e) {
        console.error(`[bot] Error enviando catálogo:`, e);
      }
    }
    return; // No llamar al LLM, ya respondimos programáticamente
  }
  // Si no hay saludo personalizado, el LLM responde primero
  // y el catálogo se envía después de la respuesta del LLM

  // Verificar presupuesto de IA antes de llamar al LLM
  const budget = getLLMBudgetStatus(tenantId);
  if (budget.exceeded) {
    console.warn(`[bot:${tenantId}] Presupuesto IA excedido: ${budget.reason}`);
    const budgetMsg =
      "En este momento te atenderá una persona del equipo. ¡Gracias por tu paciencia!";
    const budgetMsgId = insertMessage(convo.id, "assistant", budgetMsg, "pending");
    try {
      await sendTracked(sock, remoteJid, budgetMsg, budgetMsgId);
    } catch (e) {
      console.error("[bot] Error enviando mensaje de presupuesto:", e);
    }
    return;
  }

  // === Cargar estado de conversación ===
  const convState = getStateForConversation(convo.id, tenantId);
  console.log(
    `[bot:${tenantId}] Estado conversación: ${convState.state}, items=${convState.draft_items.length}, delivery=${convState.draft_delivery_method ?? "no"}, addr=${convState.draft_address ? "sí" : "no"}, pay=${convState.draft_payment ?? "no"}`,
  );

  // Detectar cancelación explícita
  if (isCancellation(text)) {
    resetState(convo.id);
    convState.draft_items = [];
    convState.draft_delivery_method = null;
    convState.draft_address = null;
    convState.draft_payment = null;
    convState.draft_delivery_price = null;
    convState.state = "SELECTING_PRODUCTS";
    console.log(`[bot:${tenantId}] Cliente canceló, estado reseteado`);
  }

  // === Debounce: si ya hay un debounce pendiente para esta conversación,
  // este mensaje ya está en BD (insertMessage arriba) pero no llamamos al LLM.
  // El primer mensaje espera 4s y luego llama al LLM con todo el historial. ===
  if (hasPendingDebounce(tenantId, convo.id)) {
    console.log(
      `[bot:${tenantId}] Mensaje acumulado en debounce para ${phone}, esperando flush`,
    );
    return;
  }

  // Esperar a que lleguen más mensajes (debounce)
  await debounceMessage(tenantId, convo.id, text);
  console.log(
    `[bot:${tenantId}] Debounce completado para ${phone}, llamando LLM`,
  );

  // Mostrar "escribiendo..." mientras se procesa — es una función nativa
  // de WhatsApp (no un truco), pensada exactamente para esto. Ayuda a que
  // la espera se sienta como alguien redactando, no como silencio seguido
  // de un mensaje instantáneo (que sí es un patrón que delata un bot). El
  // indicador se borra solo cuando llega el mensaje real, no hace falta
  // "apagarlo" a mano.
  try {
    await sock.sendPresenceUpdate("composing", remoteJid);
  } catch (e) {
    console.warn(`[bot:${tenantId}] No se pudo mandar presencia "escribiendo":`, e);
  }

  // Re-leer historial actualizado (incluye mensajes acumulados durante debounce)
  const freshHistory = getRecentHistory(convo.id, historyLimit);

  console.log(`[bot] llamando LLM con ${freshHistory.length} mensajes...`);
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

  // Adquirir slot de concurrencia LLM (máx 2 por tenant, 8 global)
  const llmSlot = await acquireLLMSlot(tenantId);
  try {
    const result = await generateReply(freshHistory, tenantId, {
      customerPhone: phone,
      customerName: pushName,
      conversationState: convState,
      conversationId: convo.id,
      tenantId,
      lastCustomerMessage: text,
    });
    llmResponse = result.response;
    usage = result.usage;

    // Si el LLM confirmó el pedido via tool, enviar confirmación + notificar admin
    if (result.orderConfirmed && result.confirmedOrderId) {
      // BUG real encontrado (2026-09-17): calcular el total desde
      // convState acá se veía bien en teoría, pero para este punto del
      // código confirmOrder YA vació el draft (items, precio de domicilio)
      // dentro de generateReply, antes de que este bloque se ejecute — el
      // mismo objeto de estado, ya limpio. Eso daba subtotal=0 y
      // deliveryPrice caía al fallback fijo del tenant (ej. $5.000),
      // colando ese número en la notificación al admin y en el push —
      // pasó justo con el pedido #60 (total real $43.100, notificación
      // mostró $5.000). La fuente de verdad real es la orden ya creada en
      // la BD, no el draft (que para esto ya es historia vieja).
      const confirmedOrder = getOrderById(tenantId, result.confirmedOrderId);
      const total = confirmedOrder?.total_amount ?? 0;
      const paymentInfo = tenant?.payment_info || "";
      let confirmMsg: string;
      if (convState.draft_payment === "efectivo") {
        confirmMsg = `¡Pedido confirmado! 🎉\n\nTotal: $${total.toLocaleString("es-CO")}\n\nPago en efectivo. Tenga listo el monto exacto para la entrega 😋\n\n¿Algo más en lo que le pueda ayudar?`;
      } else {
        confirmMsg = `¡Pedido confirmado! 🎉\n\nTotal: $${total.toLocaleString("es-CO")}\n\n${paymentInfo}\n\nMándeme el comprobante cuando transfiera y le aviso cuando esté listo 😋`;
      }

      // Enviar confirmación si el LLM no la incluyó en su reply
      const replyLower = llmResponse.reply.toLowerCase();
      if (
        !replyLower.includes("confirmado") &&
        !replyLower.includes("pedido #")
      ) {
        const confirmMsgId = insertMessage(convo.id, "assistant", confirmMsg, "pending");
        await humanDelay(1000, 3000);
        try {
          await sendTracked(sock, remoteJid, confirmMsg, confirmMsgId);
          console.log(`[bot] → Confirmación de pedido enviada a ${phone}`);
        } catch (e) {
          console.error(`[bot] Error enviando confirmación:`, e);
        }
      }

      // Notificar a los números de notificación (máx. 2) — solo a los que ya
      // escribieron primero. No se espera acá: el segundo aviso sale con una
      // pausa de unos segundos (ver notifyAdminNumbers) y no debe retrasar el
      // resto del flujo del pedido.
      void notifyAdminNumbers({
        tenantId,
        adminNumbers: getAdminNumbers(tenant),
        orderId: result.confirmedOrderId,
        customerLabel: String(pushName || phone),
        total,
        viewToken: confirmedOrder?.view_token ?? null,
      }).catch((notifErr) =>
        console.error(
          `[bot:${tenantId}] Error notificando a los números de notificación:`,
          notifErr,
        ),
      );

      // Push del pedido nuevo a los dispositivos del panel — a diferencia
      // del aviso por WhatsApp, este no depende de admin_phone ni de haber
      // "activado" nada: cualquiera que tenga el panel abierto y haya
      // aceptado notificaciones en ese dispositivo se entera.
      void sendPushToTenant(tenantId, {
        title: `🔔 Nuevo pedido #${result.confirmedOrderId}`,
        body: `${pushName || phone} — $${total.toLocaleString("es-CO")}`,
        tag: `order-${result.confirmedOrderId}`,
        url: "/?view=orders",
      }).catch((e) => console.error("[bot] Error mandando push de pedido:", e));

      // Limpiar estado
      resetState(convo.id);
    }
  } catch (err) {
    llmSlot.release();
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
    const fallbackMsgId = insertMessage(convo.id, "assistant", fallbackMsg, "pending");
    try {
      await sendTracked(sock, remoteJid, fallbackMsg, fallbackMsgId);
    } catch (e) {
      console.error("[bot] Error enviando mensaje de fallback:", e);
    }
    return;
  }
  llmSlot.release();
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

  // SAFETY NET: si el LLM dice "anotad"/"agregad" pero el draft está vacío,
  // el LLM no llamó addItem. Extraer productos del mensaje del usuario y agregarlos.
  const replyLower = llmResponse.reply.toLowerCase();
  const freshState = getStateForConversation(convo.id, tenantId);
  if (
    freshState.draft_items.length === 0 &&
    (replyLower.includes("anotad") ||
      replyLower.includes("agregad") ||
      replyLower.includes("añadid"))
  ) {
    console.warn(
      `[bot:${tenantId}] LLM dijo "anotado" pero draft vacío — safety net activado`,
    );
    const result = tryAddProductsFromText(freshState, text);
    if (result.added) {
      computeStateFromDraft(freshState);
      saveState(freshState);
      const itemsList = result.products
        .map((p) => `- ${p.quantity}x ${p.name}`)
        .join("\n");
      llmResponse.reply = `¡Listo! Anotadas:\n${itemsList}\n\n¿Quiere algo más?`;
      console.log(
        `[bot:${tenantId}] Safety net agregó: ${result.products.map((p) => `${p.quantity}x ${p.name}`).join(", ")}`,
      );
    }
  }

  // SAFETY NET: si el LLM dice "no tenemos X" sin haber llamado tools,
  // buscar el producto en la BD y corregir la respuesta si existe.
  if (
    replyLower.includes("no tenemos") ||
    replyLower.includes("no hay") ||
    replyLower.includes("no contamos con")
  ) {
    const noTenemosMatch = llmResponse.reply.match(
      /no (?:tenemos|hay|contamos con)\s+([^.,\n]+)/i,
    );
    if (noTenemosMatch) {
      const productName = noTenemosMatch[1].trim();
      const results = searchProducts(tenantId, productName, 3);
      if (results.length > 0) {
        console.warn(
          `[bot:${tenantId}] Safety net: LLM dijo "no tenemos ${productName}" pero SÍ existe — corrigiendo`,
        );
        const found = results[0];
        if (found.stock > 0) {
          llmResponse.reply = `¡Sí lo tenemos! ${found.name} a $${found.price.toLocaleString("es-CO")}. ¿Le anoto alguno?`;
        } else {
          llmResponse.reply = `Sí tenemos ${found.name} ($${found.price.toLocaleString("es-CO")}), pero momentaneamente sin stock. ¿Le ofrezco algo más?`;
        }
      }
    }
  }

  // SAFETY NET: si el LLM lista productos de memoria (menciona 3+ productos
  // con precios o guiones) pero no envió el catálogo, reemplazar con catálogo.
  const catalogUrl = tenant?.catalog_url || "";
  if (
    catalogUrl &&
    !replyLower.includes(catalogUrl.toLowerCase()) &&
    !replyLower.includes("catálogo") &&
    !replyLower.includes("catalogo")
  ) {
    // Detectar listas de productos: líneas con guión, o líneas con producto + precio
    const bulletMatches = llmResponse.reply.match(/^- .+/gm);
    const priceMatches = llmResponse.reply.match(/\$[\d.,]+/g);
    const productCount = Math.max(
      bulletMatches?.length ?? 0,
      priceMatches?.length ?? 0,
    );
    // Detectar más variaciones de "qué tienes / qué hay / muéstrame el menú"
    const asksForMenu =
      /qué tienen|que tienen|qué hay|que hay|menú|menu|catálogo|catalogo|ver.*producto|qué venden|que venden|qué ofrecen|que ofrecen|tienes.*fresco|tienes.*dulce|tienes.*salado|muéstrame|muestrame|cuáles son|cuales son|lista de|ver la lista/i.test(
        text,
      );
    if (asksForMenu && productCount >= 3) {
      console.warn(
        `[bot:${tenantId}] Safety net: LLM listó ${productCount} productos de memoria en vez de enviar catálogo — corrigiendo`,
      );
      llmResponse.reply = `Le dejo el catálogo para que le eche un ojo 👇\n${catalogUrl}`;
    }
  }

  // Anti-bucle: si el LLM repite exactamente su mensaje anterior, redirigir
  // según el dato pendiente del draft (última línea de defensa)
  const lastAssistantMsg = [...history]
    .reverse()
    .find((m) => m.role === "assistant")?.content;
  if (
    lastAssistantMsg &&
    llmResponse.reply.trim() === lastAssistantMsg.trim()
  ) {
    console.warn(
      `[bot:${tenantId}] LLM repitió su mensaje anterior, redirigiendo`,
    );
    // Releer estado actualizado (los tools pueden haberlo cambiado)
    const freshState = getStateForConversation(convo.id, tenantId);
    if (freshState.draft_items.length === 0) {
      llmResponse.reply = "¿Qué le gustaría pedir?";
    } else if (!freshState.draft_delivery_method) {
      llmResponse.reply = "¿Es para domicilio o lo recoge en tienda?";
    } else if (
      freshState.draft_delivery_method === "domicilio" &&
      !freshState.draft_address
    ) {
      llmResponse.reply = "¿Cuál es el barrio y la dirección de entrega?";
    } else if (!freshState.draft_payment) {
      llmResponse.reply = "¿Transferencia o efectivo?";
    } else {
      const subtotal = computeDraftTotal(freshState.draft_items);
      const deliveryPrice = freshState.draft_delivery_price ?? 0;
      const total = subtotal + deliveryPrice;
      llmResponse.reply = `Total: $${total.toLocaleString("es-CO")}. ¿Confirma el pedido?`;
    }
  }

  // PEDIDO real del negocio (2026-09-15): la pregunta "¿Confirma el
  // pedido?" venía pegada al final del resumen largo — mucha gente no lee
  // bloques de texto completos y se salta justo la parte donde le están
  // preguntando algo. Separarla en su propio mensaje hace que salte a la
  // vista que el bot está esperando una respuesta, como haría una persona
  // real (manda el resumen, y en un mensaje aparte pregunta "¿confirmas?").
  const CONFIRM_SUFFIX = /\s*¿Confirma el pedido\?\s*$/;
  let confirmFollowUp: string | null = null;
  if (CONFIRM_SUFFIX.test(llmResponse.reply)) {
    llmResponse.reply = llmResponse.reply.replace(CONFIRM_SUFFIX, "");
    confirmFollowUp = CONFIRM_FOLLOWUP_TEXT;
    // BUG real encontrado (2026-09-17): a veces el LLM responde SOLO con
    // "¿Confirma el pedido?" — sin ningún resumen antes. Después de
    // recortar esa frase, llmResponse.reply quedaba vacío, pero igual se
    // insertaba y se intentaba mandar por WhatsApp un mensaje vacío (el
    // cliente veía la pregunta de confirmación sin haber visto nunca el
    // resumen). En vez de confiar en que el LLM lo redacte bien, si queda
    // vacío reconstruimos el resumen nosotros mismos con los datos reales
    // del pedido — mismo patrón que ya usamos en computeNextStep.
    if (!llmResponse.reply.trim() && convState) {
      llmResponse.reply = buildOrderSummaryForCustomer(convState);
    }
  }

  // Si después de todo eso sigue vacío (no debería pasar, pero por las
  // dudas), no insertamos ni mandamos un mensaje en blanco — dejamos que
  // solo salga el confirmFollowUp si lo hay.
  if (llmResponse.reply.trim()) {
    const replyMsgId = insertMessage(
      convo.id,
      "assistant",
      llmResponse.reply,
      "pending",
    );

    // Delay aleatorio 1-3s para parecer más humano y evitar detección
    await humanDelay(1000, 3000);
    console.log(`[bot] Enviando respuesta LLM a ${phone}...`);

    try {
      await sendTracked(sock, remoteJid, llmResponse.reply, replyMsgId);
      console.log(`[bot] → Enviado a ${phone}`);
    } catch (err) {
      console.error(`[bot] Error enviando a ${phone}:`, err);
    }
  } else {
    console.warn(
      `[bot:${tenantId}] Respuesta del LLM quedó vacía tras recortar el sufijo de confirmación y no había estado de conversación para reconstruir el resumen — se omite ese mensaje.`,
    );
  }

  if (confirmFollowUp) {
    await humanDelay(700, 1500);
    try {
      const confirmId = insertMessage(
        convo.id,
        "assistant",
        confirmFollowUp,
        "pending",
      );
      await sendTracked(sock, remoteJid, confirmFollowUp, confirmId);
      console.log(`[bot] → Pregunta de confirmación enviada a ${phone}`);
    } catch (err) {
      console.error(`[bot] Error enviando confirmación a ${phone}:`, err);
    }
  }

  // Si es primera interacción y no hubo saludo programático,
  // enviar el catálogo instantáneamente después de la respuesta del LLM
  if (isFirstMessage && !tenant?.custom_greeting) {
    const linksMsg = buildLinksMessage(tenantId);
    const catalogUrl = tenant?.catalog_url || "";
    const llmAlreadySentCatalog =
      catalogUrl && llmResponse.reply.includes(catalogUrl);
    if (linksMsg && !llmAlreadySentCatalog) {
      await humanDelay(500, 1500);
      try {
        const catalogMsgId = insertMessage(
          convo.id,
          "assistant",
          linksMsg,
          "pending",
        );
        await sendTracked(sock, remoteJid, linksMsg, catalogMsgId);
        console.log(`[bot] → Catálogo enviado a ${phone}`);
      } catch (err) {
        console.error(`[bot] Error enviando catálogo a ${phone}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outbox (mensajes humanos desde el dashboard)
// ---------------------------------------------------------------------------

// Un mensaje de la cola que lleva más de esto sin poder salir se descarta en
// vez de mandarlo tarde: llegar 2 horas después ("ya sale para allá" cuando
// el pedido ya llegó) confunde más que no llegar, y tras una caída larga de
// WhatsApp se soltaba todo el atraso de golpe. El mensaje queda marcado "no
// enviado" en el dashboard para que el dueño lo sepa.
const OUTBOX_MAX_AGE_SEC = 10 * 60;

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
  const nowSec = Math.floor(Date.now() / 1000);
  for (const item of pending) {
    if (nowSec - item.created_at > OUTBOX_MAX_AGE_SEC) {
      markOutboxExpired(item.id);
      if (item.message_id) markMessageFailed(item.message_id);
      console.warn(
        `[bot] Outbox #${item.id} vencido (más de ${OUTBOX_MAX_AGE_SEC / 60} min sin poder salir) — se descarta, no se manda tarde`,
      );
      continue;
    }
    // Preferir el remote_jid guardado (soporta @lid). Fallback a
    // construirlo desde el phone para outbox legacy.
    const jid = item.remote_jid ?? `${item.phone}@s.whatsapp.net`;
    try {
      const waId = await sendTextWithSafePreview(sock, jid, item.content);
      markOutboxSent(item.id);
      if (item.message_id) markMessageSent(item.message_id, waId);
      console.log(`[bot] → Outbox #${item.id} enviado a ${jid}`);
    } catch (err) {
      console.error(
        `[bot] Error enviando outbox #${item.id} a ${item.phone}:`,
        (err as Error).message ?? err,
      );
      // Dejar sent=0 → reintenta en próximo tick (hasta que venza)
    }
  }
}

// ---------------------------------------------------------------------------
// Recordatorio de confirmación
// ---------------------------------------------------------------------------

// Pedido real del negocio (2026-09-18): 2 de 3 clientes se quedaron sin
// confirmar tras recibir el resumen — a veces la gente da por hecho que ya
// quedó. Si pasan 2 minutos sin respuesta después de "¿Confirmas...?", el
// bot manda UN solo recordatorio amable. No corre para conversaciones más
// viejas que 30 min (si el cliente ya se fue, insistir es peor).
const CONFIRM_REMINDER_AFTER_SEC = 120;
const CONFIRM_REMINDER_MAX_AGE_SEC = 30 * 60;
const CONFIRM_REMINDER_TEXT =
  "Para poder agendar tu pedido necesito que me confirmes que todo está correcto 😊 Quedo atento.";

export async function processConfirmReminders(
  tenantId: number,
  sock: WASocket,
  onlyConversationId?: number, // solo para pruebas
): Promise<void> {
  if (!sock.user) return;
  const tenant = getTenantById(tenantId);
  if (!tenant || tenant.bot_paused) return;

  const candidates = getConfirmReminderCandidates(
    tenantId,
    CONFIRM_FOLLOWUP_TEXT,
    CONFIRM_REMINDER_AFTER_SEC,
    CONFIRM_REMINDER_MAX_AGE_SEC,
  ).filter((c) => onlyConversationId == null || c.id === onlyConversationId);

  for (const c of candidates) {
    const jid = c.jid ?? `${c.phone}@s.whatsapp.net`;
    // Se inserta ANTES de mandar: así el último mensaje de la conversación
    // deja de ser la pregunta y no vuelve a calzar en el próximo barrido
    // (un solo recordatorio por resumen, aunque el envío falle).
    const messageId = insertMessage(
      c.id,
      "assistant",
      CONFIRM_REMINDER_TEXT,
      "pending",
    );
    try {
      await sendTracked(sock, jid, CONFIRM_REMINDER_TEXT, messageId);
      console.log(
        `[bot:${tenantId}] → Recordatorio de confirmación enviado (conversación ${c.id})`,
      );
    } catch (err) {
      console.error(
        `[bot:${tenantId}] Error enviando recordatorio de confirmación (conv ${c.id}):`,
        (err as Error).message ?? err,
      );
    }
    await humanDelay(1500, 4000);
  }
}
