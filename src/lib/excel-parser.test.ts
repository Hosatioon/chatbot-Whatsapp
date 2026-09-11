import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseExcelFile,
  parseAllSheets,
  flattenMultiSheetResults,
  parsePriceValue,
} from "./excel-parser";

// Helper: arma un .xlsx real en memoria a partir de una matriz de filas
// (igual a como llegaría un archivo subido por un tenant) y lo pasa por
// el mismo parseExcelFile que usa la ruta de importación real.
function buildWorkbookBuffer(
  sheets: Record<string, (string | number)[][]>,
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

describe("parsePriceValue — formatos de precio colombianos y genéricos", () => {
  it("número plano", () => {
    expect(parsePriceValue(15000)).toBe(15000);
  });
  it("con símbolo de pesos y puntos de miles (formato CO)", () => {
    expect(parsePriceValue("$15.000")).toBe(15000);
    expect(parsePriceValue("$1.500.000")).toBe(1500000);
  });
  it("con coma decimal (formato CO/EU)", () => {
    expect(parsePriceValue("15000,50")).toBe(15001); // redondea
  });
  it("con coma de miles y punto decimal (formato US)", () => {
    expect(parsePriceValue("$1,500.00")).toBe(1500);
  });
  it("guion o vacío se trata como sin precio", () => {
    expect(parsePriceValue("-")).toBeNull();
    expect(parsePriceValue("")).toBeNull();
    expect(parsePriceValue(null)).toBeNull();
  });
  it("texto no numérico no rompe, devuelve null", () => {
    expect(parsePriceValue("consultar")).toBeNull();
  });
});

describe("parseExcelFile — formato simple (nombre, precio, stock)", () => {
  it("importa productos básicos correctamente", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Nombre", "Precio", "Stock"],
        ["Galleta de Nutella", 8000, 20],
        ["Galleta de Maracuyá", "$8.000", 15],
        ["Waffle de pandebono", "20000", 5],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products).toHaveLength(3);
    expect(result.products[0]).toMatchObject({
      name: "Galleta de Nutella",
      basePrice: 8000,
      stock: 20,
    });
  });

  it("reconoce la columna de stock cuando el header matchea un alias", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Producto", "Precio", "Cantidad"],
        ["Torta de chocolate", 45000, 3],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products[0].stock).toBe(3);
  });

  it("filas completamente vacías se ignoran", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Nombre", "Precio"],
        ["Producto A", 1000],
        ["", ""],
        ["Producto B", 2000],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products.map((p) => p.name)).toEqual([
      "Producto A",
      "Producto B",
    ]);
  });

  it("fila sin nombre se descarta aunque tenga precio", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Nombre", "Precio"],
        ["", 5000],
        ["Producto válido", 3000],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe("Producto válido");
  });

  it("encuentra el header aunque no esté en la primera fila", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Catálogo Cookliz - Septiembre 2026"],
        [],
        ["Nombre", "Precio", "Stock"],
        ["Brownie", 7000, 10],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ name: "Brownie", basePrice: 7000 });
  });

  it("sin columna de nombre reconocible, usa la primera columna de texto como fallback", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Item", "Valor"],
        ["Café americano", 4500],
      ],
    });
    const result = parseExcelFile(buf);
    // "Item" SÍ está en NAME_ALIASES, así que esto valida el alias además
    // del fallback — probamos el fallback real con un header desconocido:
    expect(result.products[0].name).toBe("Café americano");
  });

  it("fallback real: header de nombre completamente desconocido", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["XYZ123", "Precio"],
        ["Empanada de pollo", 3500],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products[0].name).toBe("Empanada de pollo");
  });
});

describe("parseExcelFile — formato ancho (una columna de precio por variante)", () => {
  it("agrupa columnas 'Precio Talla X' como variantes del mismo producto", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Nombre", "Precio Talla S", "Precio Talla M", "Precio Talla L"],
        ["Camiseta básica", 30000, 32000, 35000],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.detectedArchitecture).toMatch(/^wide_format/);
    expect(result.products).toHaveLength(1);
    const p = result.products[0];
    expect(p.variants).toHaveLength(3);
    expect(p.variants.map((v) => v.price)).toEqual([30000, 32000, 35000]);
    expect(p.basePrice).toBe(30000); // primera variante
  });
});

describe("parseExcelFile — formato alto (columna de variante + precio compartido)", () => {
  it("agrupa filas repetidas del mismo producto por nombre, una variante por fila", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Producto", "Talla", "Precio"],
        ["Camiseta básica", "S", 30000],
        ["Camiseta básica", "M", 32000],
        ["Camiseta básica", "L", 35000],
        ["Gorra", "Único", 15000],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.detectedArchitecture).toMatch(/^tall_format/);
    expect(result.products).toHaveLength(2);
    const camiseta = result.products.find((p) => p.name === "Camiseta básica");
    expect(camiseta?.variants).toHaveLength(3);
    const gorra = result.products.find((p) => p.name === "Gorra");
    expect(gorra?.variants).toHaveLength(1);
  });
});

describe("parseExcelFile — descripción", () => {
  it("captura la columna de descripción cuando existe", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [
        ["Nombre", "Descripción", "Precio"],
        ["Galleta artesanal", "Hecha con mantequilla real", 9000],
      ],
    });
    const result = parseExcelFile(buf);
    expect(result.products[0].description).toBe("Hecha con mantequilla real");
    expect(result.detectedArchitecture).toBe("name_description_price");
  });
});

describe("parseAllSheets / flattenMultiSheetResults", () => {
  it("procesa cada hoja del archivo y junta los productos de todas", () => {
    const buf = buildWorkbookBuffer({
      Postres: [
        ["Nombre", "Precio"],
        ["Cheesecake", 12000],
      ],
      Bebidas: [
        ["Nombre", "Precio"],
        ["Limonada", 6000],
        ["Café", 4000],
      ],
    });
    const results = parseAllSheets(buf);
    expect(results).toHaveLength(2);
    const flat = flattenMultiSheetResults(results);
    expect(flat).toHaveLength(3);
    expect(flat.map((p) => p.name).sort()).toEqual([
      "Café",
      "Cheesecake",
      "Limonada",
    ]);
  });
});

describe("parseExcelFile — hoja/índice inválido", () => {
  it("lanza un error legible si la hoja pedida no existe", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [["Nombre", "Precio"], ["A", 1000]],
    });
    expect(() => parseExcelFile(buf, { sheetName: "NoExiste" })).toThrow(
      /no encontrada/i,
    );
  });

  it("lanza un error legible si el índice de hoja está fuera de rango", () => {
    const buf = buildWorkbookBuffer({
      Hoja1: [["Nombre", "Precio"], ["A", 1000]],
    });
    expect(() => parseExcelFile(buf, { sheetIndex: 5 })).toThrow(
      /fuera de rango/i,
    );
  });
});
