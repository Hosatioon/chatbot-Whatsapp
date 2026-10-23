import { describe, it, expect } from "vitest";
import { scheduleTurn } from "./conversation-turns";

let conv = 1000;
const nextConv = () => ++conv;

describe("scheduleTurn", () => {
  it("un segundo turno espera a que el primero termine", async () => {
    const c = nextConv();
    const order: string[] = [];
    const a = scheduleTurn(1, c);
    const b = scheduleTurn(1, c);

    await a.wait();
    const bDone = b.wait().then(() => order.push("b empieza"));
    await Promise.resolve();
    order.push("a termina");
    a.release();
    await bDone;

    expect(order).toEqual(["a termina", "b empieza"]);
    b.release();
  });

  it("conversaciones distintas no se esperan entre sí", async () => {
    const a = scheduleTurn(1, nextConv());
    const b = scheduleTurn(1, nextConv());
    await a.wait();
    await b.wait();
    a.release();
    b.release();
  });

  it("el turno que tiene otro detrás descarta su respuesta; el último no", async () => {
    const c = nextConv();
    const a = scheduleTurn(1, c);
    const b = scheduleTurn(1, c);
    expect(a.shouldDiscardReply()).toBe(true);
    a.release();
    await b.wait();
    expect(b.shouldDiscardReply()).toBe(false);
    b.release();
  });

  it("no descarta más de 2 respuestas seguidas aunque el cliente siga escribiendo", () => {
    const c = nextConv();
    const t1 = scheduleTurn(1, c);
    const t2 = scheduleTurn(1, c);
    const t3 = scheduleTurn(1, c);
    const t4 = scheduleTurn(1, c);
    expect(t1.shouldDiscardReply()).toBe(true);
    expect(t2.shouldDiscardReply()).toBe(true);
    expect(t3.shouldDiscardReply()).toBe(false);
    t3.markReplied(30);
    // Después de una respuesta enviada, el contador vuelve a cero.
    const t5 = scheduleTurn(1, c);
    expect(t4.shouldDiscardReply()).toBe(true);
    for (const t of [t1, t2, t3, t4, t5]) t.release();
  });

  it("si el turno anterior ya contestó hasta ese mensaje, el siguiente no repite", async () => {
    const c = nextConv();
    const a = scheduleTurn(1, c);
    const b = scheduleTurn(1, c);
    // a alcanzó a leer el mensaje 12 (el que disparó a b) y lo contestó.
    a.markReplied(12);
    a.release();
    await b.wait();
    expect(b.alreadyAnswered(12)).toBe(true);
    // Si llegó algo más nuevo, b sí tiene que contestar.
    expect(b.alreadyAnswered(13)).toBe(false);
    b.release();
  });

  it("soltar dos veces el mismo turno no rompe la fila", async () => {
    const c = nextConv();
    const a = scheduleTurn(1, c);
    a.release();
    a.release();
    const b = scheduleTurn(1, c);
    await b.wait();
    expect(b.shouldDiscardReply()).toBe(false);
    b.release();
  });
});
