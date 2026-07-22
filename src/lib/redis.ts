/**
 * Redis client para rate limiting, caché y cola de mensajes.
 * Usa ioredis para conexión con Redis/Upstash.
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    redis.on("error", (err) => {
      console.error("[redis] Error:", err.message);
    });

    redis.on("connect", () => {
      console.log("[redis] Conectado");
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// ============================================================================
// RATE LIMITING
// ============================================================================

const RATE_LIMIT_WINDOW = 60; // 1 minuto
const RATE_LIMIT_MAX = 20; // máximo mensajes por minuto
const RATE_LIMIT_HOUR_WINDOW = 3600; // 1 hora
const RATE_LIMIT_HOUR_MAX = 100; // máximo mensajes por hora
const DUPLICATE_WINDOW = 60; // 1 minuto
const DUPLICATE_THRESHOLD = 3; // máximo mensajes idénticos

export interface RateLimitResult {
  allowed: boolean;
  reason?: "flood_minute" | "flood_hour" | "duplicate";
  remaining: number;
  resetIn: number;
}

export async function checkRateLimit(
  tenantId: number,
  phone: string,
  content: string,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);
  const minuteKey = `ratelimit:${tenantId}:${phone}:minute`;
  const hourKey = `ratelimit:${tenantId}:${phone}:hour`;
  const dupKey = `ratelimit:${tenantId}:${phone}:dup:${hashContent(content)}`;

  const pipeline = redis.pipeline();

  // Contar mensajes del último minuto
  pipeline.zcount(minuteKey, now - RATE_LIMIT_WINDOW, now);
  // Contar mensajes de la última hora
  pipeline.zcount(hourKey, now - RATE_LIMIT_HOUR_WINDOW, now);
  // Contar mensajes duplicados
  pipeline.zcount(dupKey, now - DUPLICATE_WINDOW, now);

  const results = await pipeline.exec();
  if (!results) {
    return { allowed: true, remaining: RATE_LIMIT_MAX, resetIn: 0 };
  }

  const minuteCount = (results[0]?.[1] as number) || 0;
  const hourCount = (results[1]?.[1] as number) || 0;
  const dupCount = (results[2]?.[1] as number) || 0;

  if (minuteCount >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      reason: "flood_minute",
      remaining: 0,
      resetIn: RATE_LIMIT_WINDOW - (now % RATE_LIMIT_WINDOW),
    };
  }

  if (hourCount >= RATE_LIMIT_HOUR_MAX) {
    return {
      allowed: false,
      reason: "flood_hour",
      remaining: 0,
      resetIn: RATE_LIMIT_HOUR_WINDOW - (now % RATE_LIMIT_HOUR_WINDOW),
    };
  }

  if (dupCount >= DUPLICATE_THRESHOLD) {
    return {
      allowed: false,
      reason: "duplicate",
      remaining: 0,
      resetIn: DUPLICATE_WINDOW - (now % DUPLICATE_WINDOW),
    };
  }

  // Registrar el mensaje
  const recordPipeline = redis.pipeline();
  recordPipeline.zadd(minuteKey, now, `${now}:${Math.random()}`);
  recordPipeline.expire(minuteKey, RATE_LIMIT_WINDOW + 10);
  recordPipeline.zadd(hourKey, now, `${now}:${Math.random()}`);
  recordPipeline.expire(hourKey, RATE_LIMIT_HOUR_WINDOW + 10);
  recordPipeline.zadd(dupKey, now, `${now}:${Math.random()}`);
  recordPipeline.expire(dupKey, DUPLICATE_WINDOW + 10);
  await recordPipeline.exec();

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - minuteCount - 1,
    resetIn: RATE_LIMIT_WINDOW - (now % RATE_LIMIT_WINDOW),
  };
}

function hashContent(content: string): string {
  const normalized = content.toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// CACHÉ LLM
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export async function getCachedLLMResponse(
  cacheKey: string,
): Promise<string | null> {
  const redis = getRedis();
  const key = `llm:cache:${cacheKey}`;
  const cached = await redis.get(key);
  if (!cached) return null;

  try {
    const entry: CacheEntry<string> = JSON.parse(cached);
    if (entry.expiresAt < Date.now()) {
      await redis.del(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCachedLLMResponse(
  cacheKey: string,
  response: string,
  ttlSeconds = 3600,
): Promise<void> {
  const redis = getRedis();
  const key = `llm:cache:${cacheKey}`;
  const entry: CacheEntry<string> = {
    data: response,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await redis.setex(key, ttlSeconds, JSON.stringify(entry));
}

export function generateLLMCacheKey(
  tenantId: number,
  messages: Array<{ role: string; content: string }>,
): string {
  const messageHash = messages
    .map((m) => `${m.role}:${m.content}`)
    .join("|");
  let hash = 0;
  for (let i = 0; i < messageHash.length; i++) {
    const char = messageHash.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${tenantId}:${Math.abs(hash).toString(36)}`;
}

// ============================================================================
// CACHÉ DE PRODUCTOS
// ============================================================================

export async function getCachedProducts(
  tenantId: number,
): Promise<any[] | null> {
  const redis = getRedis();
  const key = `products:${tenantId}`;
  const cached = await redis.get(key);
  if (!cached) return null;

  try {
    const entry: CacheEntry<any[]> = JSON.parse(cached);
    if (entry.expiresAt < Date.now()) {
      await redis.del(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCachedProducts(
  tenantId: number,
  products: any[],
  ttlSeconds = 300,
): Promise<void> {
  const redis = getRedis();
  const key = `products:${tenantId}`;
  const entry: CacheEntry<any[]> = {
    data: products,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await redis.setex(key, ttlSeconds, JSON.stringify(entry));
}

export async function invalidateProductsCache(tenantId: number): Promise<void> {
  const redis = getRedis();
  await redis.del(`products:${tenantId}`);
}

// ============================================================================
// CACHÉ DE CONVERSACIONES
// ============================================================================

export async function getCachedConversation(
  tenantId: number,
  phone: string,
): Promise<any | null> {
  const redis = getRedis();
  const key = `convo:${tenantId}:${phone}`;
  const cached = await redis.get(key);
  if (!cached) return null;

  try {
    const entry: CacheEntry<any> = JSON.parse(cached);
    if (entry.expiresAt < Date.now()) {
      await redis.del(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCachedConversation(
  tenantId: number,
  phone: string,
  conversation: any,
  ttlSeconds = 600,
): Promise<void> {
  const redis = getRedis();
  const key = `convo:${tenantId}:${phone}`;
  const entry: CacheEntry<any> = {
    data: conversation,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  await redis.setex(key, ttlSeconds, JSON.stringify(entry));
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function redisHealthCheck(): Promise<{
  ok: boolean;
  latency: number;
  error?: string;
}> {
  const redis = getRedis();
  const t0 = Date.now();
  try {
    await redis.ping();
    return {
      ok: true,
      latency: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      latency: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}
