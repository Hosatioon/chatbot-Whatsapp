/**
 * Semáforo para limitar llamadas concurrentes al LLM por tenant.
 * Evita que un pico de mensajes dispare N llamadas simultáneas.
 */

const MAX_PER_TENANT = parseInt(
  process.env.LLM_MAX_CONCURRENT_PER_TENANT || "2",
  10,
);
const MAX_GLOBAL = parseInt(
  process.env.LLM_MAX_CONCURRENT_GLOBAL || "8",
  10,
);
const QUEUE_TIMEOUT_MS = 20_000;

const activePerTenant = new Map<number, number>();
let activeGlobal = 0;

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const queues: { perTenant: Map<number, QueueEntry[]>; global: QueueEntry[] } = {
  perTenant: new Map(),
  global: [],
};

function tryDequeue(): void {
  // Verificar si podemos despachar algo de la cola global
  while (
    queues.global.length > 0 &&
    activeGlobal < MAX_GLOBAL
  ) {
    const entry = queues.global.shift();
    if (!entry) break;

    // Encontrar el tenantId de esta entrada buscando en perTenant
    let entryTenantId: number | null = null;
    for (const [tid, q] of queues.perTenant) {
      const idx = q.indexOf(entry);
      if (idx !== -1) {
        q.splice(idx, 1);
        entryTenantId = tid;
        break;
      }
    }
    if (entryTenantId === null) continue;

    const active = activePerTenant.get(entryTenantId) ?? 0;
    if (active >= MAX_PER_TENANT) {
      // No puede por tenant, re-enqueue
      queues.perTenant.get(entryTenantId)!.unshift(entry);
      break;
    }

    clearTimeout(entry.timer);
    activePerTenant.set(entryTenantId, active + 1);
    activeGlobal++;
    entry.resolve();
  }
}

/**
 * Adquiere un slot para llamar al LLM. Espera si hay concurrencia máxima.
 * Llama a `release()` cuando termine la llamada.
 */
export async function acquireLLMSlot(
  tenantId: number,
): Promise<{ release: () => void }> {
  const active = activePerTenant.get(tenantId) ?? 0;

  if (active < MAX_PER_TENANT && activeGlobal < MAX_GLOBAL) {
    activePerTenant.set(tenantId, active + 1);
    activeGlobal++;
    return { release: () => releaseSlot(tenantId) };
  }

  // Encolar
  console.log(
    `[llm] Concurrencia tenant ${tenantId} esperando (activos: ${active}/${MAX_PER_TENANT}, global: ${activeGlobal}/${MAX_GLOBAL})`,
  );

  return new Promise<{ release: () => void }>((resolve, reject) => {
    const entry: QueueEntry = {
      resolve: () => resolve({ release: () => releaseSlot(tenantId) }),
      reject,
      timer: setTimeout(() => {
        // Timeout: remover de colas y rechazar
        const tq = queues.perTenant.get(tenantId);
        if (tq) {
          const idx = tq.indexOf(entry);
          if (idx !== -1) tq.splice(idx, 1);
        }
        const gidx = queues.global.indexOf(entry);
        if (gidx !== -1) queues.global.splice(gidx, 1);
        reject(new Error("LLM slot timeout"));
      }, QUEUE_TIMEOUT_MS),
    };

    queues.global.push(entry);
    if (!queues.perTenant.has(tenantId)) {
      queues.perTenant.set(tenantId, []);
    }
    queues.perTenant.get(tenantId)!.push(entry);
  });
}

function releaseSlot(tenantId: number): void {
  const active = activePerTenant.get(tenantId) ?? 0;
  if (active > 0) {
    activePerTenant.set(tenantId, active - 1);
  }
  activeGlobal = Math.max(0, activeGlobal - 1);
  tryDequeue();
}

/**
 * Stats para el panel de admin.
 */
export function getLLMConcurrencyStats(): {
  activePerTenant: Record<number, number>;
  activeGlobal: number;
  queued: number;
  limits: { perTenant: number; global: number };
} {
  const active: Record<number, number> = {};
  for (const [tid, count] of activePerTenant) {
    if (count > 0) active[tid] = count;
  }
  return {
    activePerTenant: active,
    activeGlobal,
    queued: queues.global.length,
    limits: { perTenant: MAX_PER_TENANT, global: MAX_GLOBAL },
  };
}
