/**
 * Mondrex Bot Service
 *
 * ⚠️ NO ESTÁ LISTO PARA PRODUCCIÓN — ver bot-service/README.md.
 * Usa su propia SQLite local (no Postgres ni la SQLite del dashboard),
 * y generateReply() no valida stock ni calcula precios reales. Para
 * lanzar, usá docker-compose.yml + Dockerfile.bot (src/lib/) en su lugar.
 *
 * Proceso independiente para manejar conexiones WhatsApp via Baileys.
 * Corre en su propio container/proceso, separado de Next.js.
 *
 * Responsabilidades:
 * - Mantener conexiones WebSocket con WhatsApp para cada tenant
 * - Procesar mensajes entrantes y enviar respuestas
 * - Gestionar reconexiones automáticas
 * - Persistir estado de conexión en DB
 * - Rate limiting con Redis
 * - Cola de mensajes con BullMQ
 *
 * Comunicación con Next.js:
 * - Lee configuración de tenants desde DB
 * - Escribe mensajes en cola (BullMQ)
 * - Expone métricas via HTTP para health checks
 */

import "./env-loader";

import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import {
  startBaileys,
  shutdownBaileys,
  shutdownTenant,
  listActiveTenants,
} from "./baileys/client";
import { listTenants, setConnectionState } from "./db";
import { redisHealthCheck } from "./redis";
import {
  getOutboxQueueStatus,
  closeOutboxQueue,
  getOutboxWorker,
} from "./queue";

const DATA_DIR = path.resolve(process.env.DATA_DIR || process.cwd(), "data");
const AUTH_ROOT = path.resolve(process.env.AUTH_ROOT || process.cwd(), "auth");
const PORT = Number(process.env.BOT_PORT || 3001);

let shuttingDown = false;

async function resetTenant(tenantId: number): Promise<void> {
  console.log(`[bot:${tenantId}] Reset solicitado`);
  try {
    await shutdownTenant(tenantId);
  } catch (err) {
    console.warn(`[bot:${tenantId}] Error en shutdown:`, err);
  }
  const authDir = path.join(AUTH_ROOT, String(tenantId));
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
  console.log(`[bot:${tenantId}] Reiniciando...`);
  await startBaileys(tenantId);
}

async function startAllTenants(): Promise<void> {
  const all = listTenants();
  const existingIds = new Set(all.map((t) => t.id));
  const active = new Set(listActiveTenants());

  for (const activeId of active) {
    if (!existingIds.has(activeId)) {
      console.log(`[bot:${activeId}] Tenant eliminado. Apagando socket...`);
      try {
        await shutdownTenant(activeId);
      } catch (err) {
        console.warn(`[bot:${activeId}] Error apagando:`, err);
      }
    }
  }

  for (const t of all) {
    if (active.has(t.id)) continue;
    try {
      console.log(`[bot:${t.id}] Iniciando tenant "${t.name}" (${t.slug})...`);
      await startBaileys(t.id);
    } catch (err) {
      console.error(`[bot:${t.id}] Error iniciando:`, err);
    }
  }
}

async function getHealthStatus(): Promise<{
  status: "ok" | "degraded" | "down";
  service: string;
  activeTenants: number;
  tenants: number[];
  uptime: number;
  redis: { ok: boolean; latency: number; error?: string };
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}> {
  const activeTenants = listActiveTenants();
  const redisStatus = await redisHealthCheck();
  const queueStatus = await getOutboxQueueStatus();

  let status: "ok" | "degraded" | "down" = "ok";
  if (!redisStatus.ok) {
    status = "degraded";
  }
  if (activeTenants.length === 0) {
    status = "degraded";
  }

  return {
    status,
    service: "bot-service",
    activeTenants: activeTenants.length,
    tenants: activeTenants,
    uptime: process.uptime(),
    redis: {
      ok: redisStatus.ok,
      latency: redisStatus.latency,
      error: redisStatus.error,
    },
    queue: queueStatus,
  };
}

function createHealthServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health") {
      const health = await getHealthStatus();
      const statusCode = health.status === "ok" ? 200 : 503;
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
    } else if (req.url === "/ready") {
      const activeTenants = listActiveTenants();
      if (activeTenants.length > 0) {
        res.writeHead(200);
        res.end("OK");
      } else {
        res.writeHead(503);
        res.end("No active tenants");
      }
    } else if (req.url === "/metrics") {
      const health = await getHealthStatus();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return server;
}

async function main(): Promise<void> {
  console.log("[bot] Iniciando Mondrex Bot Service...");
  console.log(`[bot] Puerto HTTP: ${PORT}`);
  console.log(`[bot] Directorio data: ${DATA_DIR}`);
  console.log(`[bot] Directorio auth: ${AUTH_ROOT}`);

  // Iniciar worker de BullMQ
  try {
    getOutboxWorker();
    console.log("[bot] BullMQ worker iniciado");
  } catch (err) {
    console.warn("[bot] BullMQ no disponible:", err);
  }

  await startAllTenants();

  const healthServer = createHealthServer();
  healthServer.listen(PORT, () => {
    console.log(`[bot] Health server en http://localhost:${PORT}/health`);
  });

  setInterval(() => {
    if (shuttingDown) return;

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
    await closeOutboxQueue();
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
  void closeOutboxQueue()
    .then(() => shutdownBaileys())
    .finally(() => process.exit(1));
});
