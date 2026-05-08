import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Mode = "AI" | "HUMAN";
export type Role = "user" | "assistant" | "human";
export type ConnectionStatus =
  | "disconnected"
  | "qr"
  | "connecting"
  | "connected";

export interface Conversation {
  id: number;
  phone: string;
  // JID completo de WhatsApp (ej: "549...@s.whatsapp.net" o "...@lid").
  // Necesario para poder enviar respuestas a contactos que usan Linked ID
  // (donde el "phone" guardado no se puede convertir a un JID público).
  // Null para conversaciones legacy creadas antes de la migración.
  jid: string | null;
  name: string | null;
  mode: Mode;
  last_message_at: number | null;
  created_at: number;
}

export interface ConversationListItem extends Conversation {
  last_message_preview: string | null;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: Role;
  content: string;
  created_at: number;
}

export interface ConnectionState {
  id: number;
  status: ConnectionStatus;
  qr_string: string | null;
  phone: string | null;
  updated_at: number;
}

export interface OutboxItem {
  id: number;
  conversation_id: number;
  phone: string;
  // JID completo destinatario. Si es null, se reconstruye con
  // `${phone}@s.whatsapp.net` por compatibilidad con outbox legacy.
  remote_jid: string | null;
  content: string;
  sent: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Inicialización (singleton entre procesos — cada proceso abre el archivo
// y comparte via WAL)
// ---------------------------------------------------------------------------

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "messages.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    mode TEXT CHECK(mode IN ('AI','HUMAN')) NOT NULL DEFAULT 'AI',
    last_message_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT CHECK(role IN ('user','assistant','human')) NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv
    ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS connection_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT CHECK(status IN ('disconnected','qr','connecting','connected'))
      NOT NULL DEFAULT 'disconnected',
    qr_string TEXT,
    phone TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  INSERT OR IGNORE INTO connection_state (id, status) VALUES (1, 'disconnected');

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    content TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox(sent, created_at);
`);

// Migración idempotente: agregar columna `jid` a conversations y
// `remote_jid` a outbox si no existen. SQLite no soporta IF NOT EXISTS en
// ALTER ADD COLUMN, así que chequeamos via PRAGMA table_info.
function columnExists(table: string, column: string): boolean {
  const rows = db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all();
  return rows.some((r) => r.name === column);
}
if (!columnExists("conversations", "jid")) {
  db.exec(`ALTER TABLE conversations ADD COLUMN jid TEXT`);
}
if (!columnExists("outbox", "remote_jid")) {
  db.exec(`ALTER TABLE outbox ADD COLUMN remote_jid TEXT`);
}

export default db;

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

const stmtGetConvoByPhone = db.prepare<[string], Conversation>(
  "SELECT * FROM conversations WHERE phone = ?",
);
const stmtInsertConvo = db.prepare<[string, string | null, string | null]>(
  "INSERT INTO conversations (phone, name, jid) VALUES (?, ?, ?)",
);
const stmtUpdateConvoName = db.prepare<[string, number]>(
  "UPDATE conversations SET name = ? WHERE id = ?",
);
const stmtUpdateConvoJid = db.prepare<[string, number]>(
  "UPDATE conversations SET jid = ? WHERE id = ?",
);
const stmtGetConvoById = db.prepare<[number], Conversation>(
  "SELECT * FROM conversations WHERE id = ?",
);

export function getOrCreateConversation(
  phone: string,
  name?: string | null,
  jid?: string | null,
): Conversation {
  const existing = stmtGetConvoByPhone.get(phone);
  if (existing) {
    let updated = existing;
    if (name && name !== existing.name) {
      stmtUpdateConvoName.run(name, existing.id);
      updated = { ...updated, name };
    }
    // Backfill: si la convo existía sin jid (legacy) o cambió, actualizar.
    if (jid && jid !== existing.jid) {
      stmtUpdateConvoJid.run(jid, existing.id);
      updated = { ...updated, jid };
    }
    return updated;
  }
  const info = stmtInsertConvo.run(phone, name ?? null, jid ?? null);
  const created = stmtGetConvoById.get(Number(info.lastInsertRowid));
  if (!created) throw new Error("No se pudo crear la conversación");
  return created;
}

export function getConversationById(id: number): Conversation | null {
  return stmtGetConvoById.get(id) ?? null;
}

const stmtListConvos = db.prepare<[], ConversationListItem>(`
  SELECT c.*,
    (SELECT content FROM messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC
       LIMIT 1) AS last_message_preview
  FROM conversations c
  ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
`);

export function listConversations(): ConversationListItem[] {
  return stmtListConvos.all();
}

const stmtSetMode = db.prepare<[Mode, number]>(
  "UPDATE conversations SET mode = ? WHERE id = ?",
);

export function setMode(conversationId: number, mode: Mode): void {
  stmtSetMode.run(mode, conversationId);
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

const stmtInsertMessage = db.prepare<[number, Role, string]>(
  "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
);
const stmtTouchConvo = db.prepare<[number]>(
  "UPDATE conversations SET last_message_at = unixepoch() WHERE id = ?",
);

const txInsertMessage = db.transaction(
  (conversationId: number, role: Role, content: string): number => {
    const info = stmtInsertMessage.run(conversationId, role, content);
    stmtTouchConvo.run(conversationId);
    return Number(info.lastInsertRowid);
  },
);

export function insertMessage(
  conversationId: number,
  role: Role,
  content: string,
): number {
  return txInsertMessage(conversationId, role, content);
}

const stmtGetMessages = db.prepare<[number, number], Message>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
);

export function getMessages(conversationId: number, limit = 50): Message[] {
  return stmtGetMessages.all(conversationId, limit);
}

const stmtGetRecent = db.prepare<[number, number], Message>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
);

export function getRecentHistory(
  conversationId: number,
  limit = 20,
): Message[] {
  const rows = stmtGetRecent.all(conversationId, limit);
  return rows.reverse();
}

// ---------------------------------------------------------------------------
// Estado de conexión
// ---------------------------------------------------------------------------

const stmtGetConnState = db.prepare<[], ConnectionState>(
  "SELECT * FROM connection_state WHERE id = 1",
);

export function getConnectionState(): ConnectionState {
  const row = stmtGetConnState.get();
  if (!row) {
    // Defensivo: re-insertar si alguien borró la fila
    db.prepare(
      "INSERT INTO connection_state (id, status) VALUES (1, 'disconnected')",
    ).run();
    return stmtGetConnState.get()!;
  }
  return row;
}

export interface SetConnectionStateInput {
  status?: ConnectionStatus;
  qr_string?: string | null;
  phone?: string | null;
}

/**
 * Actualización parcial: campos ausentes del objeto NO se modifican.
 * Para borrar un campo, pasa explícitamente `null`.
 */
export function setConnectionState(input: SetConnectionStateInput): void {
  const current = getConnectionState();
  const next: ConnectionState = {
    ...current,
    status: input.status ?? current.status,
    qr_string:
      input.qr_string === undefined ? current.qr_string : input.qr_string,
    phone: input.phone === undefined ? current.phone : input.phone,
    updated_at: Math.floor(Date.now() / 1000),
  };
  db.prepare(
    `UPDATE connection_state
     SET status = ?, qr_string = ?, phone = ?, updated_at = ?
     WHERE id = 1`,
  ).run(next.status, next.qr_string, next.phone, next.updated_at);
}

// ---------------------------------------------------------------------------
// Outbox (mensajes del dashboard → bot)
// ---------------------------------------------------------------------------

const stmtEnqueueOutbox = db.prepare<[number, string, string | null, string]>(
  "INSERT INTO outbox (conversation_id, phone, remote_jid, content) VALUES (?, ?, ?, ?)",
);

export function enqueueOutbox(
  conversationId: number,
  phone: string,
  content: string,
  remoteJid?: string | null,
): number {
  const info = stmtEnqueueOutbox.run(
    conversationId,
    phone,
    remoteJid ?? null,
    content,
  );
  return Number(info.lastInsertRowid);
}

const stmtPendingOutbox = db.prepare<[number], OutboxItem>(
  "SELECT * FROM outbox WHERE sent = 0 ORDER BY created_at ASC, id ASC LIMIT ?",
);

export function getPendingOutbox(limit = 20): OutboxItem[] {
  return stmtPendingOutbox.all(limit);
}

const stmtMarkOutboxSent = db.prepare<[number]>(
  "UPDATE outbox SET sent = 1 WHERE id = ?",
);

export function markOutboxSent(id: number): void {
  stmtMarkOutboxSent.run(id);
}

// ---------------------------------------------------------------------------
// Borrar conversación (transacción atómica)
// ---------------------------------------------------------------------------

const stmtDeleteMessages = db.prepare<[number]>(
  "DELETE FROM messages WHERE conversation_id = ?",
);
const stmtDeletePendingOutbox = db.prepare<[number]>(
  "DELETE FROM outbox WHERE conversation_id = ? AND sent = 0",
);
const stmtDeleteConvo = db.prepare<[number]>(
  "DELETE FROM conversations WHERE id = ?",
);

const txDeleteConversation = db.transaction((conversationId: number) => {
  stmtDeleteMessages.run(conversationId);
  stmtDeletePendingOutbox.run(conversationId);
  stmtDeleteConvo.run(conversationId);
});

export function deleteConversation(conversationId: number): void {
  txDeleteConversation(conversationId);
}
