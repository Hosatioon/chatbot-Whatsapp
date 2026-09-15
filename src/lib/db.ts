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
  cancel_reason: string | null;
  deleted_at: number | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
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

export interface DeliveryZone {
  id: number;
  tenant_id: number;
  zone_name: string;
  price: number;
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
  catalog_url: string | null;
  catalog_message: string | null;
  assistant_name: string | null;
  business_address: string | null;
  business_hours: string | null;
  out_of_hours_message: string | null;
  extra_links: string | null;
  feedback_message: string | null;
  admin_phone: string | null;
  delivery_price: number | null;
  business_location_url: string | null;
  business_lat: number | null;
  business_lng: number | null;
  price_per_km: number | null;
  max_delivery_km: number | null;
  min_order_amount: number | null;
  min_delivery_price: number | null;
  bot_paused: number;
  paused_message: string | null;
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
  real_phone: string | null;
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

export type ConversationStateName =
  | "SELECTING_PRODUCTS"
  | "ASKING_DELIVERY_METHOD"
  | "ASKING_ADDRESS"
  | "ASKING_PAYMENT"
  | "WAITING_CONFIRMATION"
  | "CONFIRMED";

export interface DraftItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ConversationState {
  conversation_id: number;
  tenant_id: number;
  state: ConversationStateName;
  draft_items: DraftItem[];
  draft_delivery_method: string | null;
  draft_delivery_zone: string | null;
  draft_delivery_price: number | null;
  draft_address: string | null;
  draft_lat: number | null;
  draft_lng: number | null;
  // "gps" cuando la dirección vino de un pin de ubicación real que mandó
  // el cliente (ya tiene el link, no hace falta devolvérselo en el
  // resumen) vs "text" cuando la resolvimos nosotros a partir de texto
  // (ahí sí vale la pena mandarle el link para que confirme que
  // entendimos bien a dónde va el domicilio).
  draft_address_source: "gps" | "text" | null;
  // BUG real encontrado (2026-09-15): tanto un pin de GPS como una
  // dirección de texto corta ("conjunto boreal") pueden resolverse sin
  // ningún dato de torre/apto/casa — el domiciliario llega al lugar pero
  // no sabe a qué puerta ir. La regla que le pedía esto al LLM existía en
  // el prompt hace rato, pero como no era un chequeo del backend, no se
  // aplicaba siempre. Este flag es la fuente de verdad: se pone en true
  // solo cuando de verdad se capturó una referencia (torre/apto/casa/etc)
  // o el cliente dijo explícitamente que no tiene ninguna — hasta que eso
  // pase, el flujo no avanza a preguntar el pago.
  draft_address_has_detail: boolean;
  draft_payment: string | null;
  updated_at: number;
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

  CREATE TABLE IF NOT EXISTS conversation_state (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id),
    tenant_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'SELECTING_PRODUCTS',
    draft_items TEXT,
    draft_delivery_method TEXT,
    draft_delivery_zone TEXT,
    draft_delivery_price INTEGER,
    draft_address TEXT,
    draft_payment TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

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
if (!columnExists("conversation_state", "draft_delivery_method")) {
  db.exec(
    `ALTER TABLE conversation_state ADD COLUMN draft_delivery_method TEXT`,
  );
}
if (!columnExists("conversation_state", "draft_delivery_zone")) {
  db.exec(`ALTER TABLE conversation_state ADD COLUMN draft_delivery_zone TEXT`);
}
if (!columnExists("conversation_state", "draft_delivery_price")) {
  db.exec(
    `ALTER TABLE conversation_state ADD COLUMN draft_delivery_price INTEGER`,
  );
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

  CREATE TABLE IF NOT EXISTS order_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    description TEXT,
    old_value TEXT,
    new_value TEXT,
    actor TEXT DEFAULT 'system',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_history(order_id, created_at);

  CREATE TABLE IF NOT EXISTS delivery_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    zone_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
  CREATE INDEX IF NOT EXISTS idx_delivery_zones_tenant ON delivery_zones(tenant_id);
`);

// Migración: cancel_reason en orders
if (!columnExists("orders", "cancel_reason")) {
  db.exec(`ALTER TABLE orders ADD COLUMN cancel_reason TEXT`);
}
if (!columnExists("orders", "deleted_at")) {
  db.exec(`ALTER TABLE orders ADD COLUMN deleted_at INTEGER`);
}

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

// Dedup persistente de mensajes de WhatsApp (sobrevive reinicios del proceso)
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_messages (
    msg_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
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
// Planes reales de OrdiFast (definidos 2026-09-11): 3 niveles pagos por
// chats/día + una prueba gratuita. `INSERT OR IGNORE` no actualiza filas
// que ya existan con ese slug — si el precio real cambia más adelante,
// hay que correr un UPDATE aparte, este seed solo aplica en una base
// nueva que todavía no tiene estos planes.
stmtSeedPlans.run(
  "Prueba",
  "trial",
  15,
  0,
  0,
  "Prueba gratuita 15 días - 15 chats/día",
);
stmtSeedPlans.run(
  "Básico",
  "basico",
  10,
  60000,
  15.0,
  "10 chats/día",
);
stmtSeedPlans.run(
  "Intermedio",
  "intermedio",
  25,
  110000,
  27.5,
  "25 chats/día",
);
stmtSeedPlans.run(
  "Avanzado",
  "avanzado",
  50,
  200000,
  50.0,
  "50 chats/día",
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
if (!hasColumn("tenants", "catalog_url")) {
  db.exec("ALTER TABLE tenants ADD COLUMN catalog_url TEXT");
}
if (!hasColumn("tenants", "catalog_message")) {
  db.exec("ALTER TABLE tenants ADD COLUMN catalog_message TEXT");
}
if (!hasColumn("tenants", "assistant_name")) {
  db.exec("ALTER TABLE tenants ADD COLUMN assistant_name TEXT");
}
if (!hasColumn("tenants", "business_address")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_address TEXT");
}
if (!hasColumn("tenants", "business_hours")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_hours TEXT");
}
if (!hasColumn("tenants", "out_of_hours_message")) {
  db.exec("ALTER TABLE tenants ADD COLUMN out_of_hours_message TEXT");
}
if (!hasColumn("tenants", "extra_links")) {
  db.exec("ALTER TABLE tenants ADD COLUMN extra_links TEXT");
}
if (!hasColumn("tenants", "feedback_message")) {
  db.exec("ALTER TABLE tenants ADD COLUMN feedback_message TEXT");
}
if (!hasColumn("tenants", "admin_phone")) {
  db.exec("ALTER TABLE tenants ADD COLUMN admin_phone TEXT");
}
if (!hasColumn("tenants", "delivery_price")) {
  db.exec("ALTER TABLE tenants ADD COLUMN delivery_price INTEGER");
}
if (!hasColumn("tenants", "business_location_url")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_location_url TEXT");
}
if (!hasColumn("tenants", "business_lat")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_lat REAL");
}
if (!hasColumn("tenants", "business_lng")) {
  db.exec("ALTER TABLE tenants ADD COLUMN business_lng REAL");
}
if (!hasColumn("tenants", "price_per_km")) {
  db.exec("ALTER TABLE tenants ADD COLUMN price_per_km INTEGER");
}
if (!hasColumn("tenants", "max_delivery_km")) {
  db.exec("ALTER TABLE tenants ADD COLUMN max_delivery_km REAL");
}
if (!hasColumn("tenants", "min_order_amount")) {
  db.exec("ALTER TABLE tenants ADD COLUMN min_order_amount INTEGER");
}
if (!hasColumn("tenants", "min_delivery_price")) {
  db.exec("ALTER TABLE tenants ADD COLUMN min_delivery_price INTEGER");
}
if (!hasColumn("tenants", "bot_paused")) {
  db.exec("ALTER TABLE tenants ADD COLUMN bot_paused INTEGER NOT NULL DEFAULT 0");
}
if (!hasColumn("tenants", "paused_message")) {
  db.exec("ALTER TABLE tenants ADD COLUMN paused_message TEXT");
}
if (!columnExists("conversation_state", "draft_lat")) {
  db.exec("ALTER TABLE conversation_state ADD COLUMN draft_lat REAL");
}
if (!columnExists("conversation_state", "draft_lng")) {
  db.exec("ALTER TABLE conversation_state ADD COLUMN draft_lng REAL");
}
if (!columnExists("conversation_state", "draft_address_source")) {
  db.exec(
    "ALTER TABLE conversation_state ADD COLUMN draft_address_source TEXT",
  );
}
if (!columnExists("conversation_state", "draft_address_has_detail")) {
  db.exec(
    "ALTER TABLE conversation_state ADD COLUMN draft_address_has_detail INTEGER NOT NULL DEFAULT 0",
  );
}
if (!hasColumn("conversations", "real_phone")) {
  db.exec("ALTER TABLE conversations ADD COLUMN real_phone TEXT");
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

// Tabla de lugares conocidos por negocio (aprendizaje automático de direcciones)
db.exec(`
  CREATE TABLE IF NOT EXISTS known_places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    aliases TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    times_used INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    source TEXT NOT NULL DEFAULT 'confirmed',
    UNIQUE(tenant_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_known_places_tenant ON known_places(tenant_id);
`);
// BUG real encontrado (2026-09-10): un lugar cargado masivamente desde datos
// oficiales (aproximado, sin verificar) se resolvía sin pedir confirmación,
// igual que uno aprendido de un pedido real ya confirmado — un cliente dijo
// explícitamente "no es ese, es el barrio" y el pedido igual se guardó con
// la dirección equivocada. `source` distingue 'confirmed' (aprendido de un
// pedido real, alta confianza, no hace falta reconfirmar) de 'bulk_import'
// (carga masiva, se debe confirmar igual que una búsqueda ambigua).
if (!hasColumn("known_places", "source")) {
  db.exec(
    "ALTER TABLE known_places ADD COLUMN source TEXT NOT NULL DEFAULT 'confirmed'",
  );
}

// Migración: known_places pasa de ser por-tenant a compartido en toda la
// plataforma. Un lugar físico (ej: "Conjunto Boreal" en tal lat/lng) es un
// hecho geográfico, no un dato de negocio — no hay razón para que cada
// tenant nuevo tenga que redescubrirlo (mismas llamadas a Nominatim/OSRM,
// mismo trabajo de desambiguación) cuando otro tenant ya lo resolvió. Los
// datos de CLIENTES (customer_addresses, orders, conversations) siguen
// 100% separados por tenant como siempre — esto solo comparte la
// geografía, nunca quién pidió qué ni a quién.
function knownPlacesNeedsGlobalMigration(): boolean {
  const indexes = db
    .prepare<[], { name: string; unique: number; origin: string }>(
      `PRAGMA index_list(known_places)`,
    )
    .all();
  for (const idx of indexes) {
    if (idx.origin === "u" && idx.unique === 1) {
      const cols = db
        .prepare<[], { name: string }>(`PRAGMA index_info(${idx.name})`)
        .all();
      if (cols.length === 1 && cols[0].name === "name") {
        return false; // ya tiene UNIQUE(name) solo — ya migrado
      }
    }
  }
  return true;
}

if (knownPlacesNeedsGlobalMigration()) {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE known_places_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      aliases TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      times_used INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      source TEXT NOT NULL DEFAULT 'confirmed',
      UNIQUE(name)
    );
    INSERT OR IGNORE INTO known_places_new
      (id, tenant_id, name, aliases, lat, lng, times_used, created_at, source)
      SELECT id, tenant_id, name, aliases, lat, lng, times_used, created_at, source
      FROM known_places;
    DROP TABLE known_places;
    ALTER TABLE known_places_new RENAME TO known_places;
    CREATE INDEX idx_known_places_tenant ON known_places(tenant_id);
    COMMIT;
  `);
  db.pragma("foreign_keys = ON");
}

// Tabla de direcciones frecuentes por cliente
db.exec(`
  CREATE TABLE IF NOT EXISTS customer_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    reference TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(tenant_id, phone)
  );
  CREATE INDEX IF NOT EXISTS idx_customer_addresses_tenant_phone ON customer_addresses(tenant_id, phone);
`);

// Columnas de coordenadas de entrega en orders
if (!hasColumn("orders", "delivery_lat")) {
  db.exec("ALTER TABLE orders ADD COLUMN delivery_lat REAL");
}
if (!hasColumn("orders", "delivery_lng")) {
  db.exec("ALTER TABLE orders ADD COLUMN delivery_lng REAL");
}

export default db;

// Migración: los productos importados con stock 0 quedaban inactivos
// automáticamente. Ahora el estado activo/inactivo lo controla el usuario,
// así que reactivamos los productos bloqueados por stock cero.
db.exec(`UPDATE products SET active = 1 WHERE active = 0 AND stock = 0;`);

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

const stmtGetConvoByPhone = db.prepare<[number, string], Conversation>(
  "SELECT * FROM conversations WHERE tenant_id = ? AND phone = ?",
);
const stmtInsertConvo = db.prepare<
  [number, string, string | null, string | null, string | null]
>(
  "INSERT INTO conversations (tenant_id, phone, name, jid, real_phone) VALUES (?, ?, ?, ?, ?)",
);
const stmtUpdateConvoName = db.prepare<[string, number]>(
  "UPDATE conversations SET name = ? WHERE id = ?",
);
const stmtUpdateConvoJid = db.prepare<[string, number]>(
  "UPDATE conversations SET jid = ? WHERE id = ?",
);
const stmtUpdateConvoRealPhone = db.prepare<[string, number]>(
  "UPDATE conversations SET real_phone = ? WHERE id = ?",
);
const stmtFindConvoByRealPhone = db.prepare<[number, string], Conversation>(
  "SELECT * FROM conversations WHERE tenant_id = ? AND real_phone = ?",
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
  realPhone?: string | null,
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
    if (realPhone && realPhone !== existing.real_phone) {
      stmtUpdateConvoRealPhone.run(realPhone, existing.id);
      updated = { ...updated, real_phone: realPhone };
    }
    return updated;
  }
  const info = stmtInsertConvo.run(
    tenantId,
    phone,
    name ?? null,
    jid ?? null,
    realPhone ?? null,
  );
  const created = stmtGetConvoById.get(Number(info.lastInsertRowid));
  if (!created) throw new Error("No se pudo crear la conversación");
  return created;
}

export function findConversationByRealPhone(
  tenantId: number,
  realPhone: string,
): Conversation | null {
  return stmtFindConvoByRealPhone.get(tenantId, realPhone) ?? null;
}

const stmtFindConvoByPhoneSuffix = db.prepare<
  [number, string, string],
  Conversation
>(
  `SELECT c.* FROM conversations c
   WHERE c.tenant_id = ? AND (c.real_phone LIKE '%' || ? OR c.phone LIKE '%' || ?)
   ORDER BY (
     SELECT COUNT(*) FROM messages m
     WHERE m.conversation_id = c.id AND m.role = 'user'
   ) DESC, c.id DESC
   LIMIT 1`,
);

export function findConversationByPhoneSuffix(
  tenantId: number,
  phoneSuffix: string,
): Conversation | null {
  return (
    stmtFindConvoByPhoneSuffix.get(tenantId, phoneSuffix, phoneSuffix) ?? null
  );
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
// Estado de conversación + draft order
// ---------------------------------------------------------------------------

const stmtGetConvState = db.prepare<
  [number],
  {
    conversation_id: number;
    tenant_id: number;
    state: string;
    draft_items: string | null;
    draft_delivery_method: string | null;
    draft_delivery_zone: string | null;
    draft_delivery_price: number | null;
    draft_address: string | null;
    draft_lat: number | null;
    draft_lng: number | null;
    draft_address_source: string | null;
    draft_address_has_detail: number;
    draft_payment: string | null;
    updated_at: number;
  }
>("SELECT * FROM conversation_state WHERE conversation_id = ?");

export function getConversationState(
  conversationId: number,
  tenantId: number,
): ConversationState {
  const row = stmtGetConvState.get(conversationId);
  if (row) {
    return {
      conversation_id: row.conversation_id,
      tenant_id: row.tenant_id,
      state: row.state as ConversationStateName,
      draft_items: row.draft_items ? JSON.parse(row.draft_items) : [],
      draft_delivery_method: row.draft_delivery_method ?? null,
      draft_delivery_zone: row.draft_delivery_zone ?? null,
      draft_delivery_price: row.draft_delivery_price ?? null,
      draft_address: row.draft_address,
      draft_lat: row.draft_lat ?? null,
      draft_lng: row.draft_lng ?? null,
      draft_address_source:
        (row.draft_address_source as "gps" | "text" | null) ?? null,
      draft_address_has_detail: !!row.draft_address_has_detail,
      draft_payment: row.draft_payment,
      updated_at: row.updated_at,
    };
  }
  // No existe, crear default
  const defaultState: ConversationState = {
    conversation_id: conversationId,
    tenant_id: tenantId,
    state: "SELECTING_PRODUCTS",
    draft_items: [],
    draft_delivery_method: null,
    draft_delivery_zone: null,
    draft_delivery_price: null,
    draft_address: null,
    draft_lat: null,
    draft_lng: null,
    draft_address_source: null,
    draft_address_has_detail: false,
    draft_payment: null,
    updated_at: Math.floor(Date.now() / 1000),
  };
  upsertConversationState(defaultState);
  return defaultState;
}

const stmtUpsertConvState = db.prepare<
  [
    number,
    number,
    string,
    string | null,
    string | null,
    string | null,
    number | null,
    string | null,
    number | null,
    number | null,
    string | null,
    number,
    string | null,
  ]
>(
  `INSERT INTO conversation_state (conversation_id, tenant_id, state, draft_items, draft_delivery_method, draft_delivery_zone, draft_delivery_price, draft_address, draft_lat, draft_lng, draft_address_source, draft_address_has_detail, draft_payment, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
   ON CONFLICT(conversation_id) DO UPDATE SET
     state = excluded.state,
     draft_items = excluded.draft_items,
     draft_delivery_method = excluded.draft_delivery_method,
     draft_delivery_zone = excluded.draft_delivery_zone,
     draft_delivery_price = excluded.draft_delivery_price,
     draft_address = excluded.draft_address,
     draft_lat = excluded.draft_lat,
     draft_lng = excluded.draft_lng,
     draft_address_source = excluded.draft_address_source,
     draft_address_has_detail = excluded.draft_address_has_detail,
     draft_payment = excluded.draft_payment,
     updated_at = unixepoch()`,
);

export function upsertConversationState(state: ConversationState): void {
  stmtUpsertConvState.run(
    state.conversation_id,
    state.tenant_id,
    state.state,
    state.draft_items.length > 0 ? JSON.stringify(state.draft_items) : null,
    state.draft_delivery_method,
    state.draft_delivery_zone,
    state.draft_delivery_price,
    state.draft_address,
    state.draft_lat,
    state.draft_lng,
    state.draft_address_source,
    state.draft_address_has_detail ? 1 : 0,
    state.draft_payment,
  );
}

const stmtClearConvState = db.prepare<[number]>(
  "DELETE FROM conversation_state WHERE conversation_id = ?",
);

export function clearConversationState(conversationId: number): void {
  stmtClearConvState.run(conversationId);
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
const stmtDeleteConversationState = db.prepare<[number]>(
  "DELETE FROM conversation_state WHERE conversation_id = ?",
);
const stmtDeleteOutbox = db.prepare<[number]>(
  "DELETE FROM outbox WHERE conversation_id = ?",
);
const stmtDeleteConvo = db.prepare<[number, number]>(
  "DELETE FROM conversations WHERE id = ? AND tenant_id = ?",
);

const txDeleteConversation = db.transaction(
  (tenantId: number, conversationId: number) => {
    stmtDeleteMessages.run(conversationId, tenantId);
    stmtDeleteConversationState.run(conversationId);
    stmtDeleteOutbox.run(conversationId);
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
  "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE tenant_id = ? AND active = 1 ORDER BY name COLLATE NOCASE ASC",
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
  const variantsJson =
    variants && variants.length > 0 ? JSON.stringify(variants) : null;
  const info = stmtInsertProduct.run(
    tenantId,
    name,
    price,
    stock,
    1, // Activo por defecto; stock 0 no implica inactivo
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
  const variantsJson =
    variants && variants.length > 0 ? JSON.stringify(variants) : null;

  // Preservar el estado activo/inactivo actual. El usuario lo controla
  // con toggleProductActive; stock 0 no desactiva automáticamente.
  const current = getProductById(id, tenantId);
  const active = current?.active ?? 1;

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
// Búsqueda de productos para function calling del LLM
// ---------------------------------------------------------------------------

const stmtSearchProducts = db.prepare<
  [number, string, string, number],
  Product
>(
  `SELECT * FROM products WHERE tenant_id = ? AND active = 1 AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ?) ORDER BY name COLLATE NOCASE ASC LIMIT ?`,
);

const stmtAllActiveProducts = db.prepare<[number], Product>(
  `SELECT * FROM products WHERE tenant_id = ? AND active = 1`,
);

const SEARCH_STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "con",
  "sin",
  "un",
  "una",
  "por",
  "para",
  "del",
  "al",
  "lo",
  "le",
  "se",
  "su",
  "sus",
  "y",
  "o",
  "u",
  "ni",
  "que",
  "en",
  "es",
  "mi",
  "me",
  "te",
]);

function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function searchProducts(
  tenantId: number,
  query: string,
  limit = 10,
): Product[] {
  const rawWords = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !SEARCH_STOPWORDS.has(w))
    .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w));

  if (rawWords.length === 0) {
    const fallbackWords = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    if (fallbackWords.length === 0) return [];
    const fbWord = normalizeForSearch(fallbackWords[0]);
    return (stmtAllActiveProducts.all(tenantId) as Product[]).filter((p) =>
      normalizeForSearch(p.name).includes(fbWord),
    );
  }

  const words = rawWords.map(normalizeForSearch);
  const allProducts = stmtAllActiveProducts.all(tenantId) as Product[];

  // Umbral mínimo: cada palabra debe coincidir en el nombre (score += 2 por palabra en nombre).
  // Si hay 2 palabras, el score mínimo es 4. Esto evita que "torta de almojabana"
  // devuelva "Torta 3 leches" (que solo coincide con "torta", score=2).
  const minScore = words.length * 2;

  const scored = allProducts
    .map((p) => {
      const normName = normalizeForSearch(p.name);
      const normDesc = normalizeForSearch(p.description ?? "");
      let score = 0;
      for (const word of words) {
        if (normName.includes(word)) score += 2;
        if (normDesc.includes(word)) score += 1;
      }
      return { product: p, score };
    })
    .filter((s) => s.score >= minScore)
    .sort(
      (a, b) =>
        b.score - a.score || a.product.name.localeCompare(b.product.name),
    )
    .slice(0, limit)
    .map((s) => s.product);

  return scored;
}

const stmtGetProductByNameExact = db.prepare<[number, string], Product>(
  `SELECT * FROM products WHERE tenant_id = ? AND active = 1 AND LOWER(name) = ? LIMIT 1`,
);
const stmtGetProductByNameLike = db.prepare<[number, string], Product>(
  `SELECT * FROM products WHERE tenant_id = ? AND active = 1 AND LOWER(name) LIKE ? ORDER BY name COLLATE NOCASE ASC LIMIT 1`,
);

export function getProductByName(
  tenantId: number,
  name: string,
): Product | null {
  // 1. Match exacto (case-insensitive) — prioritario para no descontar
  //    stock del producto equivocado.
  const exact = stmtGetProductByNameExact.get(tenantId, name.toLowerCase());
  if (exact) return exact;
  // 2. LIKE como fallback (ej: "nutella" → "Galleta de Nutella")
  const like = stmtGetProductByNameLike.get(
    tenantId,
    `%${name.toLowerCase()}%`,
  );
  if (like) return like;
  // 3. Búsqueda full-text como último recurso
  const results = searchProducts(tenantId, name, 1);
  return results[0] ?? null;
}

const stmtGetProductStock = db.prepare<
  [number, string],
  { id: number; name: string; stock: number }
>(
  `SELECT id, name, stock FROM products WHERE tenant_id = ? AND active = 1 AND LOWER(name) LIKE ? LIMIT 1`,
);

export function getProductStock(
  tenantId: number,
  name: string,
): { id: number; name: string; stock: number } | null {
  const product = getProductByName(tenantId, name);
  if (!product) return null;
  return { id: product.id, name: product.name, stock: product.stock };
}

const stmtDecrementStock = db.prepare<[number, number, number]>(
  `UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND tenant_id = ?`,
);

export function decrementStock(
  tenantId: number,
  productId: number,
  quantity: number,
): void {
  stmtDecrementStock.run(quantity, productId, tenantId);
}

const stmtGetTopProducts = db.prepare<[number, number], Product>(
  // BUG real encontrado (2026-09-12): esta lista alimenta el catálogo
  // "PRODUCTOS PRINCIPALES" que ve el LLM en el prompt. Con ORDER BY name
  // normal (case-sensitive), un producto con la primera palabra en
  // minúscula (ej: "Galleta de pistacho") queda ordenado DESPUÉS de todos
  // los que empiezan con mayúscula, cayéndose del LIMIT/top-10 aunque
  // alfabéticamente debería estar ahí. El cliente pidió "pistacho", el LLM
  // no lo vio en su lista de contexto y terminó anotando "Limón" (que sí
  // aparecía justo ahí) en su lugar — pedido mal anotado. COLLATE NOCASE
  // ordena por letra sin importar mayúsculas/minúsculas, como debe ser.
  `SELECT * FROM products WHERE tenant_id = ? AND active = 1 AND stock > 0 ORDER BY name COLLATE NOCASE ASC LIMIT ?`,
);

export function getTopProducts(tenantId: number, limit = 10): Product[] {
  return stmtGetTopProducts.all(tenantId, limit);
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

const stmtListActiveTenantsForBot = db.prepare<[], Tenant>(
  `SELECT t.* FROM tenants t
   LEFT JOIN tenant_plans tp ON tp.tenant_id = t.id
   WHERE tp.status IS NULL OR tp.status IN ('active', 'trial')
   ORDER BY t.id ASC`,
);

export function listActiveTenantsForBot(): Tenant[] {
  return stmtListActiveTenantsForBot.all();
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
  catalog_url: string | null;
  catalog_message: string | null;
  assistant_name: string | null;
  business_address: string | null;
  business_hours: string | null;
  out_of_hours_message: string | null;
  extra_links: string | null;
  feedback_message: string | null;
  admin_phone: string | null;
  delivery_price: number | null;
  business_location_url: string | null;
  price_per_km: number | null;
  max_delivery_km: number | null;
  min_order_amount: number | null;
  min_delivery_price: number | null;
  bot_paused: boolean;
  paused_message: string | null;
}

export interface TenantLink {
  label: string;
  url: string;
}

export interface BusinessHours {
  enabled: boolean;
  days: number[];
  open: string;
  close: string;
}

const stmtUpdateTenantConfig = db.prepare<
  [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    number | null,
    string | null,
    number | null,
    number | null,
    number | null,
    number | null,
    number,
    string | null,
    number,
  ]
>(
  `UPDATE tenants SET business_name = ?, business_type = ?, payment_info = ?, custom_greeting = ?, custom_prompt = ?, catalog_url = ?, catalog_message = ?, assistant_name = ?, business_address = ?, business_hours = ?, out_of_hours_message = ?, extra_links = ?, feedback_message = ?, admin_phone = ?, delivery_price = ?, business_location_url = ?, price_per_km = ?, max_delivery_km = ?, min_order_amount = ?, min_delivery_price = ?, bot_paused = ?, paused_message = ? WHERE id = ?`,
);

export function updateTenantConfig(
  tenantId: number,
  config: TenantConfig,
): void {
  stmtUpdateTenantConfig.run(
    config.business_name || null,
    config.business_type || null,
    config.payment_info || null,
    config.custom_greeting || null,
    config.custom_prompt || null,
    config.catalog_url || null,
    config.catalog_message || null,
    config.assistant_name || null,
    config.business_address || null,
    config.business_hours || null,
    config.out_of_hours_message || null,
    config.extra_links || null,
    config.feedback_message || null,
    config.admin_phone || null,
    config.delivery_price ?? null,
    config.business_location_url || null,
    config.price_per_km ?? null,
    config.max_delivery_km ?? null,
    config.min_order_amount ?? null,
    config.min_delivery_price ?? null,
    config.bot_paused ? 1 : 0,
    config.paused_message || null,
    tenantId,
  );
}

export function getTenantLinks(tenant: Tenant): TenantLink[] {
  const links: TenantLink[] = [];
  if (tenant.catalog_url) {
    links.push({ label: "Catálogo", url: tenant.catalog_url });
  }
  if (tenant.extra_links) {
    try {
      const parsed = JSON.parse(tenant.extra_links) as TenantLink[];
      if (Array.isArray(parsed)) {
        for (const l of parsed) {
          if (l && typeof l.label === "string" && typeof l.url === "string") {
            links.push({ label: l.label, url: l.url });
          }
        }
      }
    } catch {
      // JSON inválido, ignorar
    }
  }
  return links;
}

export function parseBusinessHours(raw: string | null): BusinessHours | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BusinessHours;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.days) || !parsed.open || !parsed.close)
      return null;
    return {
      enabled: !!parsed.enabled,
      days: parsed.days.filter((d) => d >= 1 && d <= 7),
      open: parsed.open,
      close: parsed.close,
    };
  } catch {
    return null;
  }
}

export function isWithinBusinessHours(
  hours: BusinessHours,
  now: Date = new Date(),
): boolean {
  if (!hours.enabled) return true;
  const day = now.getDay() === 0 ? 7 : now.getDay();
  if (!hours.days.includes(day)) return false;
  const [openH, openM] = hours.open.split(":").map(Number);
  const [closeH, closeM] = hours.close.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openMin = openH * 60 + openM;
  const closeMin = closeH * 60 + closeM;
  return nowMin >= openMin && nowMin < closeMin;
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
// Retención de mensajes: se borra el TEXTO de la conversación después de
// mucho tiempo sin actividad — no por fecha de calendario (un negocio que
// cierra pasada la medianoche no tiene un "fin de día" limpio), sino por
// inactividad real de esa conversación puntual. Los PEDIDOS (orders) NUNCA
// se tocan acá — son el registro real de la venta, se quedan indefinidos.
// La fila de `conversations` tampoco se borra (se necesita para saber que
// ese cliente ya existió, y para las métricas de clientes recurrentes),
// solo su historial de mensajes.
// ---------------------------------------------------------------------------

const stmtPurgeOldConversationMessages = db.prepare<[number]>(
  `DELETE FROM messages WHERE conversation_id IN (
     SELECT id FROM conversations WHERE last_message_at IS NOT NULL AND last_message_at < ?
   )`,
);

export function purgeOldConversationMessages(inactivityDays = 90): number {
  const cutoff = Math.floor(Date.now() / 1000) - inactivityDays * 86400;
  const info = stmtPurgeOldConversationMessages.run(cutoff);
  return info.changes;
}

// ---------------------------------------------------------------------------
// Dedup persistente de mensajes entrantes de WhatsApp
// ---------------------------------------------------------------------------

const stmtIsMsgProcessed = db.prepare<[string], { msg_id: string }>(
  "SELECT msg_id FROM processed_messages WHERE msg_id = ?",
);

const stmtMarkMsgProcessed = db.prepare<[string]>(
  "INSERT OR IGNORE INTO processed_messages (msg_id) VALUES (?)",
);

const stmtPurgeOldProcessed = db.prepare<[number]>(
  "DELETE FROM processed_messages WHERE created_at < ?",
);

export function isMessageProcessed(msgId: string): boolean {
  return !!stmtIsMsgProcessed.get(msgId);
}

export function markMessageProcessed(msgId: string): void {
  stmtMarkMsgProcessed.run(msgId);
}

export function purgeOldProcessedMessages(olderThanSeconds = 86400): void {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
  stmtPurgeOldProcessed.run(cutoff);
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
  delivery_lat?: number | null;
  delivery_lng?: number | null;
}

// Prepared statements para pedidos
const stmtInsertOrder = db.prepare(`
  INSERT INTO orders (tenant_id, customer_phone, customer_name, status, total_amount, notes, delivery_lat, delivery_lng, created_at, updated_at)
  VALUES (?, ?, ?, 'PENDING', 0, ?, ?, ?, unixepoch(), unixepoch())
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
      input.delivery_lat ?? null,
      input.delivery_lng ?? null,
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

      // Descontar stock
      const product = getProductByName(input.tenant_id, item.product_name);
      if (product) {
        decrementStock(input.tenant_id, product.id, item.quantity);
      }
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

// Obtener el último pedido de un cliente por teléfono
export function getLastOrderByPhone(
  tenantId: number,
  customerPhone: string,
): (Order & { items: OrderItem[] }) | null {
  const order = db
    .prepare<[number, string], Order>(
      `SELECT * FROM orders
       WHERE tenant_id = ? AND customer_phone = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(tenantId, customerPhone);

  if (!order) return null;

  const items = stmtGetOrderItems.all(order.id) as OrderItem[];
  return { ...order, items };
}

// === Delivery Zones CRUD ===

const stmtGetDeliveryZones = db.prepare<[number], DeliveryZone>(
  `SELECT * FROM delivery_zones WHERE tenant_id = ? ORDER BY zone_name`,
);

export function getDeliveryZones(tenantId: number): DeliveryZone[] {
  return stmtGetDeliveryZones.all(tenantId);
}

export function addDeliveryZone(
  tenantId: number,
  zoneName: string,
  price: number,
): DeliveryZone {
  const result = db
    .prepare<
      [number, string, number]
    >(`INSERT INTO delivery_zones (tenant_id, zone_name, price) VALUES (?, ?, ?)`)
    .run(tenantId, zoneName, price);
  return {
    id: result.lastInsertRowid as number,
    tenant_id: tenantId,
    zone_name: zoneName,
    price,
  };
}

export function updateDeliveryZone(
  id: number,
  tenantId: number,
  zoneName: string,
  price: number,
): boolean {
  const result = db
    .prepare<
      [string, number, number, number]
    >(`UPDATE delivery_zones SET zone_name = ?, price = ? WHERE id = ? AND tenant_id = ?`)
    .run(zoneName, price, id, tenantId);
  return result.changes > 0;
}

export function deleteDeliveryZone(id: number, tenantId: number): boolean {
  const result = db
    .prepare<
      [number, number]
    >(`DELETE FROM delivery_zones WHERE id = ? AND tenant_id = ?`)
    .run(id, tenantId);
  return result.changes > 0;
}

export function findDeliveryZone(
  tenantId: number,
  text: string,
): DeliveryZone | null {
  const zones = getDeliveryZones(tenantId);
  const t = text.toLowerCase().trim();
  for (const zone of zones) {
    const zn = zone.zone_name.toLowerCase();
    if (t.includes(zn)) {
      return zone;
    }
  }
  for (const zone of zones) {
    const zn = zone.zone_name.toLowerCase();
    if (zn.startsWith(t) || t.startsWith(zn) || levenshteinClose(t, zn, 3)) {
      return zone;
    }
  }
  return null;
}

function levenshteinClose(a: string, b: string, maxDist: number): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost));
    }
    if (Math.min(...curr) > maxDist) return false;
    prev = curr;
  }
  return prev[b.length] <= maxDist;
}

// Actualizar estado de un pedido
export function updateOrderStatus(
  tenantId: number,
  orderId: number,
  status: OrderStatus,
  cancelReason?: string,
): boolean {
  const current = stmtGetOrderById.get(orderId, tenantId) as Order | undefined;
  if (!current) return false;

  const result = stmtUpdateOrderStatus.run(status, orderId, tenantId);

  if (result.changes > 0) {
    // Registrar en historial
    stmtInsertOrderHistory.run(
      orderId,
      "STATUS_CHANGE",
      `Estado: ${current.status} → ${status}`,
      current.status,
      status,
      "operator",
    );

    // Si se canceló, guardar motivo
    if (status === "CANCELLED" && cancelReason) {
      db.prepare(
        "UPDATE orders SET cancel_reason = ? WHERE id = ? AND tenant_id = ?",
      ).run(cancelReason, orderId, tenantId);
      stmtInsertOrderHistory.run(
        orderId,
        "CANCEL_REASON",
        `Motivo de cancelación: ${cancelReason}`,
        null,
        cancelReason,
        "operator",
      );
    }
  }

  return result.changes > 0;
}

// --- Order History ---

export interface OrderHistoryEntry {
  id: number;
  order_id: number;
  event: string;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: string;
  created_at: number;
}

const stmtInsertOrderHistory = db.prepare(`
  INSERT INTO order_history (order_id, event, description, old_value, new_value, actor)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtGetOrderHistory = db.prepare(`
  SELECT * FROM order_history WHERE order_id = ? ORDER BY created_at ASC
`);

export function getOrderHistory(orderId: number): OrderHistoryEntry[] {
  return stmtGetOrderHistory.all(orderId) as OrderHistoryEntry[];
}

// --- Delete Order (solo PENDIENTE) ---

export function deleteOrder(tenantId: number, orderId: number): boolean {
  const order = stmtGetOrderById.get(orderId, tenantId) as Order | undefined;
  if (!order) return false;
  if (order.status !== "PENDING") return false;

  db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
  db.prepare("DELETE FROM order_history WHERE order_id = ?").run(orderId);
  const result = db
    .prepare("DELETE FROM orders WHERE id = ? AND tenant_id = ?")
    .run(orderId, tenantId);
  return result.changes > 0;
}

// --- Update Order (con restricciones por estado) ---

export interface UpdateOrderInput {
  customer_name?: string | null;
  customer_phone?: string;
  notes?: string | null;
  items?: { product_name: string; quantity: number; unit_price: number }[];
}

export function updateOrder(
  tenantId: number,
  orderId: number,
  updates: UpdateOrderInput,
): (Order & { items: OrderItem[] }) | null {
  const order = stmtGetOrderById.get(orderId, tenantId) as Order | undefined;
  if (!order) return null;

  // Entregado: read-only
  if (order.status === "DELIVERED") return null;

  const allowedFields: Record<string, boolean> = {
    customer_name: true,
    customer_phone: true,
    notes: true,
    items: order.status === "PENDING" || order.status === "CONFIRMED",
  };

  const transaction = db.transaction(() => {
    if (updates.customer_name !== undefined && allowedFields.customer_name) {
      db.prepare(
        "UPDATE orders SET customer_name = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?",
      ).run(updates.customer_name, orderId, tenantId);
      stmtInsertOrderHistory.run(
        orderId,
        "FIELD_CHANGE",
        "Cliente actualizado",
        order.customer_name,
        updates.customer_name,
        "operator",
      );
    }

    if (updates.customer_phone !== undefined && allowedFields.customer_phone) {
      db.prepare(
        "UPDATE orders SET customer_phone = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?",
      ).run(updates.customer_phone, orderId, tenantId);
      stmtInsertOrderHistory.run(
        orderId,
        "FIELD_CHANGE",
        "Teléfono actualizado",
        order.customer_phone,
        updates.customer_phone,
        "operator",
      );
    }

    if (updates.notes !== undefined && allowedFields.notes) {
      db.prepare(
        "UPDATE orders SET notes = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?",
      ).run(updates.notes, orderId, tenantId);
      stmtInsertOrderHistory.run(
        orderId,
        "FIELD_CHANGE",
        "Notas actualizadas",
        order.notes,
        updates.notes,
        "operator",
      );
    }

    if (updates.items && allowedFields.items) {
      // Reemplazar items
      db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
      let total = 0;
      for (const item of updates.items) {
        const totalPrice = item.quantity * item.unit_price;
        total += totalPrice;
        stmtInsertOrderItem.run(
          orderId,
          item.product_name,
          item.quantity,
          item.unit_price,
          totalPrice,
        );
      }
      db.prepare(
        "UPDATE orders SET total_amount = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?",
      ).run(total, orderId, tenantId);
      stmtInsertOrderHistory.run(
        orderId,
        "ITEMS_CHANGE",
        "Productos actualizados",
        null,
        JSON.stringify(updates.items),
        "operator",
      );
    }
  });

  transaction();

  const updated = stmtGetOrderById.get(orderId, tenantId) as Order | undefined;
  if (!updated) return null;
  const items = stmtGetOrderItems.all(orderId) as OrderItem[];
  return { ...updated, items };
}

// --- Duplicate Order ---

export function duplicateOrder(
  tenantId: number,
  orderId: number,
): (Order & { items: OrderItem[] }) | null {
  const original = getOrderById(tenantId, orderId);
  if (!original) return null;

  const input: CreateOrderInput = {
    tenant_id: tenantId,
    customer_phone: original.customer_phone,
    customer_name: original.customer_name,
    items: original.items.map((item) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })),
    notes: original.notes,
  };

  const newOrder = createOrder(input);
  stmtInsertOrderHistory.run(
    newOrder.id,
    "ORDER_DUPLICATED",
    `Duplicado del pedido #${orderId}`,
    String(orderId),
    null,
    "operator",
  );
  return newOrder;
}

// --- Search Orders ---

export interface OrderSearchParams {
  tenantId: number;
  status?: OrderStatus;
  search?: string;
  dateFrom?: number;
  dateTo?: number;
  limit?: number;
}

export function searchOrders(
  params: OrderSearchParams,
): (Order & { item_count: number })[] {
  let sql = `
    SELECT o.*, COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.tenant_id = ? AND o.deleted_at IS NULL
  `;
  const args: (string | number)[] = [params.tenantId];

  if (params.status) {
    sql += ` AND o.status = ?`;
    args.push(params.status);
  }

  if (params.search) {
    sql += ` AND (o.customer_name LIKE ? OR o.customer_phone LIKE ? OR EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id AND oi2.product_name LIKE ?))`;
    const pattern = `%${params.search}%`;
    args.push(pattern, pattern, pattern);
  }

  if (params.dateFrom) {
    sql += ` AND o.created_at >= ?`;
    args.push(params.dateFrom);
  }

  if (params.dateTo) {
    sql += ` AND o.created_at <= ?`;
    args.push(params.dateTo);
  }

  sql += ` GROUP BY o.id ORDER BY o.created_at DESC LIMIT ?`;
  args.push(params.limit || 50);

  return db.prepare(sql).all(...args) as (Order & { item_count: number })[];
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

// ---------------------------------------------------------------------------
// Super-Admin Overview — métricas globales de todos los tenants
// ---------------------------------------------------------------------------

export interface TenantOverviewRow {
  id: number;
  name: string;
  slug: string;
  plan_name: string | null;
  plan_slug: string | null;
  daily_chat_limit: number;
  chats_today: number;
  messages_today: number;
  tokens_today: number;
  cost_today_usd: number;
  cost_month_usd: number;
  llm_calls_today: number;
  orders_today: number;
  active_products: number;
  total_conversations: number;
  status: "active" | "warning" | "critical";
}

const stmtTenantsOverview = db.prepare<
  [],
  {
    id: number;
    name: string;
    slug: string;
    plan_name: string | null;
    plan_slug: string | null;
    daily_chat_limit: number;
    chats_today: number;
    messages_today: number;
    tokens_today: number;
    cost_today_usd: number;
    cost_month_usd: number;
    llm_calls_today: number;
    orders_today: number;
    active_products: number;
    total_conversations: number;
    trial_end_date: number | null;
  }
>(
  `SELECT
     t.id, t.name, t.slug,
     p.name as plan_name, p.slug as plan_slug,
     COALESCE(p.daily_chat_limit, 0) as daily_chat_limit,
     tp.trial_end_date,
     COALESCE(du.conversation_count, 0) as chats_today,
     COALESCE(du.message_count, 0) as messages_today,
     COALESCE(llm_today.total_tokens, 0) as tokens_today,
     COALESCE(llm_today.total_cost, 0) as cost_today_usd,
     COALESCE(llm_today.call_count, 0) as llm_calls_today,
     COALESCE(llm_month.total_cost, 0) as cost_month_usd,
     COALESCE(ord_today.cnt, 0) as orders_today,
     COALESCE(prod_active.cnt, 0) as active_products,
     COALESCE(conv_total.cnt, 0) as total_conversations
   FROM tenants t
   LEFT JOIN tenant_plans tp ON tp.tenant_id = t.id
   LEFT JOIN plans p ON p.id = tp.plan_id
   LEFT JOIN (
     SELECT tenant_id,
            SUM(conversation_count) as conversation_count,
            SUM(message_count) as message_count
     FROM tenant_daily_usage
     WHERE date = date('now')
     GROUP BY tenant_id
   ) du ON du.tenant_id = t.id
   LEFT JOIN (
     SELECT tenant_id,
            SUM(total_tokens) as total_tokens,
            SUM(cost_usd) as total_cost,
            COUNT(*) as call_count
     FROM llm_usage
     WHERE created_at >= unixepoch('now', 'start of day')
     GROUP BY tenant_id
   ) llm_today ON llm_today.tenant_id = t.id
   LEFT JOIN (
     SELECT tenant_id, SUM(cost_usd) as total_cost
     FROM llm_usage
     WHERE created_at >= unixepoch('now', 'start of month')
     GROUP BY tenant_id
   ) llm_month ON llm_month.tenant_id = t.id
   LEFT JOIN (
     SELECT tenant_id, COUNT(*) as cnt
     FROM orders
     WHERE created_at >= unixepoch('now', 'start of day') AND deleted_at IS NULL
     GROUP BY tenant_id
   ) ord_today ON ord_today.tenant_id = t.id
   LEFT JOIN (
     SELECT tenant_id, COUNT(*) as cnt
     FROM products
     WHERE active = 1
     GROUP BY tenant_id
   ) prod_active ON prod_active.tenant_id = t.id
   LEFT JOIN (
     SELECT tenant_id, COUNT(*) as cnt
     FROM conversations
     GROUP BY tenant_id
   ) conv_total ON conv_total.tenant_id = t.id
   ORDER BY t.id`,
);

export function getTenantsAdminOverview(): TenantOverviewRow[] {
  const rows = stmtTenantsOverview.all();
  const dailyBudget = parseFloat(process.env.LLM_DAILY_BUDGET_USD || "1.0");
  const monthlyBudget = parseFloat(
    process.env.LLM_MONTHLY_BUDGET_USD || "25.0",
  );

  return rows.map((r) => {
    let status: "active" | "warning" | "critical" = "active";

    // Trial expirado
    if (r.trial_end_date && Date.now() / 1000 > r.trial_end_date) {
      status = "critical";
    }
    // Presupuesto LLM excedido
    else if (
      r.cost_today_usd >= dailyBudget ||
      r.cost_month_usd >= monthlyBudget
    ) {
      status = "critical";
    }
    // Cerca del límite de chats (80%+)
    else if (
      r.daily_chat_limit > 0 &&
      r.chats_today >= r.daily_chat_limit * 0.8
    ) {
      status = "warning";
    }
    // Cerca del presupuesto diario (80%+)
    else if (r.cost_today_usd >= dailyBudget * 0.8) {
      status = "warning";
    }

    return { ...r, status };
  });
}

// ---------------------------------------------------------------------------
// Lugares conocidos (known_places)
// ---------------------------------------------------------------------------

export type KnownPlaceSource = "confirmed" | "bulk_import";

export interface KnownPlace {
  id: number;
  tenant_id: number;
  name: string;
  aliases: string | null;
  lat: number;
  lng: number;
  times_used: number;
  created_at: number;
  source: KnownPlaceSource;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// known_places es compartido entre todos los tenants (ver migración
// arriba) — un lugar físico es el mismo sin importar qué negocio lo
// consulte, así que estas consultas ya NO filtran por tenant_id. La
// columna sigue existiendo solo como referencia de qué tenant lo generó
// primero, nunca se usa para restringir qué puede ver cada uno.
const stmtFindKnownPlace = db.prepare<[string], KnownPlace>(
  `SELECT * FROM known_places WHERE LOWER(name) = ?`,
);

// Trae TODOS los lugares conocidos (de cualquier tenant) para comparar en
// JS (nombre y alias en ambas direcciones). Un LIKE a nivel SQL solo
// contra `name` se pierde los casos donde la consulta del cliente trae
// MÁS palabras que el nombre guardado (ej: guardado "Guaduales del Otún",
// cliente escribe "guaduales del otun dosquebradas") — ahí
// `name LIKE '%query%'` nunca matchea porque `name` es más corto que
// `query`.
const stmtListKnownPlaces = db.prepare<[], KnownPlace>(
  `SELECT * FROM known_places ORDER BY times_used DESC`,
);

const stmtUpsertKnownPlace = db.prepare(
  `INSERT INTO known_places (tenant_id, name, aliases, lat, lng, times_used, created_at, source)
   VALUES (?, ?, ?, ?, ?, 1, unixepoch(), ?)
   ON CONFLICT(name) DO UPDATE SET
     lat = excluded.lat,
     lng = excluded.lng,
     times_used = times_used + 1,
     source = CASE WHEN excluded.source = 'confirmed' THEN 'confirmed' ELSE known_places.source END,
     aliases = CASE WHEN excluded.aliases IS NOT NULL THEN excluded.aliases ELSE known_places.aliases END`,
);

const stmtIncrementKnownPlaceUsage = db.prepare(
  `UPDATE known_places SET times_used = times_used + 1 WHERE id = ?`,
);

// Igual que findKnownPlace, pero devuelve TODOS los lugares que matchean
// en vez de quedarse con el primero. La usa el resolver de direcciones
// para poder detectar ambigüedad real (ej: "arboleda" matchea tanto
// "CONJUNTO RESIDENCIAL LA ARBOLEDA" como "CONDOMINIO ARBOLEDA DEL RIO",
// en coordenadas completamente distintas) en vez de adivinar cuál quiso
// decir el cliente y mandar el domicilio al lugar equivocado.
//
// `tenantId` se mantiene en la firma para no tener que tocar cada lugar
// que la llama, pero ya NO filtra nada — known_places es compartido en
// toda la plataforma (ver migración más arriba), así que un lugar que un
// tenant ya confirmó lo puede reutilizar cualquier otro sin tener que
// redescubrirlo. Solo se comparte la geografía; los pedidos/clientes de
// cada negocio siguen completamente separados como siempre.
export function findKnownPlaces(tenantId: number, query: string): KnownPlace[] {
  const normalized = normalizeText(query);
  // Coincidencia exacta de nombre: inequívoca por definición (el nombre
  // es único por tenant), no hace falta revisar más candidatos.
  const exact = stmtFindKnownPlace.get(normalized);
  if (exact) return [exact];

  const all = stmtListKnownPlaces.all();
  const matches: KnownPlace[] = [];
  for (const r of all) {
    let matched = false;
    if (r.aliases) {
      try {
        const aliases: string[] = JSON.parse(r.aliases);
        if (
          aliases.some((a) => {
            const aNorm = normalizeText(a);
            return (
              aNorm === normalized ||
              aNorm.includes(normalized) ||
              (normalized.length > 3 && normalized.includes(aNorm))
            );
          })
        ) {
          matched = true;
        }
      } catch {
        // ignore
      }
    }
    if (!matched) {
      const nameNorm = normalizeText(r.name);
      if (
        nameNorm.includes(normalized) ||
        (normalized.length > 3 && normalized.includes(nameNorm))
      ) {
        matched = true;
      }
    }
    if (matched) matches.push(r);
  }
  return matches;
}

export function findKnownPlace(
  tenantId: number,
  query: string,
): KnownPlace | null {
  const normalized = normalizeText(query);
  // Exact match
  const exact = stmtFindKnownPlace.get(normalized);
  if (exact) return exact;

  // Comparar contra todos los lugares conocidos (nombre y alias, en
  // ambas direcciones de contención) — ver nota en stmtListKnownPlaces.
  const all = stmtListKnownPlaces.all();
  for (const r of all) {
    if (r.aliases) {
      try {
        const aliases: string[] = JSON.parse(r.aliases);
        if (
          aliases.some((a) => {
            const aNorm = normalizeText(a);
            return (
              aNorm === normalized ||
              aNorm.includes(normalized) ||
              (normalized.length > 3 && normalized.includes(aNorm))
            );
          })
        ) {
          return r;
        }
      } catch {
        // ignore
      }
    }
    // If name contains the query or query contains the name
    const nameNorm = normalizeText(r.name);
    if (
      nameNorm.includes(normalized) ||
      (normalized.length > 3 && normalized.includes(nameNorm))
    ) {
      return r;
    }
  }
  return null;
}

export function upsertKnownPlace(
  tenantId: number,
  name: string,
  lat: number,
  lng: number,
  aliases?: string[],
  source: KnownPlaceSource = "confirmed",
): void {
  const aliasesJson = aliases ? JSON.stringify(aliases) : null;
  stmtUpsertKnownPlace.run(tenantId, name, aliasesJson, lat, lng, source);
}

export function incrementKnownPlaceUsage(id: number): void {
  stmtIncrementKnownPlaceUsage.run(id);
}

// ---------------------------------------------------------------------------
// Direcciones frecuentes por cliente (customer_addresses)
// ---------------------------------------------------------------------------

export interface CustomerAddress {
  id: number;
  tenant_id: number;
  phone: string;
  address: string;
  reference: string;
  lat: number;
  lng: number;
  last_used_at: number;
}

const stmtGetCustomerAddress = db.prepare<[number, string], CustomerAddress>(
  `SELECT * FROM customer_addresses WHERE tenant_id = ? AND phone = ?`,
);

const stmtUpsertCustomerAddress = db.prepare(
  `INSERT INTO customer_addresses (tenant_id, phone, address, reference, lat, lng, last_used_at)
   VALUES (?, ?, ?, ?, ?, ?, unixepoch())
   ON CONFLICT(tenant_id, phone) DO UPDATE SET address = excluded.address, reference = excluded.reference, lat = excluded.lat, lng = excluded.lng, last_used_at = unixepoch()`,
);

export function getCustomerAddress(
  tenantId: number,
  phone: string,
): CustomerAddress | null {
  return stmtGetCustomerAddress.get(tenantId, phone) || null;
}

export function upsertCustomerAddress(
  tenantId: number,
  phone: string,
  address: string,
  reference: string,
  lat: number,
  lng: number,
): void {
  stmtUpsertCustomerAddress.run(tenantId, phone, address, reference, lat, lng);
}

// LLM usage por día para un tenant (últimos N días)
export interface LLMDailyUsage {
  date: string;
  tokens: number;
  cost_usd: number;
  calls: number;
  avg_duration_ms: number;
}

export function getLLMDailyUsage(tenantId: number, days = 7): LLMDailyUsage[] {
  const since = Math.floor((Date.now() - days * 86400000) / 1000);
  return db
    .prepare<[number, number], LLMDailyUsage>(
      `SELECT
         DATE(created_at, 'unixepoch') as date,
         SUM(total_tokens) as tokens,
         SUM(cost_usd) as cost_usd,
         COUNT(*) as calls,
         AVG(duration_ms) as avg_duration_ms
       FROM llm_usage
       WHERE tenant_id = ? AND created_at >= ? AND success = 1
       GROUP BY DATE(created_at, 'unixepoch')
       ORDER BY date DESC`,
    )
    .all(tenantId, since) as LLMDailyUsage[];
}
