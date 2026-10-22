import { describe, it, expect, beforeAll, vi } from "vitest";

// db.ts abre data/messages.db al importarse; con NEXT_PHASE de build usa
// una base en memoria, así la prueba nunca toca un archivo real. Por eso
// el import es dinámico, después de setear la variable.
vi.stubEnv("NEXT_PHASE", "phase-production-build");
type DB = typeof import("./db");
let db: DB;
let tenantId: number;

// Catálogo real de Cookliz (tenant 2) al 2026-10-21, tal cual está
// escrito en producción (mayúsculas y tildes incluidas).
const COOKLIZ = [
  "Cheescake Frutos rojos",
  "Cheesecake frutos amarillos",
  "Croissant de chocolate",
  "Croissant de fresas con crema",
  "Croissant galleta",
  "Galleta de Cheesecake de fresa",
  "Galleta de Kit Kat",
  "Galleta de Limón",
  "Galleta de Maracuya (Pasión)",
  "Galleta de Nutella",
  "Galleta de Red velvet",
  "Galleta de coco arequipe",
  "Galleta de cookies and cream",
  "Galleta de leche Klim",
  "Galleta de pistacho",
  "Galleta pasionela (nueva)",
  "Muffins de limon",
  "Pavé de nutella",
  "Torta 3 leches",
  "Vasca",
  "torta de almojabana",
  "waffle de pandebono",
];

const names = (q: string) =>
  db.searchProducts(tenantId, q, 5).map((p) => p.name);

beforeAll(async () => {
  db = await import("./db");
  tenantId = db.createTenant("Cookliz test", `cookliz-test-${Date.now()}`).id;
  for (const n of COOKLIZ) db.createProduct(tenantId, n, 7000, 5);
});

describe("searchProducts", () => {
  it("encuentra el producto aunque el cliente agregue cómo es (caso Cookliz 2026-10-20)", () => {
    expect(names("tortas almojábana con bocadillo y queso")).toEqual([
      "torta de almojabana",
    ]);
  });

  it("no se traba con signos pegados a la palabra", () => {
    expect(names("Torta de Almojabana?")).toEqual(["torta de almojabana"]);
    expect(names("galleta nutella!")).toEqual(["Galleta de Nutella"]);
  });

  it("ignora el relleno típico del chat", () => {
    expect(names("tienen torta de almojabana")).toEqual([
      "torta de almojabana",
    ]);
    expect(names("me regala una galleta de pistacho porfa")).toEqual([
      "Galleta de pistacho",
    ]);
  });

  it("un mensaje sin nombre de producto no cae en uno por casualidad", () => {
    expect(names("No no quiero")).toEqual([]);
  });

  it("sigue resolviendo los pedidos de siempre", () => {
    expect(names("galleta Nutella")).toEqual(["Galleta de Nutella"]);
    expect(names("galleta maracuya")).toEqual([
      "Galleta de Maracuya (Pasión)",
    ]);
    expect(names("galleta limón")).toEqual(["Galleta de Limón"]);
  });

  it("no anota otro producto cuyo nombre solo aparece de modificador", () => {
    // El pedido es la de maracuyá; "Galleta de Nutella" no debe ganar.
    expect(names("galleta de maracuya con nutella")).toEqual([]);
    // Ni "Croissant de chocolate" ni ninguna galleta es "galleta de chocolate".
    expect(names("galleta de chocolate")).toEqual([]);
    // Casos reales de Cookliz que de verdad no existen.
    expect(names("torta de zanahoria")).toEqual([]);
    expect(names("torta de pandebono")).toEqual([]);
    expect(names("almojabana con bocadillo y queso")).toEqual([]);
  });

  it("no cae en un producto de una sola palabra que es un ingrediente", async () => {
    const t = db.createTenant("Otra", `otra-test-${Date.now()}`).id;
    db.createProduct(t, "Queso", 5000, 5);
    db.createProduct(t, "Almojábana", 3000, 5);
    db.createProduct(t, "Almojábana con queso", 4000, 5);
    const n = (q: string) => db.searchProducts(t, q, 5).map((p) => p.name);
    expect(n("pandebono con queso")).toEqual([]);
    // Si hay uno más específico que el pedido contiene entero, gana ese.
    expect(n("almojabana con queso y bocadillo")).toEqual([
      "Almojábana con queso",
    ]);
  });
});

describe("searchProductsLoose", () => {
  it("sigue sugiriendo la torta de almojábana para los casos del 2026-10-01", () => {
    const loose = (q: string) =>
      db.searchProductsLoose(tenantId, q, 3).map((p) => p.name);
    expect(loose("almojabana con bocadillo y queso")[0]).toBe(
      "torta de almojabana",
    );
    expect(loose("torta de pandebono")).toContain("torta de almojabana");
  });

  it("no se traba con signos pegados a la palabra", () => {
    const loose = db
      .searchProductsLoose(tenantId, "almojabana?", 3)
      .map((p) => p.name);
    expect(loose).toEqual(["torta de almojabana"]);
  });
});
