import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { setConnectionState } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  // 1. Marcar estado disconnected en DB
  setConnectionState({
    status: "disconnected",
    qr_string: null,
    phone: null,
  });

  // 2. Borrar carpeta auth/
  const authDir = path.resolve(process.cwd(), "auth");
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch (err) {
    console.warn("[api] No se pudo borrar auth/:", err);
  }

  // 3. Crear flag de restart para que el bot reinicie su socket
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, ".restart"), "");

  return NextResponse.json({ ok: true });
}
