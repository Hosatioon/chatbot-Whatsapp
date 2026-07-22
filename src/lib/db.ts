import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Mode = "AI" | "HUMAN";
export type Role = "user" | "assistant" | "human";
export type UserRole = "ADMIN" | "OPERATOR" | "VIEWER";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  tenant_id: number;
  is_super_admin: number;
  created_at: number;
}
export type ConnectionStatus =
  | "disconnected"
  | "qr"
  | "connecting"
  | "connected";

export type TenantTheme = "light" | "dark" | "blue" | "pink" | "whatsapp";
export const TENANT_THEMES: TenantTheme[] = [
  "light",
  "dark",
  "blue",
  "pink",
  "whatsapp",
];

// Estados de pedidos
export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PREPARING"
  | "ON_THE_WAY"
  | "DELIVERED"
  | "CANCELLED";

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "ON_THE_WAY",
  "DELIVERED",
  "CANCELLED",
];

// Eventos de pedidos
export type OrderEvent =
  | "ORDER_CREATED"
  | "ORDER_CONFIRMED"
  | "ORDER_CANCELLED"
  | "ORDER_PREPARING"
  | "ORDER_ON_THE_WAY"
  | "ORDER_DELIVERED";

export interface Order {
  id: number;
  tenant_id: number;
  customer_phone: string;
  customer_name: string | null;
  status: OrderStatus;
  total_amount: number;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  theme: TenantTheme;
  business_name: string | null;
  business_type: string | null;
  payment_info: string | null;
  custom_greeting: string | null;
  custom_prompt: string | null;
  created_at: number;
}

export interface Conversation {
  id: number;
  tenant_id: number;
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
  tenant_id: number;
  status: ConnectionStatus;
  qr_string: string | null;
  phone: string | null;
  updated_at: number;
}

export interface ProductVariant {
  name: string;
  price: number;
  stock?: number;
}

export interface Product {
  id: number;
  tenant_id: number;
  name: string;
  price: number;
  stock: number;
  active: number;
  description: string | null;
  variants: ProductVariant[] | null;
  created_at: number;
}

export interface OutboxItem {
  id: number;
  tenant_id: number;
  conversation_id: number;
  phone: string;
  // JID completo destinatario. Si es null, se reconstruye con
  // `${phone}@s.whatsapp.net` por compatibilidad con outbox legacy.
  remote_jid: string | null;
  content: string;
  sent: number;
  created_at: number;
}

export interface Plan {
  id: number;
  name: string;
  slug: string;
  daily_chat_limit: number;
  price_cop: number;
  price_usd: number;
  description: string | null;
  created_at: number;
}

export interface TenantPlan {
  id: number;
  tenant_id: number;
  plan_id: number;
  status: "active" | "suspended" | "cancelled" | "trial";
  next_billing_date: number | null;
  trial_end_date: number | null;
  created_at: number;
}

export interface TenantDailyUsage {
  tenant_id: number;
  date: string; // YYYY-MM-DD
  conversation_count: number;
  message_count: number;
  updated_at: number;
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

const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  !!process.env.NEXT_PRIVATE_BUILD_ID;

let db: Database.Database;
if (isBuildPhase) {
  db = new Database(":memory:");
} else {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
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
    tenant_id INTEGER PRIMARY KEY,
    status TEXT CHECK(status IN ('disconnected','qr','connecting','connected'))
      NOT NULL DEFAULT 'disconnected',
    qr_string TEXT,
    phone TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

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

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    theme TEXT NOT NULL DEFAULT 'light',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (1, 'Default', 'default');

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

// Migración idempotente: agregar tablas de pedidos
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT,
    status TEXT CHECK(status IN ('PENDING','CONFIRMED','PREPARING','ON_THE_WAY','DELIVERED','CANCELLED')) NOT NULL DEFAULT 'PENDING',
    total_amount INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL DEFAULT 0,
    total_price INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

// Migración idempotente: description en products
if (!columnExists("products", "description")) {
  db.exec(`ALTER TABLE products ADD COLUMN description TEXT`);
}

// Migración idempotente: variants en products (JSON: [{name, price, stock?}])
if (!columnExists("products", "variants")) {
  db.exec(`ALTER TABLE products ADD COLUMN variants TEXT`);
}

// Multi-tenant: agregar tenant_id a tablas operacionales (default = 1).
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

// Índices multi-tenant
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id, active);
  CREATE INDEX IF NOT EXISTS idx_outbox_tenant ON outbox(tenant_id, sent);
`);

// Migración idempotente: connection_state pasa de single-row (id=1) a multi-tenant (tenant_id PK).
if (
  columnExists("connection_state", "id") &&
  !columnExists("connection_state", "tenant_id")
) {
  db.exec(`
    ALTER TABLE connection_state RENAME TO connection_state_old;
    CREATE TABLE connection_state (
      tenant_id INTEGER PRIMARY KEY,
      status TEXT CHECK(status IN ('disconnected','qr','connecting','connected'))
        NOT NULL DEFAULT 'disconnected',
      qr_string TEXT,
      phone TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO connection_state (tenant_id, status, qr_string, phone, updated_at)
      SELECT id, status, qr_string, phone, updated_at FROM connection_state_old;
    DROP TABLE connection_state_old;
  `);
}

// Migración idempotente: is_super_admin en users
if (!columnExists("users", "is_super_admin")) {
  db.exec(
    `ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0`,
  );
}

// Rate limiting: registro de mensajes entrantes para detección de spam/flood
db.exec(`
  CREATE TABLE IF NOT EXISTS message_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL DEFAULT 1,
    phone TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_msg_events_phone_time
    ON message_events(tenant_id, phone, created_at DESC);
`);

// ---------------------------------------------------------------------------
// Planes de pago y uso diario por tenant
// ---------------------------------------------------------------------------
db.exec(`
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

  CREATE TABLE IF NOT EXISTS llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_llm_usage_tenant_date
    ON llm_usage(tenant_id, created_at);
`);

// Seed de planes por defecto (idempotente)
const stmtSeedPlans = db.prepare<
  [string, string, number, number, number, string | null]
>(
  `INSERT OR IGNORE INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
stmtSeedPlans.run("Gratis", "free", 10, 0, 0, "10 chats/día para probar");
stmtSeedPlans.run(
  "Prueba",
  "trial",
  50,
  80000,
  20.0,
  "Prueba 15 días - 50 chats/día",
);
stmtSeedPlans.run(
  "Starter",
  "starter",
  30,
  49000,
  12.25,
  "30 chats/día - cafetería, tienda chica",
);
stmtSeedPlans.run(
  "Pro",
  "pro",
  50,
  75000,
  18.75,
  "50 chats/día - restaurante, ferretería",
);
stmtSeedPlans.run(
  "Business",
  "business",
  999999,
  120000,
  30.0,
  "Ilimitado - farmacia, supermercado",
);

// Migración idempotente: agregar columna `theme` a tenants si falta.
function hasColumn(table: string, column: string): boolean {
  const cols = db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all();
  return cols.some((c) => c.name === column);
}

if (!hasColumn("tenants", "theme")) {
  db.exec("ALTER TABLE tenants ADD COLUMN theme TEXT NOT NULL DEFAULT 'light'");
}
if (!hasColumn("tenants", "business_name")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_name TEXT");
}
if (!hasColumn("tenants", "business_type")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_type TEXT");
}
if (!hasColumn("tenants", "payment_info")) {
  db.exec("ALTER TABLE tenants ADD COLUMN payment_info TEXT");
}
if (!hasColumn("tenants", "custom_greeting")) {
  db.exec("ALTER TABLE tenants ADD COLUMN custom_greeting TEXT");
}
if (!hasColumn("tenants", "custom_prompt")) {
  db.exec("ALTER TABLE tenants ADD COLUMN custom_prompt TEXT");
}
if (!hasColumn("tenant_plans", "trial_end_date")) {
  db.exec("ALTER TABLE tenant_plans ADD COLUMN trial_end_date INTEGER");
}

// Migración: quitar UNIQUE individual de conversations.phone y products.name,
// reemplazar por UNIQUE compuesto (tenant_id, phone/name).
function hasUniqueConstraint(table: string): boolean {
  const indexes = db
    .prepare<
      [],
      { name: string; unique: number; origin: string }
    >(`PRAGMA index_list(${table})`)
    .all();
  return indexes.some((i) => i.origin === "u" && i.unique === 1);
}

if (hasUniqueConstraint("conversations")) {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE conversations_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      phone TEXT NOT NULL,
      name TEXT,
      mode TEXT CHECK(mode IN ('AI','HUMAN')) NOT NULL DEFAULT 'AI',
      last_message_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      jid TEXT
    );
    INSERT INTO conversations_new (id, tenant_id, phone, name, mode, last_message_at, created_at, jid)
      SELECT id, tenant_id, phone, name, mode, last_message_at, created_at, jid FROM conversations;
    DROP TABLE conversations;
    ALTER TABLE conversations_new RENAME TO conversations;
    CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
    CREATE UNIQUE INDEX idx_conversations_tenant_phone ON conversations(tenant_id, phone);
    COMMIT;
  `);
  db.pragma("foreign_keys = ON");
}

if (hasUniqueConstraint("products")) {
  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE products_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    INSERT INTO products_new (id, tenant_id, name, price, stock, active, description, created_at)
      SELECT id, tenant_id, name, price, stock, active, description, created_at FROM products;
    DROP TABLE products;
    ALTER TABLE products_new RENAME TO products;
    CREATE INDEX idx_products_tenant ON products(tenant_id, active);
    CREATE UNIQUE INDEX idx_products_tenant_name ON products(tenant_id, name);
    COMMIT;
  `);
}

export default db;

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

const stmtGetConvoByPhone = db.prepare<[number, string], Conversation>(
  "SELECT * FROM conversations WHERE tenant_id = ? AND phone = ?",
);
const stmtInsertConvo = db.prepare<
  [number, string, string | null, string | null]
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
const stmtGetConvoByIdScoped = db.prepare<[number, number], Conversation>(
  "SELECT * FROM conversations WHERE id = ? AND tenant_id = ?",
);

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

export function getConversationById(
  id: number,
  tenantId?: number,
): Conversation | null {
  if (tenantId !== undefined) {
    return stmtGetConvoByIdScoped.get(id, tenantId) ?? null;
  }
  return stmtGetConvoById.get(id) ?? null;
}

const stmtListConvos = db.prepare<[number], ConversationListItem>(`
  SELECT c.*,
    (SELECT content FROM messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC
       LIMIT 1) AS last_message_preview
  FROM conversations c
  WHERE c.tenant_id = ?
  ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
`);

export function listConversations(tenantId: number): ConversationListItem[] {
  return stmtListConvos.all(tenantId);
}

const stmtSetMode = db.prepare<[Mode, number, number]>(
  "UPDATE conversations SET mode = ? WHERE id = ? AND tenant_id = ?",
);

export function setMode(
  tenantId: number,
  conversationId: number,
  mode: Mode,
): void {
  stmtSetMode.run(mode, conversationId, tenantId);
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

const stmtGetMessages = db.prepare<[number, number, number], Message>(
  `SELECT m.* FROM messages m
   JOIN conversations c ON m.conversation_id = c.id
   WHERE m.conversation_id = ? AND c.tenant_id = ?
   ORDER BY m.created_at ASC, m.id ASC LIMIT ?`,
);

export function getMessages(
  tenantId: number,
  conversationId: number,
  limit = 50,
): Message[] {
  return stmtGetMessages.all(conversationId, tenantId, limit);
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

const stmtGetConnState = db.prepare<[number], ConnectionState>(
  "SELECT * FROM connection_state WHERE tenant_id = ?",
);

const stmtListConnStates = db.prepare<[], ConnectionState>(
  "SELECT * FROM connection_state",
);

export function getConnectionState(tenantId: number): ConnectionState {
  const row = stmtGetConnState.get(tenantId);
  if (!row) {
    // Defensivo: insertar fila por defecto para este tenant
    db.prepare(
      "INSERT OR IGNORE INTO connection_state (tenant_id, status) VALUES (?, 'disconnected')",
    ).run(tenantId);
    return stmtGetConnState.get(tenantId)!;
  }
  return row;
}

export function listConnectionStates(): ConnectionState[] {
  return stmtListConnStates.all();
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

// ---------------------------------------------------------------------------
// Outbox (mensajes del dashboard → bot)
// ---------------------------------------------------------------------------

const stmtEnqueueOutbox = db.prepare<
  [number, number, string, string | null, string]
>(
  "INSERT INTO outbox (tenant_id, conversation_id, phone, remote_jid, content) VALUES (?, ?, ?, ?, ?)",
);

export function enqueueOutbox(
  tenantId: number,
  conversationId: number,
  phone: string,
  content: string,
  remoteJid?: string | null,
): number {
  const info = stmtEnqueueOutbox.run(
    tenantId,
    conversationId,
    phone,
    remoteJid ?? null,
    content,
  );
  return Number(info.lastInsertRowid);
}

const stmtPendingOutbox = db.prepare<[number, number], OutboxItem>(
  "SELECT * FROM outbox WHERE tenant_id = ? AND sent = 0 ORDER BY created_at ASC, id ASC LIMIT ?",
);

export function getPendingOutbox(tenantId: number, limit = 20): OutboxItem[] {
  return stmtPendingOutbox.all(tenantId, limit);
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

const stmtDeleteMessages = db.prepare<[number, number]>(
  "DELETE FROM messages WHERE conversation_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ?)",
);
const stmtDeletePendingOutbox = db.prepare<[number, number]>(
  "DELETE FROM outbox WHERE conversation_id = ? AND sent = 0 AND tenant_id = ?",
);
const stmtDeleteConvo = db.prepare<[number, number]>(
  "DELETE FROM conversations WHERE id = ? AND tenant_id = ?",
);

const txDeleteConversation = db.transaction(
  (tenantId: number, conversationId: number) => {
    stmtDeleteMessages.run(conversationId, tenantId);
    stmtDeletePendingOutbox.run(conversationId, tenantId);
    stmtDeleteConvo.run(conversationId, tenantId);
  },
);

export function deleteConversation(
  tenantId: number,
  conversationId: number,
): void {
  txDeleteConversation(tenantId, conversationId);
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

const stmtListProducts = db.prepare<[number], Product>(
  "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE tenant_id = ? ORDER BY active DESC, name ASC",
);

const stmtGetProductById = db.prepare<[number], Product>(
  "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE id = ?",
);

const stmtGetProductByIdScoped = db.prepare<[number, number], Product>(
  "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE id = ? AND tenant_id = ?",
);

const stmtGetActiveProducts = db.prepare<[number], Product>(
  "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE tenant_id = ? AND active = 1 ORDER BY name ASC",
);

const stmtInsertProduct = db.prepare<
  [number, string, number, number, number, string | null, string | null]
>(
  "INSERT INTO products (tenant_id, name, price, stock, active, description, variants) VALUES (?, ?, ?, ?, ?, ?, ?)",
);

const stmtUpdateProduct = db.prepare<
  [string, number, number, number, string | null, string | null, number, number]
>(
  "UPDATE products SET name = ?, price = ?, stock = ?, active = ?, description = ?, variants = ? WHERE id = ? AND tenant_id = ?",
);

const stmtDeleteProduct = db.prepare<[number, number]>(
  "DELETE FROM products WHERE id = ? AND tenant_id = ?",
);

const stmtToggleProductActive = db.prepare<[number, number, number]>(
  "UPDATE products SET active = ? WHERE id = ? AND tenant_id = ?",
);

export function listProducts(tenantId: number): Product[] {
  return stmtListProducts.all(tenantId);
}

export function getActiveProducts(tenantId: number): Product[] {
  return stmtGetActiveProducts.all(tenantId);
}

export function getProductById(id: number, tenantId?: number): Product | null {
  if (tenantId !== undefined) {
    return stmtGetProductByIdScoped.get(id, tenantId) ?? null;
  }
  return stmtGetProductById.get(id) ?? null;
}

export function createProduct(
  tenantId: number,
  name: string,
  price: number,
  stock: number,
  description?: string | null,
  variants?: ProductVariant[] | null,
): Product {
  const active = stock > 0 ? 1 : 0;
  const variantsJson =
    variants && variants.length > 0 ? JSON.stringify(variants) : null;
  const info = stmtInsertProduct.run(
    tenantId,
    name,
    price,
    stock,
    active,
    description ?? null,
    variantsJson,
  );
  const product = getProductById(Number(info.lastInsertRowid));
  if (!product) throw new Error("No se pudo crear el producto");
  return product;
}

export function updateProduct(
  tenantId: number,
  id: number,
  name: string,
  price: number,
  stock: number,
  description?: string | null,
  variants?: ProductVariant[] | null,
): void {
  const active = stock > 0 ? 1 : 0;
  const variantsJson =
    variants && variants.length > 0 ? JSON.stringify(variants) : null;
  stmtUpdateProduct.run(
    name,
    price,
    stock,
    active,
    description ?? null,
    variantsJson,
    id,
    tenantId,
  );
}

export function deleteProduct(tenantId: number, id: number): void {
  stmtDeleteProduct.run(id, tenantId);
}

export function toggleProductActive(
  tenantId: number,
  id: number,
  active: boolean,
): void {
  if (active) {
    const product = getProductById(id, tenantId);
    if (product && product.stock === 0) {
      return; // No se puede activar un producto sin stock
    }
  }
  stmtToggleProductActive.run(active ? 1 : 0, id, tenantId);
}

// ---------------------------------------------------------------------------
// Productos (unscoped — super-admin)
// ---------------------------------------------------------------------------

const stmtListAllProducts = db.prepare<[], Product & { tenant_name: string }>(`
  SELECT p.*, t.name as tenant_name
  FROM products p
  JOIN tenants t ON p.tenant_id = t.id
  ORDER BY t.name ASC, p.active DESC, p.name ASC
`);

export function listAllProducts(): (Product & { tenant_name: string })[] {
  return stmtListAllProducts.all();
}

// ---------------------------------------------------------------------------
// Conversaciones (unscoped — super-admin)
// ---------------------------------------------------------------------------

const stmtListAllConversations = db.prepare<
  [],
  ConversationListItem & { tenant_name: string }
>(`
  SELECT c.*,
    (SELECT content FROM messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC
       LIMIT 1) AS last_message_preview,
    t.name as tenant_name
  FROM conversations c
  JOIN tenants t ON c.tenant_id = t.id
  ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
`);

export function listAllConversations(): (ConversationListItem & {
  tenant_name: string;
})[] {
  return stmtListAllConversations.all();
}

// ---------------------------------------------------------------------------
// Usuarios (Auth)
// ---------------------------------------------------------------------------

const stmtGetUserByEmail = db.prepare<[string], User>(
  "SELECT * FROM users WHERE email = ?",
);

const stmtGetUserById = db.prepare<[number], User>(
  "SELECT * FROM users WHERE id = ?",
);

const stmtInsertUser = db.prepare<[string, string, string, UserRole, number]>(
  "INSERT INTO users (email, password_hash, name, role, tenant_id) VALUES (?, ?, ?, ?, ?)",
);

const stmtCountUsers = db.prepare<[], { count: number }>(
  "SELECT COUNT(*) as count FROM users",
);

const stmtGetUsersByTenant = db.prepare<[number], User>(
  "SELECT * FROM users WHERE tenant_id = ? ORDER BY name ASC",
);

const stmtSetSuperAdmin = db.prepare<[number, number]>(
  "UPDATE users SET is_super_admin = ? WHERE id = ?",
);

export function getUserByEmail(email: string): User | null {
  return stmtGetUserByEmail.get(email) ?? null;
}

export function getUserById(id: number): User | null {
  return stmtGetUserById.get(id) ?? null;
}

export function createUser(
  email: string,
  passwordHash: string,
  name: string,
  role: UserRole = "OPERATOR",
  tenantId: number = 1,
): User {
  const info = stmtInsertUser.run(email, passwordHash, name, role, tenantId);
  const user = getUserById(Number(info.lastInsertRowid));
  if (!user) throw new Error("No se pudo crear el usuario");
  return user;
}

export function hasAnyUser(): boolean {
  const result = stmtCountUsers.get();
  return (result?.count ?? 0) > 0;
}

export function getUsersByTenant(tenantId: number): User[] {
  return stmtGetUsersByTenant.all(tenantId);
}

export function setSuperAdmin(userId: number, value: boolean): void {
  stmtSetSuperAdmin.run(value ? 1 : 0, userId);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

const stmtListTenants = db.prepare<[], Tenant>(
  "SELECT * FROM tenants ORDER BY id ASC",
);

const stmtGetTenantById = db.prepare<[number], Tenant>(
  "SELECT * FROM tenants WHERE id = ?",
);

const stmtGetTenantBySlug = db.prepare<[string], Tenant>(
  "SELECT * FROM tenants WHERE slug = ?",
);

const stmtInsertTenant = db.prepare<[string, string]>(
  "INSERT INTO tenants (name, slug) VALUES (?, ?)",
);

export function listTenants(): Tenant[] {
  return stmtListTenants.all();
}

export function getTenantById(id: number): Tenant | null {
  return stmtGetTenantById.get(id) ?? null;
}

export function getTenantBySlug(slug: string): Tenant | null {
  return stmtGetTenantBySlug.get(slug) ?? null;
}

export function createTenant(name: string, slug: string): Tenant {
  const info = stmtInsertTenant.run(name, slug);
  const t = getTenantById(Number(info.lastInsertRowid));
  if (!t) throw new Error("No se pudo crear el tenant");
  return t;
}

const stmtUpdateTenantTheme = db.prepare<[string, number]>(
  "UPDATE tenants SET theme = ? WHERE id = ?",
);

export function setTenantTheme(tenantId: number, theme: TenantTheme): void {
  stmtUpdateTenantTheme.run(theme, tenantId);
}

export interface TenantConfig {
  business_name: string | null;
  business_type: string | null;
  payment_info: string | null;
  custom_greeting: string | null;
  custom_prompt: string | null;
}

const stmtUpdateTenantConfig = db.prepare<
  [string | null, string | null, string | null, string | null, string | null, number]
>(
  `UPDATE tenants SET business_name = ?, business_type = ?, payment_info = ?, custom_greeting = ?, custom_prompt = ? WHERE id = ?`,
);

export function updateTenantConfig(tenantId: number, config: TenantConfig): void {
  stmtUpdateTenantConfig.run(
    config.business_name || null,
    config.business_type || null,
    config.payment_info || null,
    config.custom_greeting || null,
    config.custom_prompt || null,
    tenantId,
  );
}

export function getTenantTheme(tenantId: number): TenantTheme {
  const t = getTenantById(tenantId);
  return t?.theme ?? "light";
}

// ---------------------------------------------------------------------------
// Rate limiting / detección spam
// ---------------------------------------------------------------------------

const stmtInsertMsgEvent = db.prepare<[number, string, string]>(
  "INSERT INTO message_events (tenant_id, phone, content_hash) VALUES (?, ?, ?)",
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

const stmtPurgeOldMsgEvents = db.prepare<[number]>(
  "DELETE FROM message_events WHERE created_at < ?",
);

export function recordMessageEvent(
  tenantId: number,
  phone: string,
  contentHash: string,
): void {
  stmtInsertMsgEvent.run(tenantId, phone, contentHash);
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

export function purgeOldMessageEvents(olderThanSeconds = 7200): void {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
  stmtPurgeOldMsgEvents.run(cutoff);
}

// ---------------------------------------------------------------------------
// Planes y uso diario por tenant
// ---------------------------------------------------------------------------

const stmtListPlans = db.prepare<[], Plan>(
  "SELECT * FROM plans ORDER BY id ASC",
);

const stmtGetPlanBySlug = db.prepare<[string], Plan>(
  "SELECT * FROM plans WHERE slug = ?",
);

const stmtInsertPlan = db.prepare<
  [string, string, number, number, number, string | null]
>(
  "INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description) VALUES (?, ?, ?, ?, ?, ?)",
);

const stmtGetTenantPlan = db.prepare<
  [number],
  TenantPlan & {
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

const stmtUpsertTenantPlan = db.prepare<
  [number, number, string, number | null, number | null]
>(
  `INSERT INTO tenant_plans (tenant_id, plan_id, status, next_billing_date, trial_end_date)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(tenant_id) DO UPDATE SET
     plan_id = excluded.plan_id,
     status = excluded.status,
     next_billing_date = excluded.next_billing_date,
     trial_end_date = excluded.trial_end_date`,
);

const stmtGetDailyUsage = db.prepare<[number, string], TenantDailyUsage>(
  "SELECT * FROM tenant_daily_usage WHERE tenant_id = ? AND date = ?",
);

const stmtUpsertDailyUsage = db.prepare<[number, string, number, number]>(
  `INSERT INTO tenant_daily_usage (tenant_id, date, conversation_count, message_count, updated_at)
   VALUES (?, ?, ?, ?, unixepoch())
   ON CONFLICT(tenant_id) DO UPDATE SET
     date = excluded.date,
     conversation_count = excluded.conversation_count,
     message_count = excluded.message_count,
     updated_at = excluded.updated_at`,
);

const stmtIncrementDailyUsage = db.prepare<[number, string, number, number]>(
  `INSERT INTO tenant_daily_usage (tenant_id, date, conversation_count, message_count, updated_at)
   VALUES (?, ?, ?, ?, unixepoch())
   ON CONFLICT(tenant_id) DO UPDATE SET
     date = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.date ELSE excluded.date END,
     conversation_count = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.conversation_count + excluded.conversation_count ELSE excluded.conversation_count END,
     message_count = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.message_count + excluded.message_count ELSE excluded.message_count END,
     updated_at = unixepoch()`,
);

export function listPlans(): Plan[] {
  return stmtListPlans.all();
}

export function getPlanBySlug(slug: string): Plan | null {
  return stmtGetPlanBySlug.get(slug) ?? null;
}

export function createPlan(
  name: string,
  slug: string,
  dailyChatLimit: number,
  priceCop: number,
  priceUsd: number,
  description: string | null,
): Plan {
  const info = stmtInsertPlan.run(
    name,
    slug,
    dailyChatLimit,
    priceCop,
    priceUsd,
    description,
  );
  const plan = getPlanBySlug(slug);
  if (!plan) throw new Error("No se pudo crear el plan");
  return plan;
}

export function getTenantPlan(tenantId: number):
  | (TenantPlan & {
      plan_slug: string;
      plan_name: string;
      daily_chat_limit: number;
    })
  | null {
  return stmtGetTenantPlan.get(tenantId) ?? null;
}

export function setTenantPlan(
  tenantId: number,
  planId: number,
  status: "active" | "suspended" | "cancelled" | "trial",
  nextBillingDate: number | null,
  trialEndDate: number | null = null,
): void {
  stmtUpsertTenantPlan.run(
    tenantId,
    planId,
    status,
    nextBillingDate,
    trialEndDate,
  );
}

export function getDailyUsage(
  tenantId: number,
  date: string,
): TenantDailyUsage | null {
  return stmtGetDailyUsage.get(tenantId, date) ?? null;
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

export function resetDailyUsage(tenantId: number, date: string): void {
  stmtUpsertDailyUsage.run(tenantId, date, 0, 0);
}

export function hasExceededDailyLimit(tenantId: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const tp = getTenantPlan(tenantId);
  if (!tp) return false; // sin plan asignado = sin límite (por ahora)
  if (tp.daily_chat_limit <= 0) return false;
  if (isTrialExpired(tp)) return true;
  const usage = getDailyUsage(tenantId, today);
  if (!usage) return false;
  return usage.conversation_count >= tp.daily_chat_limit;
}

export function isTrialExpired(
  tp: TenantPlan & {
    plan_slug?: string;
    plan_name?: string;
    daily_chat_limit?: number;
  },
): boolean {
  if (!tp.trial_end_date) return false;
  const now = Math.floor(Date.now() / 1000);
  return now > tp.trial_end_date;
}

// ---------------------------------------------------------------------------
// LLM Usage — registro de tokens y costo por llamada
// ---------------------------------------------------------------------------

export interface LLMUsageRecord {
  tenant_id: number;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  error_message?: string | null;
}

const stmtInsertLLMUsage = db.prepare<
  [
    number,
    string,
    number,
    number,
    number,
    number,
    number,
    number,
    string | null,
  ]
>(
  `INSERT INTO llm_usage (tenant_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, duration_ms, success, error_message, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
);

export function recordLLMUsage(rec: LLMUsageRecord): void {
  stmtInsertLLMUsage.run(
    rec.tenant_id,
    rec.model,
    rec.prompt_tokens,
    rec.completion_tokens,
    rec.total_tokens,
    rec.cost_usd,
    rec.duration_ms,
    rec.success ? 1 : 0,
    rec.error_message ?? null,
  );
}

const stmtGetDailyLLMCost = db.prepare<
  number,
  { total_cost_usd: number; total_tokens: number; call_count: number }
>(
  `SELECT
     COALESCE(SUM(cost_usd), 0) as total_cost_usd,
     COALESCE(SUM(total_tokens), 0) as total_tokens,
     COUNT(*) as call_count
   FROM llm_usage
   WHERE tenant_id = ? AND created_at >= unixepoch('now', 'start of day')`,
);

const stmtGetMonthlyLLMCost = db.prepare<
  number,
  { total_cost_usd: number; total_tokens: number; call_count: number }
>(
  `SELECT
     COALESCE(SUM(cost_usd), 0) as total_cost_usd,
     COALESCE(SUM(total_tokens), 0) as total_tokens,
     COUNT(*) as call_count
   FROM llm_usage
   WHERE tenant_id = ? AND created_at >= unixepoch('now', 'start of month')`,
);

const stmtGetGlobalDailyLLMCost = db.prepare<
  [],
  { total_cost_usd: number; total_tokens: number; call_count: number }
>(
  `SELECT
     COALESCE(SUM(cost_usd), 0) as total_cost_usd,
     COALESCE(SUM(total_tokens), 0) as total_tokens,
     COUNT(*) as call_count
   FROM llm_usage
   WHERE created_at >= unixepoch('now', 'start of day')`,
);

export interface LLMBudgetStatus {
  dailyCostUsd: number;
  monthlyCostUsd: number;
  dailyTokens: number;
  monthlyTokens: number;
  dailyCalls: number;
  monthlyCalls: number;
  exceeded: boolean;
  reason?: string;
}

const DEFAULT_DAILY_BUDGET_USD = parseFloat(
  process.env.LLM_DAILY_BUDGET_USD || "1.0",
);
const DEFAULT_MONTHLY_BUDGET_USD = parseFloat(
  process.env.LLM_MONTHLY_BUDGET_USD || "25.0",
);
const GLOBAL_DAILY_BUDGET_USD = parseFloat(
  process.env.LLM_GLOBAL_DAILY_BUDGET_USD || "10.0",
);

export function getLLMBudgetStatus(tenantId: number): LLMBudgetStatus {
  const daily = stmtGetDailyLLMCost.get(tenantId);
  const monthly = stmtGetMonthlyLLMCost.get(tenantId);

  const dailyCost = daily?.total_cost_usd ?? 0;
  const monthlyCost = monthly?.total_cost_usd ?? 0;

  let exceeded = false;
  let reason: string | undefined;

  if (dailyCost >= DEFAULT_DAILY_BUDGET_USD) {
    exceeded = true;
    reason = `Presupuesto diario de IA excedido ($${dailyCost.toFixed(4)} / $${DEFAULT_DAILY_BUDGET_USD.toFixed(2)} USD)`;
  } else if (monthlyCost >= DEFAULT_MONTHLY_BUDGET_USD) {
    exceeded = true;
    reason = `Presupuesto mensual de IA excedido ($${monthlyCost.toFixed(4)} / $${DEFAULT_MONTHLY_BUDGET_USD.toFixed(2)} USD)`;
  } else {
    const global = stmtGetGlobalDailyLLMCost.get();
    if ((global?.total_cost_usd ?? 0) >= GLOBAL_DAILY_BUDGET_USD) {
      exceeded = true;
      reason = `Presupuesto global de IA excedido ($${(global?.total_cost_usd ?? 0).toFixed(4)} / $${GLOBAL_DAILY_BUDGET_USD.toFixed(2)} USD)`;
    }
  }

  return {
    dailyCostUsd: dailyCost,
    monthlyCostUsd: monthlyCost,
    dailyTokens: daily?.total_tokens ?? 0,
    monthlyTokens: monthly?.total_tokens ?? 0,
    dailyCalls: daily?.call_count ?? 0,
    monthlyCalls: monthly?.call_count ?? 0,
    exceeded,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Pedidos (Orders)
// ---------------------------------------------------------------------------

// Interfaces para crear pedidos
export interface CreateOrderItemInput {
  product_name: string;
  quantity: number;
  unit_price: number;
}

export interface CreateOrderInput {
  tenant_id: number;
  customer_phone: string;
  customer_name?: string | null;
  items: CreateOrderItemInput[];
  notes?: string | null;
}

// Prepared statements para pedidos
const stmtInsertOrder = db.prepare(`
  INSERT INTO orders (tenant_id, customer_phone, customer_name, status, total_amount, notes, created_at, updated_at)
  VALUES (?, ?, ?, 'PENDING', 0, ?, unixepoch(), unixepoch())
`);

const stmtInsertOrderItem = db.prepare(`
  INSERT INTO order_items (order_id, product_name, quantity, unit_price, total_price)
  VALUES (?, ?, ?, ?, ?)
`);

const stmtUpdateOrderTotal = db.prepare(`
  UPDATE orders SET total_amount = ?, updated_at = unixepoch() WHERE id = ?
`);

const stmtUpdateOrderStatus = db.prepare(`
  UPDATE orders SET status = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?
`);

const stmtGetOrdersByTenant = db.prepare(`
  SELECT o.*, 
         COUNT(oi.id) as item_count
  FROM orders o
  LEFT JOIN order_items oi ON o.id = oi.order_id
  WHERE o.tenant_id = ?
  GROUP BY o.id
  ORDER BY o.created_at DESC
  LIMIT ?
`);

const stmtGetOrderById = db.prepare(`
  SELECT * FROM orders WHERE id = ? AND tenant_id = ?
`);

const stmtGetOrderItems = db.prepare(`
  SELECT * FROM order_items WHERE order_id = ? ORDER BY id
`);

// Crear un pedido con sus items (transacción)
export function createOrder(
  input: CreateOrderInput,
): Order & { items: OrderItem[] } {
  const transaction = db.transaction(() => {
    // Insertar el pedido
    const orderResult = stmtInsertOrder.run(
      input.tenant_id,
      input.customer_phone,
      input.customer_name || null,
      input.notes || null,
    );

    const orderId = Number(orderResult.lastInsertRowid);

    // Insertar items y calcular total
    let totalAmount = 0;
    const items: OrderItem[] = [];

    for (const item of input.items) {
      const totalPrice = item.quantity * item.unit_price;
      totalAmount += totalPrice;

      const itemResult = stmtInsertOrderItem.run(
        orderId,
        item.product_name,
        item.quantity,
        item.unit_price,
        totalPrice,
      );

      items.push({
        id: Number(itemResult.lastInsertRowid),
        order_id: orderId,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: totalPrice,
      });
    }

    // Actualizar el total del pedido
    stmtUpdateOrderTotal.run(totalAmount, orderId);

    // Retornar el pedido completo
    const order = stmtGetOrderById.get(orderId, input.tenant_id) as Order;
    if (!order) throw new Error("No se pudo crear el pedido");

    return { ...order, items };
  });

  return transaction();
}

// Listar pedidos de un tenant
export function getOrdersByTenant(
  tenantId: number,
  limit = 50,
): (Order & { item_count: number })[] {
  return stmtGetOrdersByTenant.all(tenantId, limit) as (Order & {
    item_count: number;
  })[];
}

// Obtener un pedido con sus items
export function getOrderById(
  tenantId: number,
  orderId: number,
): (Order & { items: OrderItem[] }) | null {
  const order = stmtGetOrderById.get(orderId, tenantId) as Order;
  if (!order) return null;

  const items = stmtGetOrderItems.all(orderId) as OrderItem[];
  return { ...order, items };
}

// Actualizar estado de un pedido
export function updateOrderStatus(
  tenantId: number,
  orderId: number,
  status: OrderStatus,
): boolean {
  const result = stmtUpdateOrderStatus.run(status, orderId, tenantId);
  return result.changes > 0;
}

// Obtener pedidos por estado
export const stmtGetOrdersByStatus = db.prepare(`
  SELECT o.*, 
         COUNT(oi.id) as item_count
  FROM orders o
  LEFT JOIN order_items oi ON o.id = oi.order_id
  WHERE o.tenant_id = ? AND o.status = ?
  GROUP BY o.id
  ORDER BY o.created_at DESC
  LIMIT ?
`);

export function getOrdersByStatus(
  tenantId: number,
  status: OrderStatus,
  limit = 50,
): (Order & { item_count: number })[] {
  return stmtGetOrdersByStatus.all(tenantId, status, limit) as (Order & {
    item_count: number;
  })[];
}
