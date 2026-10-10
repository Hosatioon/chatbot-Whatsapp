import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const audioRoot = path.join(dataDir, "audio");

interface Ctx {
  params: Promise<{ path: string[] }>;
}

// Sirve las notas de voz de clientes guardadas por transcribeVoiceNote
// (data/audio/<tenantId>/<archivo>). Protegido por el middleware de auth
// normal (no está en PUBLIC_PATHS) — además cada tenant solo puede pedir
// las suyas, nunca las de otro negocio.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, isSuperAdmin } = await requireTenantId();
    const { path: segments } = await params;
    if (!segments || segments.length < 2) {
      return NextResponse.json({ error: "ruta inválida" }, { status: 400 });
    }
    const [tenantSegment, ...rest] = segments;
    const requestedTenantId = Number(tenantSegment);
    if (!Number.isInteger(requestedTenantId)) {
      return NextResponse.json({ error: "ruta inválida" }, { status: 400 });
    }
    if (!isSuperAdmin && requestedTenantId !== tenantId) {
      return NextResponse.json({ error: "no autorizado" }, { status: 403 });
    }
    const filename = rest.join("/");
    // El nombre viene de msg.key.id (nunca trae "/" ni ".."), pero no
    // confiamos en el request — bloqueamos cualquier intento de path
    // traversal explícitamente.
    if (filename.includes("..") || filename.includes("/")) {
      return NextResponse.json({ error: "ruta inválida" }, { status: 400 });
    }
    const filePath = path.join(
      audioRoot,
      String(requestedTenantId),
      filename,
    );
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "no encontrado" }, { status: 404 });
    }
    const buffer = fs.readFileSync(filePath);
    const contentType = filename.endsWith(".m4a") ? "audio/mp4" : "audio/ogg";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
