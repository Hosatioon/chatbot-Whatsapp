import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import {
  getConversationById,
  getOrCreateConversation,
  getPendingOutbox,
  getRecentHistory,
  insertMessage,
  markOutboxSent,
} from "../db";
import { generateReply } from "../openrouter";

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
  sock: WASocket,
  messages: WAMessage[],
): Promise<void> {
  for (const msg of messages) {
    try {
      await handleSingleMessage(sock, msg);
    } catch (err) {
      console.error("[bot] Error en mensaje individual:", err);
    }
  }
}

async function handleSingleMessage(
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

  // Guardamos el JID completo (puede ser @s.whatsapp.net o @lid). Es lo
  // único que nos permite responder a contactos con Linked ID, donde el
  // "phone" guardado no se puede convertir a un JID público válido.
  const convo = getOrCreateConversation(phone, pushName, remoteJid);
  console.log(`[bot] ← Mensaje de ${pushName ?? phone}: "${text}"`);
  insertMessage(convo.id, "user", text);

  // Re-leer por si el toggle cambió entre creación y este punto
  const fresh = getConversationById(convo.id);
  if (!fresh || fresh.mode !== "AI") {
    console.log(
      `[bot] Conversación en modo ${fresh?.mode ?? "?"}, no respondo`,
    );
    return;
  }

  const history = getRecentHistory(convo.id, 20);
  console.log(`[bot] llamando LLM con ${history.length} mensajes...`);
  const t0 = Date.now();
  let reply: string;
  try {
    reply = await generateReply(history);
  } catch (err) {
    console.error("[bot] Error llamando al LLM:", err);
    return;
  }
  console.log(`[bot] LLM respondió en ${Date.now() - t0}ms`);

  insertMessage(convo.id, "assistant", reply);

  try {
    await sock.sendMessage(remoteJid, { text: reply });
    console.log(`[bot] → Enviado a ${phone}`);
  } catch (err) {
    console.error(`[bot] Error enviando a ${phone}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Outbox (mensajes humanos desde el dashboard)
// ---------------------------------------------------------------------------

export async function processOutbox(sock: WASocket): Promise<void> {
  // No intentar enviar si el socket aún no está autenticado/abierto.
  // Sin esto el loop spam-falla con errores 428 "Connection Closed"
  // mientras el bot está reconectando o esperando QR.
  if (!sock.user) return;

  const pending = getPendingOutbox(20);
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
