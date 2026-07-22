import { NextResponse } from "next/server";

interface RateEntry {
  count: number;
  resetAt: number;
}

// Map simple en memoria. Para 5 tenants por VPS esto sobra.
const apiLimiter = new Map<string, RateEntry>();

// Limpieza periódica de entradas expiradas (cada 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiLimiter) {
    if (now >= entry.resetAt) {
      apiLimiter.delete(key);
    }
  }
}, 300000);

export function checkApiRateLimit(
  key: string,
  limit = 100,
  windowMs = 60000,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const entry = apiLimiter.get(key);

  if (!entry || now >= entry.resetAt) {
    apiLimiter.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }

  entry.count++;
  return { ok: true };
}

export function apiRateLimitResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
