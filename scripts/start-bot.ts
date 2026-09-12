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
  shutdownTenant,
  listActiveTenants,
} from "../src/lib/baileys/client";
import {
  listTenants,
  listActiveTenantsForBot,
  setConnectionState,
  purgeOldConversationMessages,
} from "../src/lib/db";
import { runBackupCycle } from "./backup";

const DATA_DIR = path.resolve(process.cwd(), "data");
const AUTH_ROOT = path.resolve(process.cwd(), "auth");

let shuttingDown = false;

async function resetTenant(tenantId: number): Promise<void> {
  console.log(`[bot:${tenantId}] Reset solicitado desde el dashboard`);
  try {
    await shutdownTenant(tenantId, { logout: true });
  } catch (err) {
    console.warn(`[bot:${tenantId}] Error en shutdown:`, err);
  }
  const authDir = path.join(AUTH_ROOT, String(tenantId));
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[bot:${tenantId}] No se pudo borrar auth/${tenantId}/:`, err);
  }
  setConnectionState(tenantId, {
    status: "disconnected",
    qr_string: null,
    phone: null,
  });
  console.log(`[bot:${tenantId}] Reiniciando socket limpio...`);
  await startBaileys(tenantId);
}

async function startAllTenants(): Promise<void> {
  const all = listActiveTenantsForBot();
  const existingIds = new Set(all.map((t) => t.id));
  const active = new Set(listActiveTenants());

  // 1. Apagar tenants que ya no están activos o fueron eliminados
  for (const activeId of active) {
    if (!existingIds.has(activeId)) {
      console.log(
        `[bot:${activeId}] Tenant inactivo o eliminado. Apagando socket...`,
      );
      try {
        await shutdownTenant(activeId);
      } catch (err) {
        console.warn(`[bot:${activeId}] Error apagando tenant:`, err);
      }
    }
  }

  // 2. Iniciar tenants nuevos que tengan plan activo o trial
  for (const t of all) {
    if (active.has(t.id)) continue;
    try {
      console.log(
        `[bot:${t.id}] Iniciando para tenant "${t.name}" (${t.slug})...`,
      );
      await startBaileys(t.id);
    } catch (err) {
      console.error(`[bot:${t.id}] Error iniciando:`, err);
    }
  }
}

async function main(): Promise<void> {
  console.log("[bot] Iniciando agente WhatsApp multi-tenant...");

  // Backup inicial al arrancar
  try {
    runBackupCycle();
  } catch (err) {
    console.warn("[bot] Error en backup inicial:", err);
  }

  // Backup cada 6 horas
  const BACKUP_INTERVAL_MS =
    parseInt(process.env.BACKUP_INTERVAL_HOURS || "6", 10) * 60 * 60 * 1000;
  setInterval(() => {
    if (shuttingDown) return;
    try {
      runBackupCycle();
    } catch (err) {
      console.warn("[bot] Error en backup programado:", err);
    }
  }, BACKUP_INTERVAL_MS);
  console.log(
    `[bot] Backups automáticos cada ${process.env.BACKUP_INTERVAL_HOURS || "6"}h`,
  );

  // Retención de mensajes: borra el TEXTO de conversaciones sin actividad
  // reciente (no los pedidos, esos se quedan siempre). Por inactividad
  // real, no por fecha de calendario — un negocio que cierra pasada la
  // medianoche no tiene un "fin de día" limpio para cortar por ahí.
  const MESSAGE_RETENTION_DAYS = parseInt(
    process.env.MESSAGE_RETENTION_DAYS || "90",
    10,
  );
  function runMessagePurge(): void {
    try {
      const deleted = purgeOldConversationMessages(MESSAGE_RETENTION_DAYS);
      if (deleted > 0) {
        console.log(
          `[bot] Limpieza de mensajes: ${deleted} mensajes borrados (conversaciones con ${MESSAGE_RETENTION_DAYS}+ días sin actividad)`,
        );
      }
    } catch (err) {
      console.warn("[bot] Error en limpieza de mensajes:", err);
    }
  }
  runMessagePurge();
  setInterval(
    () => {
      if (shuttingDown) return;
      runMessagePurge();
    },
    24 * 60 * 60 * 1000,
  );
  console.log(
    `[bot] Limpieza de mensajes automática cada 24h (retención: ${MESSAGE_RETENTION_DAYS} días de inactividad)`,
  );

  await startAllTenants();

  // Watcher: archivos `.restart-<tenantId>` en data/ -> reset de ese tenant.
  // También periódicamente arrancamos tenants nuevos creados desde el dashboard.
  setInterval(() => {
    if (shuttingDown) return;

    // 1. Reset por tenant
    try {
      const entries = fs.readdirSync(DATA_DIR);
      for (const name of entries) {
        const m = /^\.restart-(\d+)$/.exec(name);
        if (!m) continue;
        const tenantId = Number(m[1]);
        const flagPath = path.join(DATA_DIR, name);
        try {
          fs.unlinkSync(flagPath);
        } catch {
          /* ignore */
        }
        void resetTenant(tenantId).catch((err) =>
          console.error(`[bot:${tenantId}] Error en reset:`, err),
        );
      }
    } catch {
      /* data dir no existe aún */
    }

    // 2. Arrancar tenants nuevos
    void startAllTenants().catch((err) =>
      console.error("[bot] Error en startAllTenants:", err),
    );
  }, 2000);
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
  void shutdownBaileys().finally(() => process.exit(1));
});
