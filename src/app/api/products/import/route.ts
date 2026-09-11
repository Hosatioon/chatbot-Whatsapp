import { NextRequest, NextResponse } from "next/server";
import { parseExcelFile, parseAllSheets, flattenMultiSheetResults, ParsedProduct } from "@/lib/excel-parser";
import { createProduct, listProducts, updateProduct } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { assertSafeExternalUrl } from "@/lib/url-safety";

export const dynamic = "force-dynamic";

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// BUG DE SEGURIDAD real encontrado (2026-09-11): este GET no pedía
// autenticación y hacía fetch() a CUALQUIER url que le pasaran por query
// string — un SSRF clásico. Cualquiera (sin login) podía usar este
// endpoint para que el servidor hiciera peticiones a su red interna
// (ej: metadata del proveedor cloud, redis, otros servicios internos) o
// como proxy abierto. Ahora exige sesión y bloquea IPs privadas/internas
// (ver src/lib/url-safety.ts, compartido con la generación de link
// preview del bot que se agregó por el mismo motivo).

interface ImportOptions {
  mode: "merge" | "replace";
  importAllSheets?: boolean;
  targetSheet?: string;
}

interface ImportResult {
  success: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; name: string; error: string }[];
  sheets: SheetResult[];
  detectedArchitecture: string;
}

interface SheetResult {
  sheetName: string;
  productsFound: number;
  headerRow: number;
  columns: { header: string; type: string; variantLabel?: string }[];
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantId();
    const formData = await request.formData();
    const file = formData.get("file");
    const mode = (formData.get("mode") as ImportOptions["mode"]) || "merge";
    const importAllSheets = formData.get("importAllSheets") === "true";
    const targetSheet = formData.get("targetSheet") as string | null;

    const requestedTenantId = formData.get("tenantId");
    let tenantId = auth.tenantId;
    if (auth.isSuperAdmin && requestedTenantId) {
      const t = Number(requestedTenantId);
      if (!isNaN(t) && t > 0) tenantId = t;
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Falta el archivo (campo 'file')" },
        { status: 400 }
      );
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el tamaño máximo permitido (10MB)" },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    let parsedResults;
    if (importAllSheets) {
      parsedResults = parseAllSheets(arrayBuffer);
    } else if (targetSheet) {
      parsedResults = [parseExcelFile(arrayBuffer, { sheetName: targetSheet })];
    } else {
      parsedResults = [parseExcelFile(arrayBuffer, { sheetIndex: 0 })];
    }

    const allProducts = flattenMultiSheetResults(parsedResults);

    if (allProducts.length === 0) {
      return NextResponse.json(
        {
          error: "No se encontraron productos válidos en el archivo",
          tips: [
            "Asegúrate de que haya una fila de encabezados (nombre, precio, etc.)",
            "Verifica que los datos no estén en una hoja diferente",
            "Prueba marcando 'Importar todas las hojas'",
          ],
          availableSheets: parsedResults.map((r) => ({
            name: r.sheetName,
            productsFound: r.products.length,
          })),
        },
        { status: 400 }
      );
    }

    const existing = listProducts(tenantId);
    const byName = new Map(
      existing.map((p) => [p.name.toLowerCase().trim(), p])
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: { row: number; name: string; error: string }[] = [];

    for (const item of allProducts) {
      try {
        const key = item.name.toLowerCase().trim();
        const existingProduct = byName.get(key);

        if (existingProduct) {
          if (mode === "replace") {
            skipped++;
            continue;
          }
          updateProduct(
            tenantId,
            existingProduct.id,
            item.name,
            item.basePrice,
            item.stock,
            item.description,
            item.variants.length > 0 ? item.variants : null
          );
          updated++;
        } else {
          createProduct(
            tenantId,
            item.name,
            item.basePrice,
            item.stock,
            item.description,
            item.variants.length > 0 ? item.variants : null
          );
          created++;
        }
      } catch (err) {
        errors.push({
          row: item.row,
          name: item.name,
          error: err instanceof Error ? err.message : "Error desconocido",
        });
      }
    }

    const sheetsInfo: SheetResult[] = parsedResults.map((r) => ({
      sheetName: r.sheetName,
      productsFound: r.products.length,
      headerRow: r.headerRow,
      columns: r.columns.map((c) => ({
        header: c.originalHeader,
        type: c.type,
        variantLabel: c.variantLabel,
      })),
    }));

    const uniqueArchitectures = new Set(parsedResults.map((r) => r.detectedArchitecture));

    const result: ImportResult = {
      success: true,
      total: allProducts.length,
      created,
      updated,
      skipped,
      errors,
      sheets: sheetsInfo,
      detectedArchitecture: Array.from(uniqueArchitectures).join(" | "),
    };

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const tips: string[] = [];

    if (errorMessage.includes("no encontrada")) {
      tips.push("Verifica el nombre de la hoja seleccionada");
    } else if (errorMessage.includes("fuera de rango")) {
      tips.push("El índice de hoja no existe. Usa sheetIndex 0 para la primera hoja");
    } else if (errorMessage.includes("no se encontraron")) {
      tips.push("Revisa que el archivo tenga datos en la primera fila");
    }

    console.error("Error importing products:", error);
    return NextResponse.json(
      {
        error: "Error procesando el archivo",
        details: errorMessage,
        tips,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireTenantId();
    const { searchParams } = new URL(request.url);
    const fileUrl = searchParams.get("url");

    if (!fileUrl) {
      return NextResponse.json(
        { error: "Falta el parámetro 'url'" },
        { status: 400 }
      );
    }

    try {
      await assertSafeExternalUrl(fileUrl);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "URL no permitida" },
        { status: 400 },
      );
    }

    const response = await fetch(fileUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "No se pudo descargar el archivo" },
        { status: 400 }
      );
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el tamaño máximo permitido (10MB)" },
        { status: 413 },
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el tamaño máximo permitido (10MB)" },
        { status: 413 },
      );
    }
    const results = parseAllSheets(arrayBuffer);

    const preview = results.map((r) => ({
      sheetName: r.sheetName,
      totalRows: r.totalRows,
      headerRow: r.headerRow,
      detectedArchitecture: r.detectedArchitecture,
      columns: r.columns.map((c) => ({
        header: c.originalHeader,
        type: c.type,
        variantLabel: c.variantLabel,
      })),
      sampleProducts: r.products.slice(0, 3).map((p) => ({
        name: p.name,
        description: p.description,
        basePrice: p.basePrice,
        variants: p.variants,
      })),
    }));

    return NextResponse.json({ success: true, preview });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Error previewing file:", error);
    return NextResponse.json(
      {
        error: "Error previsualizando el archivo",
        details: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 }
    );
  }
}
