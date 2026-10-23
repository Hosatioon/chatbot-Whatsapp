import { describe, it, expect, beforeAll, vi } from "vitest";

// Base en memoria (ver product-search.test.ts).
vi.stubEnv("NEXT_PHASE", "phase-production-build");
type DB = typeof import("./db");
type Prompt = typeof import("./system-prompt");
let db: DB;
let prompt: Prompt;
let tenantId: number;

beforeAll(async () => {
  db = await import("./db");
  prompt = await import("./system-prompt");
  tenantId = db.createTenant("Prompt test", `prompt-test-${Date.now()}`).id;
});

describe("system prompt", () => {
  it("la parte fija no cambia con el pedido (si no, se pierde la caché de prompt)", () => {
    const fixed = prompt.buildSystemPromptForTenant(tenantId);
    // Las reglas nombran estas secciones; lo que no puede estar es la sección.
    expect(fixed).not.toContain("--- PEDIDO EN CURSO ---");
    expect(fixed).not.toContain("--- SIGUIENTE PASO ---");
    expect(prompt.buildSystemPromptForTenant(tenantId)).toBe(fixed);
  });

  it("el estado del pedido sale aparte, con el siguiente paso", () => {
    const section = prompt.buildOrderStateSection();
    expect(section).toContain("--- PEDIDO EN CURSO ---");
    expect(section).toContain("--- SIGUIENTE PASO ---");
  });

  it("las instrucciones no usan voseo", () => {
    const fixed = prompt.buildSystemPromptForTenant(tenantId);
    expect(fixed).not.toMatch(/\b(llamá|respondé|usá|mandá|podés|tenés|vos)\b/);
  });
});
