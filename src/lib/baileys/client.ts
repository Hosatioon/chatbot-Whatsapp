import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import path from "node:path";
import fs from "node:fs";
import { setConnectionState, getConnectionState } from "../db";
import { handleIncomingMessages, processOutbox } from "./handler";

const AUTH_DIR = path.resolve(process.cwd(), "auth");

export interface BaileysHandle {
  sock: WASocket;
  shutdown: () => Promise<void>;
}

let handle: BaileysHandle | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let outboxTimer: NodeJS.Timeout | null = null;

const logger = pino({ level: "silent" });

// Timestamp (en segundos UNIX) de arranque del proceso. Sólo procesamos
// mensajes con messageTimestamp >= este valor para evitar responder a
// historial viejo cuando WhatsApp empuja mensajes acumulados como 'append'.
const BOT_START_TS = Math.floor(Date.now() / 1000);

function extractPhoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null;
  // formato: 5491155...:N@s.whatsapp.net  o  5491155...@s.whatsapp.net
  const at = jid.indexOf("@");
  const base = at >= 0 ? jid.slice(0, at) : jid;
  const colon = base.indexOf(":");
  return colon >= 0 ? base.slice(0, colon) : base;
}

async function start(): Promise<void> {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  // 1. Versión actualizada (evita code 405)
  let version: [number, number, number] | undefined;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
    console.log(`[bot] Baileys version: ${version.join(".")}`);
  } catch (err) {
    console.warn("[bot] No se pudo obtener última versión de Baileys:", err);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS("Desktop"), // fingerprint conocido (evita code 440)
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  handle = {
    sock,
    shutdown: async () => {
      // Importante: NO llamar a sock.logout() aquí. logout() invalida la
      // sesión del lado de WhatsApp, lo que obliga a escanear un QR nuevo
      // en el próximo arranque. Sólo cerramos el socket localmente para
      // que el proceso pueda terminar limpio. La sesión queda viva en
      // auth/ y reconecta sin QR. (Para "desvincular" de verdad usamos
      // el flag de reset que borra auth/ — ver start-bot.ts.)
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
    },
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("[bot] QR recibido. Escanealo desde http://localhost:3000");
      qrcodeTerminal.generate(qr, { small: true });
      setConnectionState({ status: "qr", qr_string: qr, phone: null });
    }

    if (connection === "connecting") {
      const current = getConnectionState();
      // Sólo degradar a 'connecting' si veníamos de 'disconnected'.
      // No pisar 'qr' ni 'connected'.
      if (current.status === "disconnected") {
        setConnectionState({ status: "connecting" });
      }
    }

    if (connection === "open") {
      const phone = extractPhoneFromJid(sock.user?.id);
      console.log(`[bot] Conectado como ${phone ?? "(sin id)"}`);
      setConnectionState({
        status: "connected",
        qr_string: null,
        phone,
      });
    }

    if (connection === "close") {
      const boom = lastDisconnect?.error as Boom | undefined;
      const code =
        boom?.output?.statusCode ??
        (lastDisconnect?.error as { code?: number } | undefined)?.code;
      console.log(`[bot] Conexión cerrada. code=${code}`);

      if (code === DisconnectReason.loggedOut) {
        // 401: el usuario cerró sesión desde el teléfono. Reset total.
        console.log("[bot] Sesión cerrada por el usuario. Borrando auth/...");
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (err) {
          console.warn("[bot] No se pudo borrar auth/:", err);
        }
        setConnectionState({
          status: "disconnected",
          qr_string: null,
          phone: null,
        });
        // No reconectamos automáticamente — esperamos acción del usuario.
        return;
      }

      // Cualquier otro código: reconectar sin tocar el status de la DB.
      // Si el dashboard estaba 'connected', queda 'connected' mientras
      // el bot reconecta transparentemente. Si necesita QR nuevo, el
      // evento 'qr' va a sobreescribir.
      scheduleReconnect(typeof code === "number" ? code : undefined);
    }
  });

  sock.ev.on("messages.upsert", async (event) => {
    // 'notify' = push en vivo. 'append' = mensajes que llegaron mientras
    // el socket estaba caído (post-reconnect). Aceptamos ambos.
    // 'prepend' (carga de historial viejo) lo ignoramos.
    if (event.type !== "notify" && event.type !== "append") {
      console.log(
        `[bot] messages.upsert ignorado (type=${event.type}, count=${event.messages.length})`,
      );
      return;
    }

    // Filtrar mensajes anteriores al arranque: no contestamos historial.
    const fresh = event.messages.filter((m) => {
      const ts = Number(m.messageTimestamp ?? 0);
      return ts >= BOT_START_TS;
    });

    console.log(
      `[bot] messages.upsert type=${event.type} total=${event.messages.length} frescos=${fresh.length}`,
    );

    if (fresh.length === 0) return;

    try {
      await handleIncomingMessages(sock, fresh);
    } catch (err) {
      console.error("[bot] Error procesando mensajes entrantes:", err);
    }
  });

  // Loop del outbox (mensajes humanos enviados desde el dashboard)
  if (!outboxTimer) {
    outboxTimer = setInterval(() => {
      void processOutbox(sock).catch((err) =>
        console.error("[bot] Error procesando outbox:", err),
      );
    }, 2000);
  }
}

function scheduleReconnect(code?: number): void {
  if (reconnectTimer) return;
  // code 440 = connectionReplaced. Necesita backoff más largo o entra en loop.
  const delay = code === 440 ? 15000 : 5000;
  console.log(`[bot] Reintentando en ${delay / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (handle) {
      try {
        handle.sock.end(undefined);
      } catch {
        /* ignore */
      }
      handle = null;
    }
    void start().catch((err: unknown) => {
      console.error("[bot] Error reiniciando socket:", err);
      scheduleReconnect();
    });
  }, delay);
}

export async function startBaileys(): Promise<void> {
  await start();
}

export function getHandle(): BaileysHandle | null {
  return handle;
}

export async function shutdownBaileys(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
  if (handle) {
    await handle.shutdown();
    handle = null;
  }
}
