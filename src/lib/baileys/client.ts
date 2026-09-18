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
import { setConnectionState, getConnectionState, getTenantById } from "../db";
import { handleIncomingMessages, processOutbox } from "./handler";

const AUTH_ROOT = path.resolve(process.cwd(), "auth");

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

async function sendDisconnectionAlert(
  tenantId: number,
  reason: string,
): Promise<void> {
  if (!ALERT_WEBHOOK_URL) return;
  const tenant = getTenantById(tenantId);
  const tenantName =
    tenant?.business_name || tenant?.name || `Tenant #${tenantId}`;
  const payload = {
    embeds: [
      {
        title: "⚠️ Bot desconectado",
        description: `**${tenantName}** (ID: ${tenantId}) se desconectó`,
        fields: [
          { name: "Razón", value: reason, inline: false },
          { name: "Dashboard", value: `${APP_URL}`, inline: false },
        ],
        color: 16711680,
        timestamp: new Date().toISOString(),
      },
    ],
  };
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(`[bot:${tenantId}] No se pudo enviar alerta:`, err);
  }
}

function authDirFor(tenantId: number): string {
  return path.join(AUTH_ROOT, String(tenantId));
}

export interface BaileysHandle {
  tenantId: number;
  sock: WASocket;
  shutdown: () => Promise<void>;
  logout: () => Promise<void>;
}

interface TenantState {
  handle: BaileysHandle | null;
  reconnectTimer: NodeJS.Timeout | null;
  outboxTimer: NodeJS.Timeout | null;
  startTs: number;
  reconnectCount: number;
  qrTimer: NodeJS.Timeout | null;
  qrGeneratedAt: number | null;
  rapidCloseCount: number;
  lastConnectTs: number | null;
}

const tenants = new Map<number, TenantState>();

function getOrCreateState(tenantId: number): TenantState {
  let s = tenants.get(tenantId);
  if (!s) {
    s = {
      handle: null,
      reconnectTimer: null,
      outboxTimer: null,
      startTs: Math.floor(Date.now() / 1000),
      reconnectCount: 0,
      qrTimer: null,
      qrGeneratedAt: null,
      rapidCloseCount: 0,
      lastConnectTs: null,
    };
    tenants.set(tenantId, s);
  }
  return s;
}

const logger = pino({ level: "silent" });

function extractPhoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null;
  // formato: 5491155...:N@s.whatsapp.net  o  5491155...@s.whatsapp.net
  const at = jid.indexOf("@");
  const base = at >= 0 ? jid.slice(0, at) : jid;
  const colon = base.indexOf(":");
  return colon >= 0 ? base.slice(0, colon) : base;
}

async function start(tenantId: number): Promise<void> {
  const state = getOrCreateState(tenantId);
  const authDir = authDirFor(tenantId);

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // 1. Versión actualizada (evita code 405)
  let version: [number, number, number] | undefined;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
    console.log(`[bot:${tenantId}] Baileys version: ${version.join(".")}`);
  } catch (err) {
    console.warn(
      `[bot:${tenantId}] No se pudo obtener última versión de Baileys:`,
      err,
    );
  }

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    version,
    auth: authState,
    logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  state.handle = {
    tenantId,
    sock,
    shutdown: async () => {
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
    },
    logout: async () => {
      try {
        await sock.logout();
      } catch {
        /* ignore */
      }
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
      // No generar QR nuevo si ya estamos conectados
      const current = getConnectionState(tenantId);
      if (current.status === "connected") {
        console.log(
          `[bot:${tenantId}] QR recibido pero ya conectado, ignorando`,
        );
        return;
      }

      console.log(
        `[bot:${tenantId}] QR recibido. Escanealo desde http://localhost:3000`,
      );
      qrcodeTerminal.generate(qr, { small: true });
      setConnectionState(tenantId, {
        status: "qr",
        qr_string: qr,
        phone: null,
      });
      state.qrGeneratedAt = Date.now();

      // Limpiar timer anterior si existe
      if (state.qrTimer) clearTimeout(state.qrTimer);

      // QR expira en ~60s. Si no se escanea, forzar reconexión para generar uno nuevo
      state.qrTimer = setTimeout(() => {
        const stillQr = getConnectionState(tenantId);
        if (stillQr.status === "qr") {
          console.log(
            `[bot:${tenantId}] QR expiró (60s sin escaneo). Reconectando...`,
          );
          state.qrTimer = null;
          state.qrGeneratedAt = null;
          try {
            sock.end(undefined);
          } catch {
            /* ignore */
          }
          state.handle = null;
          scheduleReconnect(tenantId);
        }
      }, 60000);
    }

    if (connection === "connecting") {
      const current = getConnectionState(tenantId);
      if (current.status === "disconnected") {
        setConnectionState(tenantId, { status: "connecting" });
      }
    }

    if (connection === "open") {
      const phone = extractPhoneFromJid(sock.user?.id);
      console.log(`[bot:${tenantId}] Conectado como ${phone ?? "(sin id)"}`);
      state.reconnectCount = 0; // reset al conectar exitosamente
      state.lastConnectTs = Date.now();
      // Limpiar timer de QR si estaba activo
      if (state.qrTimer) {
        clearTimeout(state.qrTimer);
        state.qrTimer = null;
      }
      state.qrGeneratedAt = null;
      setConnectionState(tenantId, {
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
      console.log(`[bot:${tenantId}] Conexión cerrada. code=${code}`);

      // Detectar bucle de reconexión: si conectó y se cerró en menos de 10s
      if (state.lastConnectTs && Date.now() - state.lastConnectTs < 10000) {
        state.rapidCloseCount++;
        console.warn(
          `[bot:${tenantId}] Cierre rápido detectado (${state.rapidCloseCount}/5). Sesión posiblemente corrupta.`,
        );
      } else {
        state.rapidCloseCount = 0;
      }

      // Si hay 5 cierres rápidos seguidos, borrar sesión y detener reconexión
      if (state.rapidCloseCount >= 5) {
        console.error(
          `[bot:${tenantId}] Bucle de reconexión detectado. Borrando sesión y deteniendo.`,
        );
        state.rapidCloseCount = 0;
        state.lastConnectTs = null;
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (err) {
          console.warn(`[bot:${tenantId}] No se pudo borrar auth/:`, err);
        }
        setConnectionState(tenantId, {
          status: "disconnected",
          qr_string: null,
          phone: null,
        });
        return;
      }

      if (code === DisconnectReason.loggedOut) {
        console.log(
          `[bot:${tenantId}] Sesión cerrada por el usuario. Borrando auth/${tenantId}/...`,
        );
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (err) {
          console.warn(
            `[bot:${tenantId}] No se pudo borrar auth/${tenantId}/:`,
            err,
          );
        }
        setConnectionState(tenantId, {
          status: "disconnected",
          qr_string: null,
          phone: null,
        });
        return;
      }

      // BUG real encontrado (2026-09-11): esto mandaba la alerta en CADA
      // cierre de conexión, incluyendo los reconectes normales/transitorios
      // que pasan todo el tiempo (se ve en los logs constantemente) — con
      // el webhook configurado, eso sería un diluvio de alertas por cosas
      // que se resuelven solas en segundos, no algo que de verdad necesite
      // que el asesor haga algo. La alerta ahora se manda solo cuando de
      // verdad se agotan los reintentos (ver scheduleReconnect) — ahí sí
      // es una señal real de que hay que revisar ese tenant.
      const reasonText =
        code === DisconnectReason.connectionClosed
          ? "Conexión cerrada por WhatsApp"
          : code === DisconnectReason.connectionLost
            ? "Conexión perdida"
            : code === DisconnectReason.timedOut
              ? "Timeout de conexión"
              : `Código ${code}`;

      scheduleReconnect(
        tenantId,
        typeof code === "number" ? code : undefined,
        reasonText,
      );
    }
  });

  sock.ev.on("messages.upsert", async (event) => {
    if (event.type !== "notify" && event.type !== "append") {
      console.log(
        `[bot:${tenantId}] messages.upsert ignorado (type=${event.type}, count=${event.messages.length})`,
      );
      return;
    }

    const fresh = event.messages.filter((m) => {
      const ts = Number(m.messageTimestamp ?? 0);
      return ts >= state.startTs;
    });

    console.log(
      `[bot:${tenantId}] messages.upsert type=${event.type} total=${event.messages.length} frescos=${fresh.length}`,
    );

    if (fresh.length === 0) return;

    try {
      await handleIncomingMessages(tenantId, sock, fresh);
    } catch (err) {
      console.error(
        `[bot:${tenantId}] Error procesando mensajes entrantes:`,
        err,
      );
    }
  });

  // Loop del outbox por tenant.
  //
  // BUG real encontrado (2026-09-18): este temporizador se crea UNA sola vez
  // (por eso el `if (!state.outboxTimer)`) y capturaba en su closure el
  // `sock` de ESA primera llamada a start(). Cada vez que WhatsApp cerraba la
  // conexión (code 428, pasa seguido) y scheduleReconnect creaba un socket
  // nuevo, el temporizador seguía intentando mandar por el socket viejo y
  // muerto — todo fallaba con "Connection Closed" para siempre, mientras
  // que recibir y contestar mensajes seguía funcionando normal (esos usan el
  // socket vigente que llega por el evento). Resultado real: todos los
  // mensajes humanos escritos desde el dashboard y los avisos de pedido al
  // admin se quedaron sin salir durante horas, sin ningún error visible
  // para el dueño. Ahora en cada tick se lee el socket ACTUAL de
  // state.handle (que start() reasigna en cada reconexión).
  if (!state.outboxTimer) {
    state.outboxTimer = setInterval(() => {
      const current = state.handle?.sock;
      if (!current) return; // reconectando — el próximo tick reintenta
      void processOutbox(tenantId, current).catch((err) =>
        console.error(`[bot:${tenantId}] Error procesando outbox:`, err),
      );
    }, 2000);
  }
}

const MAX_RECONNECT_RETRIES = 5;

function scheduleReconnect(
  tenantId: number,
  code?: number,
  reasonText?: string,
): void {
  const state = getOrCreateState(tenantId);
  if (state.reconnectTimer) return;

  if (state.reconnectCount >= MAX_RECONNECT_RETRIES) {
    console.error(
      `[bot:${tenantId}] Máximo de reintentos (${MAX_RECONNECT_RETRIES}) alcanzado. Deteniendo reconexión.`,
    );
    setConnectionState(tenantId, {
      status: "disconnected",
      qr_string: null,
      phone: null,
    });
    void sendDisconnectionAlert(
      tenantId,
      `${reasonText ?? `Código ${code}`} — se agotaron los ${MAX_RECONNECT_RETRIES} reintentos, el bot quedó desconectado y no lo va a intentar de nuevo solo.`,
    );
    return;
  }

  state.reconnectCount++;
  // Backoff exponencial: base 5s, max 60s
  const baseDelay = code === 440 ? 15000 : 5000;
  const delay = Math.min(baseDelay * state.reconnectCount, 60000);
  console.log(
    `[bot:${tenantId}] Reintentando en ${delay / 1000}s (intento ${state.reconnectCount}/${MAX_RECONNECT_RETRIES})...`,
  );
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.handle) {
      try {
        state.handle.sock.end(undefined);
      } catch {
        /* ignore */
      }
      state.handle = null;
    }
    void start(tenantId).catch((err: unknown) => {
      console.error(`[bot:${tenantId}] Error reiniciando socket:`, err);
      scheduleReconnect(tenantId);
    });
  }, delay);
}

export async function startBaileys(tenantId: number): Promise<void> {
  await start(tenantId);
}

export function getHandle(tenantId: number): BaileysHandle | null {
  return tenants.get(tenantId)?.handle ?? null;
}

export function listActiveTenants(): number[] {
  return Array.from(tenants.keys());
}

export async function shutdownTenant(
  tenantId: number,
  options?: { logout?: boolean },
): Promise<void> {
  const state = tenants.get(tenantId);
  if (!state) return;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.outboxTimer) {
    clearInterval(state.outboxTimer);
    state.outboxTimer = null;
  }
  if (state.qrTimer) {
    clearTimeout(state.qrTimer);
    state.qrTimer = null;
  }
  if (state.handle) {
    if (options?.logout) {
      await state.handle.logout();
    } else {
      await state.handle.shutdown();
    }
    state.handle = null;
  }
  tenants.delete(tenantId);
}

export async function shutdownBaileys(): Promise<void> {
  const ids = Array.from(tenants.keys());
  for (const id of ids) {
    await shutdownTenant(id);
  }
}
