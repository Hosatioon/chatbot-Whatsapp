import "./env-loader";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const dataDir = path.resolve(process.env.DATA_DIR || process.cwd(), "data");
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
    tenant_id INTEGER NOT NULL DEFAULT 1,
    phone TEXT NOT NULL,
    name TEXT,
    jid TEXT,
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
    tenant_id INTEGER PRIMARY KEY,
    status TEXT CHECK(status IN ('disconnected','qr','connecting','connected'))
      NOT NULL DEFAULT 'disconnected',
    qr_string TEXT,
    phone TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    conversation_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    remote_jid TEXT,
    content TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox(tenant_id, sent, created_at);

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    variants TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    theme TEXT NOT NULL DEFAULT 'light',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT CHECK(role IN ('ADMIN','OPERATOR','VIEWER')) NOT NULL DEFAULT 'OPERATOR',
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT,
    status TEXT CHECK(status IN ('PENDING','CONFIRMED','PREPARING','ON_THE_WAY','DELIVERED','CANCELLED'))
      NOT NULL DEFAULT 'PENDING',
    total_amount INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL DEFAULT 0,
    total_price INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

  CREATE TABLE IF NOT EXISTS message_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    phone TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_msg_events_phone_time
    ON message_events(tenant_id, phone, created_at DESC);

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    daily_chat_limit INTEGER NOT NULL DEFAULT 0,
    price_cop INTEGER NOT NULL DEFAULT 0,
    price_usd REAL NOT NULL DEFAULT 0,
    description TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tenant_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    status TEXT CHECK(status IN ('active','suspended','cancelled','trial'))
      NOT NULL DEFAULT 'trial',
    next_billing_date INTEGER,
    trial_end_date INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_plans_tenant
    ON tenant_plans(tenant_id);

  CREATE TABLE IF NOT EXISTS tenant_daily_usage (
    tenant_id INTEGER NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    conversation_count INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_tenant_usage_date
    ON tenant_daily_usage(tenant_id, date);

  INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (1, 'Default', 'default');
`);

function columnExists(table: string, column: string): boolean {
  const rows = db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all();
  return rows.some((r) => r.name === column);
}

if (!columnExists("conversations", "tenant_id")) {
  db.exec(
    `ALTER TABLE conversations ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1`,
  );
}
if (!columnExists("products", "tenant_id")) {
  db.exec(
    `ALTER TABLE products ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1`,
  );
}
if (!columnExists("outbox", "tenant_id")) {
  db.exec(`ALTER TABLE outbox ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1`);
}
if (!columnExists("conversations", "jid")) {
  db.exec(`ALTER TABLE conversations ADD COLUMN jid TEXT`);
}
if (!columnExists("outbox", "remote_jid")) {
  db.exec(`ALTER TABLE outbox ADD COLUMN remote_jid TEXT`);
}
if (!columnExists("tenant_plans", "trial_end_date")) {
  db.exec(`ALTER TABLE tenant_plans ADD COLUMN trial_end_date INTEGER`);
}
if (!columnExists("tenants", "business_name")) {
  db.exec(`ALTER TABLE tenants ADD COLUMN business_name TEXT`);
}
if (!columnExists("tenants", "business_type")) {
  db.exec(`ALTER TABLE tenants ADD COLUMN business_type TEXT`);
}
if (!columnExists("tenants", "payment_info")) {
  db.exec(`ALTER TABLE tenants ADD COLUMN payment_info TEXT`);
}
if (!columnExists("tenants", "custom_greeting")) {
  db.exec(`ALTER TABLE tenants ADD COLUMN custom_greeting TEXT`);
}
if (!columnExists("tenants", "custom_prompt")) {
  db.exec(`ALTER TABLE tenants ADD COLUMN custom_prompt TEXT`);
}

export default db;

export type Tenant = {
  id: number;
  name: string;
  slug: string;
  theme: string;
  business_name: string | null;
  business_type: string | null;
  payment_info: string | null;
  custom_greeting: string | null;
  custom_prompt: string | null;
  created_at: number;
};

export type ConnectionState = {
  tenant_id: number;
  status: "disconnected" | "qr" | "connecting" | "connected";
  qr_string: string | null;
  phone: string | null;
  updated_at: number;
};

export type SetConnectionStateInput = {
  status?: "disconnected" | "qr" | "connecting" | "connected";
  qr_string?: string | null;
  phone?: string | null;
};

export type Conversation = {
  id: number;
  tenant_id: number;
  phone: string;
  jid: string | null;
  name: string | null;
  mode: "AI" | "HUMAN";
  last_message_at: number | null;
  created_at: number;
};

export type Message = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "human";
  content: string;
  created_at: number;
};

export type OutboxItem = {
  id: number;
  tenant_id: number;
  conversation_id: number;
  phone: string;
  remote_jid: string | null;
  content: string;
  sent: number;
  created_at: number;
};

export type Product = {
  id: number;
  tenant_id: number;
  name: string;
  price: number;
  stock: number;
  active: number;
  description: string | null;
  variants: string | null;
  created_at: number;
};

const stmtListTenants = db.prepare<[], Tenant>(
  "SELECT * FROM tenants ORDER BY id ASC",
);
const stmtGetConnState = db.prepare<[number], ConnectionState>(
  "SELECT * FROM connection_state WHERE tenant_id = ?",
);
const stmtGetConvoByPhone = db.prepare<[number, string], Conversation>(
  "SELECT * FROM conversations WHERE tenant_id = ? AND phone = ?",
);
const stmtInsertConvo = db.prepare<
  [number, string, string | null, string | null],
  { lastInsertRowid: bigint }
>(
  "INSERT INTO conversations (tenant_id, phone, name, jid) VALUES (?, ?, ?, ?)",
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
const stmtInsertMessage = db.prepare<
  [number, string, string],
  { lastInsertRowid: bigint }
>("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)");
const stmtTouchConvo = db.prepare<[number]>(
  "UPDATE conversations SET last_message_at = unixepoch() WHERE id = ?",
);
const stmtGetRecent = db.prepare<[number, number], Message>(
  "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
);
const stmtGetActiveProducts = db.prepare<[number], Product>(
  "SELECT * FROM products WHERE tenant_id = ? AND active = 1 ORDER BY name ASC",
);
const stmtPendingOutbox = db.prepare<[number, number], OutboxItem>(
  "SELECT * FROM outbox WHERE tenant_id = ? AND sent = 0 ORDER BY created_at ASC, id ASC LIMIT ?",
);
const stmtMarkOutboxSent = db.prepare<[number]>(
  "UPDATE outbox SET sent = 1 WHERE id = ?",
);
const stmtCountMsgEventsInWindow = db.prepare<
  [number, string, number],
  { count: number }
>(
  "SELECT COUNT(*) as count FROM message_events WHERE tenant_id = ? AND phone = ? AND created_at >= ?",
);
const stmtCountDuplicateContent = db.prepare<
  [number, string, string, number],
  { count: number }
>(
  "SELECT COUNT(*) as count FROM message_events WHERE tenant_id = ? AND phone = ? AND content_hash = ? AND created_at >= ?",
);
const stmtInsertMsgEvent = db.prepare<[number, string, string]>(
  "INSERT INTO message_events (tenant_id, phone, content_hash) VALUES (?, ?, ?)",
);
const stmtPurgeOldMsgEvents = db.prepare<[number]>(
  "DELETE FROM message_events WHERE created_at < ?",
);
const stmtGetDailyUsage = db.prepare<
  [number, string],
  {
    tenant_id: number;
    date: string;
    conversation_count: number;
    message_count: number;
    updated_at: number;
  }
>("SELECT * FROM tenant_daily_usage WHERE tenant_id = ? AND date = ?");
const stmtIncrementDailyUsage = db.prepare<[number, string, number, number]>(
  `INSERT INTO tenant_daily_usage (tenant_id, date, conversation_count, message_count, updated_at)
   VALUES (?, ?, ?, ?, unixepoch())
   ON CONFLICT(tenant_id) DO UPDATE SET
     date = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.date ELSE excluded.date END,
     conversation_count = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.conversation_count + excluded.conversation_count ELSE excluded.conversation_count END,
     message_count = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.message_count + excluded.message_count ELSE message_count END,
     updated_at = unixepoch()`,
);
const stmtGetTenantPlan = db.prepare<
  [number],
  {
    tenant_id: number;
    plan_id: number;
    status: string;
    next_billing_date: number | null;
    trial_end_date: number | null;
    plan_slug: string;
    plan_name: string;
    daily_chat_limit: number;
  }
>(
  `SELECT tp.*, p.slug as plan_slug, p.name as plan_name, p.daily_chat_limit
   FROM tenant_plans tp
   JOIN plans p ON tp.plan_id = p.id
   WHERE tp.tenant_id = ?`,
);

export function listTenants(): Tenant[] {
  return stmtListTenants.all();
}

const stmtGetTenantById = db.prepare<[number], Tenant>(
  "SELECT * FROM tenants WHERE id = ?",
);

export function getTenantById(id: number): Tenant | null {
  return stmtGetTenantById.get(id) ?? null;
}

export function getConnectionState(tenantId: number): ConnectionState {
  const row = stmtGetConnState.get(tenantId);
  if (!row) {
    db.prepare(
      "INSERT OR IGNORE INTO connection_state (tenant_id, status) VALUES (?, 'disconnected')",
    ).run(tenantId);
    return stmtGetConnState.get(tenantId)!;
  }
  return row;
}

export function setConnectionState(
  tenantId: number,
  input: SetConnectionStateInput,
): void {
  const current = getConnectionState(tenantId);
  const next: ConnectionState = {
    ...current,
    status: input.status ?? current.status,
    qr_string:
      input.qr_string === undefined ? current.qr_string : input.qr_string,
    phone: input.phone === undefined ? current.phone : input.phone,
    updated_at: Math.floor(Date.now() / 1000),
  };
  db.prepare(
    `INSERT INTO connection_state (tenant_id, status, qr_string, phone, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET
       status = excluded.status,
       qr_string = excluded.qr_string,
       phone = excluded.phone,
       updated_at = excluded.updated_at`,
  ).run(tenantId, next.status, next.qr_string, next.phone, next.updated_at);
}

export function getOrCreateConversation(
  tenantId: number,
  phone: string,
  name?: string | null,
  jid?: string | null,
): Conversation {
  const existing = stmtGetConvoByPhone.get(tenantId, phone);
  if (existing) {
    let updated = existing;
    if (name && name !== existing.name) {
      stmtUpdateConvoName.run(name, existing.id);
      updated = { ...updated, name };
    }
    if (jid && jid !== existing.jid) {
      stmtUpdateConvoJid.run(jid, existing.id);
      updated = { ...updated, jid };
    }
    return updated;
  }
  const info = stmtInsertConvo.run(tenantId, phone, name ?? null, jid ?? null);
  const created = stmtGetConvoById.get(Number(info.lastInsertRowid));
  if (!created) throw new Error("No se pudo crear la conversación");
  return created;
}

export function insertMessage(
  conversationId: number,
  role: "user" | "assistant" | "human",
  content: string,
): number {
  const info = stmtInsertMessage.run(conversationId, role, content);
  stmtTouchConvo.run(conversationId);
  return Number(info.lastInsertRowid);
}

export function getRecentHistory(
  conversationId: number,
  limit = 20,
): Message[] {
  const rows = stmtGetRecent.all(conversationId, limit);
  return rows.reverse();
}

export function getActiveProducts(tenantId: number): Product[] {
  return stmtGetActiveProducts.all(tenantId);
}

export function getPendingOutbox(tenantId: number, limit = 20): OutboxItem[] {
  return stmtPendingOutbox.all(tenantId, limit);
}

export function markOutboxSent(id: number): void {
  stmtMarkOutboxSent.run(id);
}

export function countMessagesInWindow(
  tenantId: number,
  phone: string,
  windowSeconds: number,
): number {
  const since = Math.floor(Date.now() / 1000) - windowSeconds;
  return stmtCountMsgEventsInWindow.get(tenantId, phone, since)?.count ?? 0;
}

export function countDuplicateContentInWindow(
  tenantId: number,
  phone: string,
  contentHash: string,
  windowSeconds: number,
): number {
  const since = Math.floor(Date.now() / 1000) - windowSeconds;
  return (
    stmtCountDuplicateContent.get(tenantId, phone, contentHash, since)?.count ??
    0
  );
}

export function recordMessageEvent(
  tenantId: number,
  phone: string,
  contentHash: string,
): void {
  stmtInsertMsgEvent.run(tenantId, phone, contentHash);
}

export function purgeOldMessageEvents(olderThanSeconds = 7200): void {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
  stmtPurgeOldMsgEvents.run(cutoff);
}

export function getDailyUsage(
  tenantId: number,
  date: string,
): { conversation_count: number; message_count: number } | null {
  const row = stmtGetDailyUsage.get(tenantId, date);
  if (!row) return null;
  return {
    conversation_count: row.conversation_count,
    message_count: row.message_count,
  };
}

export function incrementDailyUsage(
  tenantId: number,
  date: string,
  newConversation = false,
  messages = 1,
): void {
  stmtIncrementDailyUsage.run(
    tenantId,
    date,
    newConversation ? 1 : 0,
    messages,
  );
}

export function getTenantPlan(tenantId: number): {
  plan_slug: string;
  plan_name: string;
  daily_chat_limit: number;
  status: string;
  trial_end_date: number | null;
} | null {
  const row = stmtGetTenantPlan.get(tenantId);
  if (!row) return null;
  return {
    plan_slug: row.plan_slug,
    plan_name: row.plan_name,
    daily_chat_limit: row.daily_chat_limit,
    status: row.status,
    trial_end_date: row.trial_end_date ?? null,
  };
}

export function isTrialExpired(tp: {
  trial_end_date: number | null;
  status?: string;
}): boolean {
  if (!tp.trial_end_date) return false;
  const now = Math.floor(Date.now() / 1000);
  return now > tp.trial_end_date;
}

export function hasExceededDailyLimit(tenantId: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const tp = getTenantPlan(tenantId);
  if (!tp) return false;
  if (tp.daily_chat_limit <= 0) return false;
  if (isTrialExpired(tp)) return true;
  const usage = getDailyUsage(tenantId, today);
  if (!usage) return false;
  return usage.conversation_count >= tp.daily_chat_limit;
}
