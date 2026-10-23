import { describe, it, expect, beforeAll, vi } from "vitest";

// Base en memoria (ver product-search.test.ts). Sin API key: estas pruebas
// llaman los tools directo, nunca al LLM.
vi.stubEnv("NEXT_PHASE", "phase-production-build");
type DB = typeof import("./db");
type LLM = typeof import("./openrouter");
type State = typeof import("./conversation-state");
let db: DB;
let llm: LLM;
let state: State;
let tenantId: number;

beforeAll(async () => {
  db = await import("./db");
  llm = await import("./openrouter");
  state = await import("./conversation-state");
  tenantId = db.createTenant("AddItem test", `additem-test-${Date.now()}`).id;
  db.createProduct(tenantId, "Galleta de Nutella", 8000, 5);
  db.createProduct(tenantId, "Galleta de cookies and cream", 8000, 10);
  db.createProduct(tenantId, "Croissant de chocolate", 9000, 10);
});

let phone = 3000000000;
function newConversation() {
  const convo = db.getOrCreateConversation(tenantId, String(++phone));
  const conversationState = state.getStateForConversation(convo.id, tenantId);
  return { conversationId: convo.id, conversationState, tenantId };
}

async function call(
  ctx: ReturnType<typeof newConversation>,
  args: Record<string, unknown>,
  lastCustomerMessage = "",
) {
  const r = await llm.executeTool("addItem", args, tenantId, {
    ...ctx,
    lastCustomerMessage,
  });
  return JSON.parse(r.result);
}

const qty = (ctx: ReturnType<typeof newConversation>, name: string) =>
  ctx.conversationState.draft_items.find((i) => i.name === name)?.quantity;

describe("addItem", () => {
  it("pidió 30 con 5 en stock: anota 5 y pregunta si le sirven (caso Cookliz 2026-10-11)", async () => {
    const ctx = newConversation();
    const r = await call(ctx, { name: "galleta de nutella", quantity: 30 });
    expect(qty(ctx, "Galleta de Nutella")).toBe(5);
    expect(r.warning).toContain("Solo tengo 5 de Galleta de Nutella");
    expect(r.warning).toContain("¿Te sirve así?");
  });

  it("'entonces 4 de Nutella' con set_total baja a 4 en vez de sumar", async () => {
    const ctx = newConversation();
    await call(ctx, { name: "galleta de nutella", quantity: 30 });
    const r = await call(
      ctx,
      { name: "galleta de nutella", quantity: 4, set_total: true },
      "No bobis por eso, quiero solo 4 galletas de Nutella",
    );
    expect(r.success).toBe(true);
    expect(r.added.quantity).toBe(4);
    expect(qty(ctx, "Galleta de Nutella")).toBe(4);
  });

  it("set_total hacia arriba suma solo la diferencia", async () => {
    const ctx = newConversation();
    await call(ctx, { name: "cookies and cream", quantity: 2 });
    const r = await call(ctx, {
      name: "cookies and cream",
      quantity: 7,
      set_total: true,
    });
    expect(r.added.quantity).toBe(7);
    expect(qty(ctx, "Galleta de cookies and cream")).toBe(7);
  });

  it("sin set_total sigue sumando como siempre", async () => {
    const ctx = newConversation();
    await call(ctx, { name: "cookies and cream", quantity: 2 });
    await call(ctx, { name: "cookies and cream", quantity: 3 }, "dame 3 más");
    expect(qty(ctx, "Galleta de cookies and cream")).toBe(5);
  });

  it("set_total de un producto que no estaba lo agrega normal", async () => {
    const ctx = newConversation();
    await call(ctx, { name: "croissant de chocolate", quantity: 2, set_total: true });
    expect(qty(ctx, "Croissant de chocolate")).toBe(2);
  });

  it("si no hay nada parecido no ofrece productos al azar (caso 'botella de agua')", async () => {
    const ctx = newConversation();
    const r = await call(ctx, { name: "botella de agua", quantity: 1 });
    expect(r.error).toContain("Producto no encontrado");
    expect(r.available_products).toEqual([]);
  });
});
