import * as XLSX from "xlsx";

export interface ProductVariant {
  name: string;
  price: number;
  stock?: number;
}

export interface ParsedProduct {
  name: string;
  description: string | null;
  basePrice: number;
  stock: number;
  variants: ProductVariant[];
  row: number;
}

export interface ColumnType {
  type:
    | "name"
    | "description"
    | "price"
    | "stock"
    | "variant"
    | "variantKey"
    | "unknown";
  originalHeader: string;
  normalizedHeader: string;
  variantLabel?: string;
}

export interface ParseResult {
  products: ParsedProduct[];
  columns: ColumnType[];
  sheetName: string;
  headerRow: number;
  totalRows: number;
  detectedArchitecture: string;
}

const NAME_ALIASES = new Set([
  "name",
  "nombre",
  "producto",
  "product",
  "item",
  "articulo",
  "servicio",
  "service",
  "denominacion",
  "titulo",
  "title",
]);

const DESCRIPTION_ALIASES = new Set([
  "descripcion",
  "description",
  "detalle",
  "detalles",
  "info",
  "informacion",
  "notas",
  "notes",
  "observaciones",
  "caracteristicas",
  "features",
]);

const STOCK_ALIASES = new Set([
  "stock",
  "cantidad",
  "qty",
  "quantity",
  "existencia",
  "inventario",
  "unidades",
  "disp",
  "disponible",
]);

const VARIANT_KEY_ALIASES = new Set([
  "tipo",
  "tipo de vehiculo",
  "tipo de producto",
  "variante",
  "variant",
  "size",
  "talla",
  "color",
  "modelo",
  "categoria",
  "category",
]);

const VARIANT_VALUE_SET = new Set([
  "automovil",
  "camioneta",
  "camioneta grande",
  "suv",
  "talla s",
  "talla m",
  "talla l",
  "talla xl",
  "chico",
  "mediano",
  "grande",
  "rojo",
  "azul",
  "verde",
  "negro",
  "blanco",
]);

function isVariantValue(value: any): boolean {
  if (value == null || value === "") return false;
  const norm = normalize(String(value));
  if (VARIANT_VALUE_SET.has(norm)) return true;
  if (norm.includes("talla") || norm.includes("size")) return true;
  if (norm.includes("color")) return true;
  if (norm.includes("modelo")) return true;
  return false;
}

const CURRENCY_SYMBOLS = ["$", "€", "£", "¥", "COP", "USD", "COL", "MXN"];
const CURRENCY_REGEX = new RegExp(
  `^[${CURRENCY_SYMBOLS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")}]?\\s*`,
  "i",
);

function normalize(str: string): string {
  return str
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyHeader(value: any): boolean {
  if (value == null || value === "") return false;
  const str = String(value).toString().trim();
  if (str.length < 2 || str.length > 100) return false;
  if (/^\d+([.,]\d+)*$/.test(str)) return false;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(str)) return false;
  return true;
}

function analyzeColumnType(header: string, values: any[]): ColumnType {
  const norm = normalize(header);

  if (NAME_ALIASES.has(norm)) {
    return { type: "name", originalHeader: header, normalizedHeader: norm };
  }

  if (DESCRIPTION_ALIASES.has(norm)) {
    return {
      type: "description",
      originalHeader: header,
      normalizedHeader: norm,
    };
  }

  if (STOCK_ALIASES.has(norm)) {
    return { type: "stock", originalHeader: header, normalizedHeader: norm };
  }

  if (VARIANT_KEY_ALIASES.has(norm)) {
    return {
      type: "variantKey",
      originalHeader: header,
      normalizedHeader: norm,
    };
  }

  const sampleNonEmpty = values
    .filter((v) => v != null && v !== "")
    .slice(0, 5);
  const hasVariantValues = sampleNonEmpty.some((v) => isVariantValue(v));
  if (hasVariantValues && sampleNonEmpty.length >= 3) {
    return {
      type: "variantKey",
      originalHeader: header,
      normalizedHeader: norm,
    };
  }

  const priceIndicators = [
    "precio",
    "price",
    "valor",
    "cost",
    "costo",
    "tarifa",
    "valor_unitario",
  ];

  // BUG real encontrado (2026-09-11, con test automatizado): una columna
  // que se llama EXACTAMENTE "Precio" (el caso más común y simple —
  // Nombre/Precio/Stock) caía en el mismo bucle de abajo que "Precio
  // Talla S" y se clasificaba como "variant" con etiqueta "Precio" —
  // cada producto terminaba con una variante rara llamada "Precio" en
  // vez de un precio base simple. `type: "price"` existía en el tipo
  // ColumnType y hasta se usaba más abajo (`priceColIdx`), pero nunca se
  // asignaba de verdad. Ahora, si el header ES el indicador (sin nada
  // más alrededor), es precio simple; solo se vuelve "variant" cuando
  // trae texto adicional (ej: "Precio Talla S").
  if (priceIndicators.includes(norm)) {
    return { type: "price", originalHeader: header, normalizedHeader: norm };
  }

  for (const indicator of priceIndicators) {
    if (norm.includes(indicator)) {
      const variantLabel = norm
        .replace(indicator, "")
        .replace(/[_\s-]+/g, " ")
        .trim();
      return {
        type: "variant",
        originalHeader: header,
        normalizedHeader: norm,
        variantLabel: variantLabel || header,
      };
    }
  }

  const allNumeric = sampleNonEmpty.every((v) => {
    const cleaned = parsePriceValue(v);
    return cleaned !== null;
  });

  if (allNumeric && sampleNonEmpty.length > 0) {
    const firstVal = sampleNonEmpty[0];
    if (typeof firstVal === "number" || /^\$/.test(String(firstVal))) {
      const variantLabel = norm || header;
      return {
        type: "variant",
        originalHeader: header,
        normalizedHeader: norm,
        variantLabel,
      };
    }
  }

  return { type: "unknown", originalHeader: header, normalizedHeader: norm };
}

export function parsePriceValue(value: any): number | null {
  if (value == null || value === "" || value === "-") return null;
  if (typeof value === "number") return Math.round(value);

  const str = String(value).trim();
  if (!str) return null;

  const cleaned = str.replace(CURRENCY_REGEX, "").replace(/[^\d.,\-]/g, "");

  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let result: string;
  if (hasComma && hasDot) {
    // BUG real encontrado (2026-09-11, con test automatizado): esto
    // asumía SIEMPRE formato europeo/colombiano (punto=miles,
    // coma=decimal) aunque el archivo trajera formato US
    // (coma=miles, punto=decimal, ej: "$1,500.00"). El separador que
    // aparece MÁS A LA DERECHA es el decimal en ambas convenciones —
    // eso es lo que hay que mirar, no asumir un formato fijo.
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // "1.500,50" (CO/EU): el punto es separador de miles, la coma es decimal
      result = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // "1,500.50" (US): la coma es separador de miles, el punto es decimal
      result = cleaned.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length === 3) {
      result = cleaned.replace(/,/g, "");
    } else {
      result = cleaned.replace(",", ".");
    }
  } else if (hasDot && !hasComma) {
    const dotParts = cleaned.split(".");
    if (
      dotParts.length === 2 &&
      dotParts[1].length === 3 &&
      dotParts[0].length <= 3
    ) {
      // BUG real encontrado (2026-09-11, con test automatizado): acá
      // decía `/./g` (regex "cualquier carácter") en vez de `/\./g`
      // ("el punto literal") — borraba TODO el número, no solo el
      // punto. Este es el formato más común en Colombia ("$15.000",
      // "$8.000"), así que este bug hacía que la mayoría de precios
      // colombianos con punto de miles se importaran como null/0.
      result = cleaned.replace(/\./g, "");
    } else if (dotParts.length > 2) {
      result = cleaned.replace(/\./g, "");
    } else {
      result = cleaned;
    }
  } else {
    result = cleaned;
  }

  const num = parseFloat(result);
  return isNaN(num) ? null : Math.round(num);
}

function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const maxRows = Math.min(range.e.r, 20);

  for (let r = 0; r <= maxRows; r++) {
    const row: any[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell?.v);
    }
    const nonEmpty = row.filter((v) => v != null && v !== "");
    if (nonEmpty.length >= 2) {
      const headerLikeness = nonEmpty.filter((v) => isLikelyHeader(v)).length;
      if (headerLikeness / nonEmpty.length >= 0.5) {
        return r;
      }
    }
  }
  return 0;
}

export function parseExcelFile(
  fileBuffer: ArrayBuffer,
  options?: { sheetIndex?: number; sheetName?: string },
): ParseResult {
  const workbook = XLSX.read(fileBuffer, { type: "array" });

  let sheet: XLSX.WorkSheet;
  let sheetName: string;

  if (options?.sheetName) {
    if (workbook.SheetNames.includes(options.sheetName)) {
      sheet = workbook.Sheets[options.sheetName];
      sheetName = options.sheetName;
    } else {
      throw new Error(
        `Hoja "${options.sheetName}" no encontrada. Hojas disponibles: ${workbook.SheetNames.join(", ")}`,
      );
    }
  } else {
    const sheetIndex = options?.sheetIndex ?? 0;
    if (sheetIndex >= workbook.SheetNames.length) {
      throw new Error(
        `Índice de hoja ${sheetIndex} fuera de rango. Hojas disponibles: ${workbook.SheetNames.length}`,
      );
    }
    sheetName = workbook.SheetNames[sheetIndex];
    sheet = workbook.Sheets[sheetName];
  }

  const headerRow = findHeaderRow(sheet);
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");

  const rawHeaders: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    rawHeaders.push(cell?.v != null ? String(cell.v) : "");
  }

  const dataStartRow = headerRow + 1;
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: rawHeaders,
    defval: "",
    raw: false,
    range: dataStartRow,
  }) as unknown[];
  const rows = rawRows.filter((row: any) => {
    const vals = Object.values(row);
    return vals.some((v) => v != null && v !== "");
  }) as Record<string, any>[];

  const sampleRow = rows[0] || {};
  const columns: ColumnType[] = rawHeaders.map((h, i) => {
    const values = rows.map((r) => r[rawHeaders[i]]);
    return analyzeColumnType(h, values);
  });

  const nameColIdx = columns.findIndex((c) => c.type === "name");
  const descColIdx = columns.findIndex((c) => c.type === "description");
  const stockColIdx = columns.findIndex((c) => c.type === "stock");
  const simplePriceColIdx = columns.findIndex((c) => c.type === "price");
  const variantKeyColIdx = columns.findIndex((c) => c.type === "variantKey");
  const variantCols = columns
    .map((c, i) => ({ col: c, idx: i }))
    .filter(({ col }) => col.type === "variant");

  if (nameColIdx === -1) {
    const firstTextCol = columns.findIndex(
      (c, i) => i < columns.length && c.type === "unknown",
    );
    if (firstTextCol !== -1) {
      columns[firstTextCol] = {
        type: "name",
        originalHeader: rawHeaders[firstTextCol],
        normalizedHeader: normalize(rawHeaders[firstTextCol]),
      };
    }
  }

  const finalNameIdx = columns.findIndex((c) => c.type === "name");

  let products: ParsedProduct[];

  if (variantKeyColIdx !== -1) {
    const priceColIdx = columns.findIndex((c) => c.type === "price");
    const variantPriceColIdx = variantCols.length > 0 ? variantCols[0].idx : -1;
    const unknownPriceColIdx = columns.findIndex(
      (c, i) =>
        c.type === "unknown" &&
        i !== finalNameIdx &&
        i !== descColIdx &&
        i !== variantKeyColIdx,
    );
    const effectivePriceColIdx =
      priceColIdx !== -1
        ? priceColIdx
        : variantPriceColIdx !== -1
          ? variantPriceColIdx
          : unknownPriceColIdx;

    const grouped = new Map<
      string,
      {
        name: string;
        description: string | null;
        stock: number;
        variants: Map<string, number>;
        firstRow: number;
      }
    >();

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const name = String(row[rawHeaders[finalNameIdx]] ?? "").trim();
      if (!name) continue;

      const description =
        descColIdx !== -1
          ? String(row[rawHeaders[descColIdx]] ?? "").trim() || null
          : null;

      const variantKey = String(row[rawHeaders[variantKeyColIdx]] ?? "").trim();
      const price =
        effectivePriceColIdx !== -1
          ? (parsePriceValue(row[rawHeaders[effectivePriceColIdx]]) ?? 0)
          : 0;

      if (!grouped.has(name)) {
        grouped.set(name, {
          name,
          description,
          stock: 1,
          variants: new Map(),
          firstRow: headerRow + 2 + rowIdx,
        });
      }

      const existing = grouped.get(name)!;
      if (description && !existing.description) {
        existing.description = description;
      }
      if (variantKey && price > 0) {
        existing.variants.set(variantKey, price);
      }
    }

    products = Array.from(grouped.values()).map((g) => {
      const variants: ProductVariant[] = Array.from(g.variants.entries()).map(
        ([key, val]) => ({
          name: key,
          price: val,
          stock: 1,
        }),
      );

      return {
        name: g.name,
        description: g.description,
        basePrice: variants.length > 0 ? variants[0].price : 0,
        stock: g.stock,
        variants,
        row: g.firstRow,
      };
    });
  } else {
    products = rows
      .map((row, rowIdx) => {
        const name =
          finalNameIdx !== -1
            ? String(row[rawHeaders[finalNameIdx]] ?? "").trim()
            : "";
        if (!name) return null;

        const description =
          descColIdx !== -1
            ? String(row[rawHeaders[descColIdx]] ?? "").trim() || null
            : null;

        const stock =
          stockColIdx !== -1
            ? (parsePriceValue(row[rawHeaders[stockColIdx]]) ?? 0)
            : 0;

        const variants: ProductVariant[] = variantCols.map(({ idx }) => {
          const col = columns[idx];
          const price = parsePriceValue(row[rawHeaders[idx]]);
          return {
            name: col.variantLabel || rawHeaders[idx],
            price: price ?? 0,
            stock: stock > 0 ? 1 : 0,
          };
        });

        let basePrice = 0;
        if (simplePriceColIdx !== -1) {
          basePrice = parsePriceValue(row[rawHeaders[simplePriceColIdx]]) ?? 0;
        } else if (variants.length > 0) {
          basePrice = variants[0].price;
        } else {
          const priceCols = columns
            .map((c, i) => ({ col: c, idx: i }))
            .filter(({ col }) => col.type === "unknown");
          for (const { idx } of priceCols) {
            const price = parsePriceValue(row[rawHeaders[idx]]);
            if (price !== null && price > 0) {
              basePrice = price;
              break;
            }
          }
        }

        return {
          name,
          description,
          basePrice,
          stock,
          variants,
          row: headerRow + 2 + rowIdx,
        };
      })
      .filter((p): p is ParsedProduct => p !== null);
  }

  let detectedArchitecture = "simple";
  if (variantKeyColIdx !== -1) {
    const variantKeys = rows
      .map((r) => String(r[rawHeaders[variantKeyColIdx]] ?? "").trim())
      .filter((v) => v.length > 0);
    const uniqueKeys = [...new Set(variantKeys)];
    detectedArchitecture = `tall_format:${uniqueKeys.join(",")}`;
  } else if (variantCols.length > 0) {
    const variantNames = variantCols.map((v) => v.col.variantLabel).join(", ");
    detectedArchitecture = `wide_format:${variantNames}`;
  } else if (descColIdx !== -1) {
    detectedArchitecture = "name_description_price";
  } else {
    detectedArchitecture = "name_price";
  }

  return {
    products,
    columns,
    sheetName,
    headerRow: headerRow + 1,
    totalRows: rows.length,
    detectedArchitecture,
  };
}

export function parseAllSheets(fileBuffer: ArrayBuffer): ParseResult[] {
  const workbook = XLSX.read(fileBuffer, { type: "array" });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const result = parseExcelFile(fileBuffer, { sheetName: name });
    return result;
  });
}

export function flattenMultiSheetResults(
  results: ParseResult[],
): ParsedProduct[] {
  return results.flatMap((r) => r.products);
}
