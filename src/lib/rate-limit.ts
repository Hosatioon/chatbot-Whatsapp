import crypto from "node:crypto";
import {
  countDuplicateContentInWindow,
  countMessagesInWindow,
  recordMessageEvent,
} from "./db";

// Límites por defecto (configurables vía env)
const PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
const PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR ?? 100);
const DUPLICATE_WINDOW_SEC = Number(
  process.env.RATE_LIMIT_DUPLICATE_WINDOW_SEC ?? 60,
);
const DUPLICATE_THRESHOLD = Number(
  process.env.RATE_LIMIT_DUPLICATE_THRESHOLD ?? 3,
);

export type RateLimitVerdict =
  | { ok: true }
  | { ok: false; reason: "flood_minute" | "flood_hour" | "duplicate" | "empty" };

function hashContent(s: string): string {
  return crypto.createHash("sha1").update(s.toLowerCase().trim()).digest("hex");
}

/**
 * Verifica si un mensaje entrante debe ser procesado o silenciado.
 * Si pasa, registra el evento.
 */
export function checkAndRecord(
  tenantId: number,
  phone: string,
  content: string,
): RateLimitVerdict {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const perMin = countMessagesInWindow(tenantId, phone, 60);
  if (perMin >= PER_MINUTE) return { ok: false, reason: "flood_minute" };

  const perHour = countMessagesInWindow(tenantId, phone, 3600);
  if (perHour >= PER_HOUR) return { ok: false, reason: "flood_hour" };

  const hash = hashContent(trimmed);
  const dup = countDuplicateContentInWindow(
    tenantId,
    phone,
    hash,
    DUPLICATE_WINDOW_SEC,
  );
  if (dup >= DUPLICATE_THRESHOLD) return { ok: false, reason: "duplicate" };

  recordMessageEvent(tenantId, phone, hash);
  return { ok: true };
}
