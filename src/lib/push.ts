// Notificaciones push del navegador (Web Push estándar — sin costo, sin
// servicio de terceros que pagar: usa el servicio de push que ya trae cada
// navegador, Google/Mozilla/Apple lo operan gratis). Compartido entre el
// proceso web (Next.js) y el proceso bot (Baileys) — ambos leen/escriben la
// misma base de datos, así que el bot puede disparar un push apenas
// procesa un mensaje entrante, sin pasar por el proceso web.
import webpush from "web-push";
import {
  getPushSubscriptionsForTenant,
  deletePushSubscription,
  type PushSubscriptionRow,
} from "./db";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:soporte@ordifast.com";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string; // agrupa notificaciones relacionadas (ej: la misma conversación)
  url?: string; // a dónde llevar al usuario al hacer clic
}

// Le manda el push a TODOS los dispositivos suscritos de un tenant. No es
// crítico si falla — es una notificación de cortesía, el dato real ya vive
// en la BD y el dashboard lo muestra igual. Por eso nunca lanza: solo
// loguea, y limpia solo las suscripciones que el propio navegador reportó
// como muertas (410 Gone / 404 Not Found — el usuario desinstaló, borró
// datos del sitio, o revocó el permiso).
export async function sendPushToTenant(
  tenantId: number,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = getPushSubscriptionsForTenant(tenantId);
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(subs.map((sub) => sendToOne(sub, body)));
}

async function sendToOne(sub: PushSubscriptionRow, body: string): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      body,
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      deletePushSubscription(sub.endpoint);
      console.log(`[push] Suscripción muerta eliminada (endpoint ...${sub.endpoint.slice(-12)})`);
    } else {
      console.error(`[push] Error enviando push:`, (err as Error).message ?? err);
    }
  }
}
