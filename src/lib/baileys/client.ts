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

const AUTH_ROOT = path.resolve(process.cwd(), "auth");

function authDirFor(tenantId: number): string {
  return path.join(AUTH_ROOT, String(tenantId));
}

export interface BaileysHandle {
  tenantId: number;
  sock: WASocket;
  shutdown: () => Promise<void>;
}

interface TenantState {
  handle: BaileysHandle | null;
  reconnectTimer: NodeJS.Timeout | null;
  outboxTimer: NodeJS.Timeout | null;
  startTs: number;
  reconnectCount: number;
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
  };

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(
        `[bot:${tenantId}] QR recibido. Escanealo desde http://localhost:3000`,
      );
      qrcodeTerminal.generate(qr, { small: true });
      setConnectionState(tenantId, {
        status: "qr",
        qr_string: qr,
        phone: null,
      });
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

      scheduleReconnect(tenantId, typeof code === "number" ? code : undefined);
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

  // Loop del outbox por tenant
  if (!state.outboxTimer) {
    state.outboxTimer = setInterval(() => {
      void processOutbox(tenantId, sock).catch((err) =>
        console.error(`[bot:${tenantId}] Error procesando outbox:`, err),
      );
    }, 2000);
  }
}

const MAX_RECONNECT_RETRIES = 20;

function scheduleReconnect(tenantId: number, code?: number): void {
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

export async function shutdownTenant(tenantId: number): Promise<void> {
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
  if (state.handle) {
    await state.handle.shutdown();
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
