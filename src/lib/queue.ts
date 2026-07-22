/**
 * BullMQ queue para procesamiento de mensajes salientes (outbox).
 * Persiste mensajes pendientes y permite retry automático.
 */

import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let connection: Redis | null = null;
let outboxQueue: Queue | null = null;
let outboxWorker: Worker | null = null;

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
  }
  return connection;
}

export interface OutboxJob {
  id: number;
  tenantId: number;
  conversationId: number;
  phone: string;
  remoteJid: string | null;
  content: string;
  retryCount: number;
}

// ============================================================================
// QUEUE
// ============================================================================

export function getOutboxQueue(): Queue {
  if (!outboxQueue) {
    outboxQueue = new Queue("outbox", {
      connection: getConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 1000,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      },
    });
  }
  return outboxQueue;
}

// ============================================================================
// ENQUEUE
// ============================================================================

export async function enqueueOutboxMessage(
  tenantId: number,
  conversationId: number,
  phone: string,
  content: string,
  remoteJid?: string | null,
): Promise<string> {
  const queue = getOutboxQueue();

  const job = await queue.add(
    "send-message",
    {
      id: Date.now(),
      tenantId,
      conversationId,
      phone,
      remoteJid: remoteJid ?? `${phone}@s.whatsapp.net`,
      content,
      retryCount: 0,
    } as OutboxJob,
    {
      jobId: `outbox-${tenantId}-${conversationId}-${Date.now()}`,
      priority: 1,
    },
  );

  return job.id;
}

export async function enqueueBulkOutbox(
  messages: Array<{
    tenantId: number;
    conversationId: number;
    phone: string;
    content: string;
    remoteJid?: string | null;
  }>,
): Promise<string[]> {
  const queue = getOutboxQueue();
  const jobs = messages.map((msg) => ({
    name: "send-message",
    data: {
      id: Date.now(),
      ...msg,
      remoteJid: msg.remoteJid ?? `${msg.phone}@s.whatsapp.net`,
      retryCount: 0,
    } as OutboxJob,
    opts: {
      jobId: `outbox-${msg.tenantId}-${msg.conversationId}-${Date.now()}-${Math.random()}`,
      priority: 1,
    },
  }));

  const results = await queue.addBulk(jobs);
  return results.map((r) => r.id);
}

// ============================================================================
// WORKER
// ============================================================================

export type MessageSender = (
  remoteJid: string,
  content: string,
) => Promise<void>;

let senderFn: MessageSender | null = null;

export function setMessageSender(fn: MessageSender): void {
  senderFn = fn;
}

export function getOutboxWorker(): Worker {
  if (!outboxWorker) {
    outboxWorker = new Worker(
      "outbox",
      async (job: Job<OutboxJob>) => {
        const { remoteJid, content, tenantId, phone } = job.data;

        if (!senderFn) {
          throw new Error("Message sender not configured");
        }

        try {
          await senderFn(remoteJid, content);
          console.log(
            `[outbox] Mensaje enviado a ${phone} (tenant ${tenantId})`,
          );
          return { success: true, phone, tenantId };
        } catch (err) {
          console.error(
            `[outbox] Error enviando a ${phone}:`,
            (err as Error).message,
          );
          throw err;
        }
      },
      {
        connection: getConnection(),
        concurrency: 5,
        limiter: {
          max: 10,
          duration: 1000,
        },
      },
    );

    outboxWorker.on("completed", (job, result) => {
      console.log(
        `[outbox] Job ${job.id} completado para ${result.phone}`,
      );
    });

    outboxWorker.on("failed", (job, err) => {
      console.error(
        `[outbox] Job ${job?.id} falló:`,
        err.message,
      );
    });

    outboxWorker.on("error", (err) => {
      console.error("[outbox] Worker error:", err);
    });
  }
  return outboxWorker;
}

// ============================================================================
// DRAIN (vaciar cola al shutdown)
// ============================================================================

export async function drainOutboxQueue(): Promise<void> {
  const queue = getOutboxQueue();
  await queue.drain();
  console.log("[outbox] Cola vaciada");
}

export async function closeOutboxQueue(): Promise<void> {
  if (outboxWorker) {
    await outboxWorker.close();
    outboxWorker = null;
  }
  if (outboxQueue) {
    await outboxQueue.close();
    outboxQueue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

// ============================================================================
// STATUS
// ============================================================================

export async function getOutboxQueueStatus(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getOutboxQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

// ============================================================================
// RETRY MANUAL
// ============================================================================

export async function retryOutboxJob(jobId: string): Promise<void> {
  const queue = getOutboxQueue();
  const job = await queue.getJob(jobId);
  if (job) {
    await job.retry();
    console.log(`[outbox] Job ${jobId} reintentado`);
  }
}

export async function retryAllFailed(): Promise<number> {
  const queue = getOutboxQueue();
  const failed = await queue.getFailed();
  for (const job of failed) {
    await job.retry();
  }
  console.log(`[outbox] ${failed.length} jobs reintentados`);
  return failed.length;
}
