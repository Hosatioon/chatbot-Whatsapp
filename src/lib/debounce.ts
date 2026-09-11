/**
 * Debounce de mensajes entrantes por conversación.
 * Si el cliente manda varios mensajes seguidos, se acumulan y se
 * procesa solo una llamada al LLM con todo el texto junto.
 */

// Subido de 4000 a 7000ms (2026-09-11): un cliente que escribe rápido en
// varios mensajes seguidos (ej: manda el pin de GPS y ya está escribiendo
// "Local 16" antes de que el bot alcance a responder) puede partirse en
// dos turnos separados si el debounce es muy corto — eso fue justo lo
// que causó que un detalle real se perdiera en un pedido de prueba. Más
// margen acá reduce ese tipo de bug; no tiene relación con riesgo de
// baneo (eso lo maneja el delay humanizado antes de enviar, no este).
const DEBOUNCE_MS = parseInt(process.env.LLM_DEBOUNCE_MS || "7000", 10);
const MAX_BUFFERED = 10;

interface PendingCall {
  texts: string[];
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

// Map key: `${tenantId}:${conversationId}`
const pending = new Map<string, PendingCall>();

/**
 * Acumula un mensaje y espera a que no lleguen más antes de resolver.
 * Si ya hay MAX_BUFFERED mensajes acumulados, resuelve inmediatamente.
 */
export function debounceMessage(
  tenantId: number,
  conversationId: number,
  text: string,
): Promise<void> {
  const key = `${tenantId}:${conversationId}`;
  const existing = pending.get(key);

  if (existing) {
    existing.texts.push(text);
    // Reset timer
    clearTimeout(existing.timer);
    if (existing.texts.length >= MAX_BUFFERED) {
      // Demasiados mensajes acumulados, procesar ya
      pending.delete(key);
      existing.resolve();
      return Promise.resolve();
    }
    existing.timer = setTimeout(() => {
      pending.delete(key);
      existing.resolve();
    }, DEBOUNCE_MS);
    return new Promise<void>((resolve) => {
      // El primer mensaje ya tiene su promise; este es uno nuevo
      // que se suma al buffer. No necesita esperar separadamente.
      resolve();
    });
  }

  // Primer mensaje: crear entrada y esperar
  let resolveFn: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  const entry: PendingCall = {
    texts: [text],
    timer: setTimeout(() => {
      pending.delete(key);
      resolveFn();
    }, DEBOUNCE_MS),
    resolve: resolveFn!,
  };
  pending.set(key, entry);

  return promise;
}

/**
 * Verifica si una conversación tiene mensajes pendientes en el buffer.
 */
export function hasPendingDebounce(
  tenantId: number,
  conversationId: number,
): boolean {
  return pending.has(`${tenantId}:${conversationId}`);
}

/**
 * Obtiene los textos acumulados para una conversación (para logging).
 */
export function getBufferedTexts(
  tenantId: number,
  conversationId: number,
): string[] {
  return pending.get(`${tenantId}:${conversationId}`)?.texts ?? [];
}
