/**
 * Carga variables de entorno desde .env.local
 * Este file DEBE ser el primer import en cualquier script que use env vars.
 */

import path from "node:path";
import fs from "node:fs";

const envPath = path.resolve(process.cwd(), ".env.local");

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remover comillas si existen
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }

  console.log(`[env] Cargadas variables desde ${envPath}`);
} else {
  console.warn(`[env] .env.local no encontrado en ${envPath}`);
}
