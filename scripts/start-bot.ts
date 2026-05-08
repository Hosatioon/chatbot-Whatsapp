// IMPORTANTE: env-loader DEBE ser el primer import. Los imports de ES
// modules se hoistean al inicio del archivo, así que cualquier módulo
// que lea process.env en su top-level (ej: openrouter.ts) se va a
// ejecutar DESPUÉS de este side-effect.
import "./env-loader";

import path from "node:path";
import fs from "node:fs";
import {
  startBaileys,
  shutdownBaileys,
  getHandle,
} from "../src/lib/baileys/client";
import { setConnectionState } from "../src/lib/db";

const RESTART_FLAG = path.resolve(process.cwd(), "data", ".restart");
const AUTH_DIR = path.resolve(process.cwd(), "auth");

let shuttingDown = false;

async function reset(): Promise<void> {
  console.log("[bot] Reset solicitado desde el dashboard");
  try {
    await shutdownBaileys();
  } catch (err) {
    console.warn("[bot] Error en shutdown:", err);
  }
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
  console.log("[bot] Reiniciando socket limpio...");
  await startBaileys();
}

async function main(): Promise<void> {
  console.log("[bot] Iniciando agente WhatsApp...");
  await startBaileys();

  // Watcher del flag de reset
  setInterval(() => {
    if (shuttingDown) return;
    if (fs.existsSync(RESTART_FLAG)) {
      try {
        fs.unlinkSync(RESTART_FLAG);
      } catch {
        /* ignore */
      }
      void reset().catch((err) =>
        console.error("[bot] Error en reset:", err),
      );
    }
  }, 1000);
}

async function gracefulExit(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bot] Recibido ${signal}, cerrando...`);
  try {
    await shutdownBaileys();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", () => void gracefulExit("SIGINT"));
process.on("SIGTERM", () => void gracefulExit("SIGTERM"));

main().catch((err) => {
  console.error("[bot] Error fatal:", err);
  // Si el handle quedó vivo, intentar cerrarlo
  const h = getHandle();
  if (h) {
    h.shutdown().finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
