/**
 * Un turno del bot a la vez por conversación.
 *
 * BUG real (2026-10-11): con gpt-5-mini una respuesta tarda ~10s. Si el
 * cliente mandaba otro mensaje mientras tanto, arrancaba un segundo turno en
 * paralelo para la MISMA conversación (el semáforo de llm-concurrency deja 2
 * por tenant): salían dos respuestas, la segunda armada con el carrito de
 * antes de que el primer turno guardara lo suyo. Caso real: el cliente dijo
 * "sí, a domicilio, ya te envío la dirección" y el bot contestó "¿domicilio
 * o recoges?" y enseguida "¿transferencia o efectivo?", saltándose la
 * dirección.
 *
 * Cada turno saca un ticket ANTES del debounce (así el turno que está
 * generando se entera de que viene otro detrás), espera a que terminen los
 * anteriores y recién ahí lee estado e historial.
 */

// Si un turno anterior se cuelga (ej. el LLM no contesta), no dejamos a la
// conversación esperando para siempre: pasado este tiempo seguimos igual.
const WAIT_TIMEOUT_MS = parseInt(
  process.env.CONVERSATION_TURN_WAIT_MS || "90000",
  10,
);
// Tope de respuestas descartadas seguidas: un cliente que escribe sin parar
// igual tiene que recibir algo en algún momento.
const MAX_DISCARDS_IN_A_ROW = 2;

interface ConversationQueue {
  tail: Promise<void>;
  lastTicket: number;
  open: number;
  discardsInARow: number;
  // Id del último mensaje del cliente que ya recibió respuesta. Solo hace
  // falta mientras haya turnos en fila, por eso vive en la cola.
  answeredUpTo: number;
}

export interface TurnTicket {
  /** Espera a que terminen los turnos anteriores de esta conversación. */
  wait(): Promise<void>;
  /**
   * true si detrás de este turno ya viene otro (que va a leer el historial
   * completo) y esta respuesta conviene no mandarla. Cuenta como descarte.
   */
  shouldDiscardReply(): boolean;
  /**
   * true si un turno anterior ya contestó hasta este mensaje del cliente
   * (lo alcanzó a leer antes de que este turno empezara).
   */
  alreadyAnswered(lastUserMessageId: number): boolean;
  /** Avisa que este turno contestó hasta ese mensaje del cliente. */
  markReplied(lastUserMessageId: number): void;
  release(): void;
}

// Map key: `${tenantId}:${conversationId}`
const queues = new Map<string, ConversationQueue>();
let nextTicket = 0;

export function scheduleTurn(
  tenantId: number,
  conversationId: number,
): TurnTicket {
  const key = `${tenantId}:${conversationId}`;
  let q = queues.get(key);
  if (!q) {
    q = {
      tail: Promise.resolve(),
      lastTicket: 0,
      open: 0,
      discardsInARow: 0,
      answeredUpTo: 0,
    };
    queues.set(key, q);
  }
  const queue = q;
  const id = ++nextTicket;
  const previous = queue.tail;
  let releaseFn: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  queue.tail = previous.then(() => done);
  queue.lastTicket = id;
  queue.open++;
  let released = false;

  return {
    wait() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          console.warn(
            `[turns] ${key}: el turno anterior lleva más de ${WAIT_TIMEOUT_MS}ms, sigo sin esperarlo`,
          );
          resolve();
        }, WAIT_TIMEOUT_MS);
      });
      return Promise.race([previous, timeout]).finally(() =>
        clearTimeout(timer),
      );
    },
    shouldDiscardReply() {
      if (queue.lastTicket === id) return false;
      if (queue.discardsInARow >= MAX_DISCARDS_IN_A_ROW) return false;
      queue.discardsInARow++;
      return true;
    },
    alreadyAnswered(lastUserMessageId) {
      return lastUserMessageId <= queue.answeredUpTo;
    },
    markReplied(lastUserMessageId) {
      queue.discardsInARow = 0;
      queue.answeredUpTo = Math.max(queue.answeredUpTo, lastUserMessageId);
    },
    release() {
      if (released) return;
      released = true;
      releaseFn();
      queue.open--;
      if (queue.open === 0 && queues.get(key) === queue) queues.delete(key);
    },
  };
}
