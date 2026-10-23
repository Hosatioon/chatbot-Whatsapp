import { describe, it, expect, beforeAll, vi } from "vitest";

// Mismo truco que product-search.test.ts: con NEXT_PHASE de build db.ts usa
// una base en memoria, así la prueba nunca toca data/messages.db.
vi.stubEnv("NEXT_PHASE", "phase-production-build");
type DB = typeof import("./db");
type Resolver = typeof import("./address-resolver");
let db: DB;
let resolver: Resolver;
let tenantId: number;

const PEREIRA = { lat: 4.8133, lng: -75.6961 };

beforeAll(async () => {
  db = await import("./db");
  resolver = await import("./address-resolver");
  tenantId = db.createTenant("Resolver test", `resolver-test-${Date.now()}`).id;
  db.upsertKnownPlace(tenantId, "Edificio Chipre", 4.81, -75.69, [], "bulk_import");
  db.upsertKnownPlace(tenantId, "Edificio Via Vento", 4.82, -75.7, [], "bulk_import");
});

describe("resolveDeliveryAddress", () => {
  it("solo torre/apto, sin referencia, no ofrece lugares al azar (caso Cookliz 2026-10-11)", async () => {
    const r = await resolver.resolveDeliveryAddress(
      tenantId,
      "Torre 3  apto 602",
      PEREIRA,
    );
    expect(r.status).toBe("not_found");
    expect(r.candidates ?? []).toEqual([]);
  });
});
