import "./env-loader";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const DATA_DIR = path.resolve(process.cwd(), "data");
const BACKUP_DIR = path.resolve(process.cwd(), "data", "backups");
const DB_PATH = path.join(DATA_DIR, "messages.db");

const MAX_BACKUPS = parseInt(process.env.BACKUP_MAX_FILES || "14", 10);

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function createBackup(): string | null {
  if (!fs.existsSync(DB_PATH)) {
    console.warn("[backup] No se encontró messages.db, saltando backup");
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `messages-${timestamp}.db`);

  try {
    // Usar .backup de SQLite que es seguro para DB en uso
    execSync(`sqlite3 "${DB_PATH}" ".backup '${backupPath}'"`, {
      stdio: "pipe",
      timeout: 30000,
    });

    if (!fs.existsSync(backupPath)) {
      console.error("[backup] El archivo de backup no se creó");
      return null;
    }

    const sizeKB = Math.round(fs.statSync(backupPath).size / 1024);
    console.log(
      `[backup] Backup creado: ${path.basename(backupPath)} (${sizeKB} KB)`,
    );
    return backupPath;
  } catch (err) {
    console.error("[backup] Error creando backup:", err);
    return null;
  }
}

function pruneOldBackups(): void {
  if (!fs.existsSync(BACKUP_DIR)) return;

  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("messages-") && f.endsWith(".db"))
    .map((f) => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (files.length <= MAX_BACKUPS) return;

  const toDelete = files.slice(MAX_BACKUPS);
  for (const f of toDelete) {
    try {
      fs.unlinkSync(f.path);
      console.log(`[backup] Eliminado backup antiguo: ${f.name}`);
    } catch (err) {
      console.warn(`[backup] No se pudo eliminar ${f.name}:`, err);
    }
  }
}

function runBackupCycle(): void {
  console.log("[backup] Iniciando ciclo de backup...");
  ensureBackupDir();
  const created = createBackup();
  if (created) {
    pruneOldBackups();
  }
  console.log("[backup] Ciclo completado");
}

export { runBackupCycle, createBackup, pruneOldBackups, BACKUP_DIR };
