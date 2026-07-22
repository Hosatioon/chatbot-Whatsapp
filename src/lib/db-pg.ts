/**
 * PostgreSQL adapter para producción.
 * Reemplaza better-sqlite3 por pg con connection pooling.
 */
import pg from "pg";
import type {
  User,
  UserRole,
  Tenant,
  TenantTheme,
  Conversation,
  ConversationListItem,
  Message,
  Role,
  ConnectionState,
  ConnectionStatus,
  OutboxItem,
  Product,
  ProductVariant,
  Order,
  OrderItem,
  OrderStatus,
  CreateOrderInput,
  Plan,
  TenantPlan,
  TenantDailyUsage,
  Mode,
  SetConnectionStateInput,
} from "./db";
import type { DBAdapter } from "./db-adapter";

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/mondrex";

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected error on idle client:", err);
});

export async function initPostgreSQL(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        phone TEXT NOT NULL,
        name TEXT,
        jid TEXT,
        mode TEXT CHECK(mode IN ('AI','HUMAN')) NOT NULL DEFAULT 'AI',
        last_message_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        theme TEXT NOT NULL DEFAULT 'light',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
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
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        phone TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_msg_events_phone_time
        ON message_events(tenant_id, phone, created_at DESC);

      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        daily_chat_limit INTEGER NOT NULL DEFAULT 0,
        price_cop INTEGER NOT NULL DEFAULT 0,
        price_usd REAL NOT NULL DEFAULT 0,
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS tenant_plans (
        id SERIAL PRIMARY KEY,
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

      -- Unique constraints multi-tenant
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_phone
        ON conversations(tenant_id, phone);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_name
        ON products(tenant_id, name);

      -- Seed default tenant
      INSERT INTO tenants (id, name, slug)
      VALUES (1, 'Default', 'default')
      ON CONFLICT DO NOTHING;

      -- Seed plans
      INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description)
      VALUES ('Gratis', 'free', 10, 0, 0, '10 chats/día para probar')
      ON CONFLICT DO NOTHING;
      INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description)
      VALUES ('Prueba', 'trial', 50, 80000, 20.0, 'Prueba 15 días - 50 chats/día')
      ON CONFLICT DO NOTHING;
      INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description)
      VALUES ('Starter', 'starter', 30, 49000, 12.25, '30 chats/día')
      ON CONFLICT DO NOTHING;
      INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description)
      VALUES ('Pro', 'pro', 50, 75000, 18.75, '50 chats/día')
      ON CONFLICT DO NOTHING;
      INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description)
      VALUES ('Business', 'business', 999999, 120000, 30.0, 'Ilimitado')
      ON CONFLICT DO NOTHING;

      ALTER TABLE tenant_plans ADD COLUMN IF NOT EXISTS trial_end_date INTEGER;
    `);
    console.log("[pg] Schema inicializado");
  } finally {
    client.release();
  }
}

class PostgreSQLAdapter implements DBAdapter {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  private async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  private async queryOne<T = any>(
    sql: string,
    params?: any[],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  transaction<T>(fn: () => T): T {
    throw new Error("Transaction must be async for PostgreSQL adapter");
  }

  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  close(): void {
    this.pool.end();
  }

  // ============ Conversations ============
  async getOrCreateConversation(
    tenantId: number,
    phone: string,
    name?: string | null,
    jid?: string | null,
  ): Promise<Conversation> {
    const existing = await this.queryOne<Conversation>(
      "SELECT * FROM conversations WHERE tenant_id = $1 AND phone = $2",
      [tenantId, phone],
    );
    if (existing) {
      if (name && name !== existing.name) {
        await this.query("UPDATE conversations SET name = $1 WHERE id = $2", [
          name,
          existing.id,
        ]);
        existing.name = name;
      }
      if (jid && jid !== existing.jid) {
        await this.query("UPDATE conversations SET jid = $1 WHERE id = $2", [
          jid,
          existing.id,
        ]);
        existing.jid = jid;
      }
      return existing;
    }
    const result = await this.query(
      "INSERT INTO conversations (tenant_id, phone, name, jid) VALUES ($1, $2, $3, $4) RETURNING *",
      [tenantId, phone, name ?? null, jid ?? null],
    );
    return result[0] as Conversation;
  }

  async getConversationById(
    id: number,
    tenantId?: number,
  ): Promise<Conversation | null> {
    if (tenantId !== undefined) {
      return this.queryOne<Conversation>(
        "SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2",
        [id, tenantId],
      );
    }
    return this.queryOne<Conversation>(
      "SELECT * FROM conversations WHERE id = $1",
      [id],
    );
  }

  async listConversations(tenantId: number): Promise<ConversationListItem[]> {
    return this.query<ConversationListItem>(
      `SELECT c.*,
        (SELECT content FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1) AS last_message_preview
       FROM conversations c
       WHERE c.tenant_id = $1
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
      [tenantId],
    );
  }

  async setMode(
    tenantId: number,
    conversationId: number,
    mode: Mode,
  ): Promise<void> {
    await this.query(
      "UPDATE conversations SET mode = $1 WHERE id = $2 AND tenant_id = $3",
      [mode, conversationId, tenantId],
    );
  }

  async deleteConversation(
    tenantId: number,
    conversationId: number,
  ): Promise<void> {
    await this.query(
      "DELETE FROM messages WHERE conversation_id = $1 AND conversation_id IN (SELECT id FROM conversations WHERE tenant_id = $2)",
      [conversationId, tenantId],
    );
    await this.query(
      "DELETE FROM outbox WHERE conversation_id = $1 AND tenant_id = $2",
      [conversationId, tenantId],
    );
    await this.query(
      "DELETE FROM conversations WHERE id = $1 AND tenant_id = $2",
      [conversationId, tenantId],
    );
  }

  // ============ Messages ============
  async insertMessage(
    conversationId: number,
    role: Role,
    content: string,
  ): Promise<number> {
    const result = await this.query<{ id: number }>(
      "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id",
      [conversationId, role, content],
    );
    await this.query(
      "UPDATE conversations SET last_message_at = unixepoch() WHERE id = $1",
      [conversationId],
    );
    return result[0].id;
  }

  async getMessages(
    tenantId: number,
    conversationId: number,
    limit = 50,
  ): Promise<Message[]> {
    return this.query<Message>(
      `SELECT m.* FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.conversation_id = $1 AND c.tenant_id = $2
       ORDER BY m.created_at ASC, m.id ASC LIMIT $3`,
      [conversationId, tenantId, limit],
    );
  }

  async getRecentHistory(
    conversationId: number,
    limit = 20,
  ): Promise<Message[]> {
    const rows = await this.query<Message>(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
      [conversationId, limit],
    );
    return rows.reverse();
  }

  // ============ Connection State ============
  async getConnectionState(tenantId: number): Promise<ConnectionState> {
    const row = await this.queryOne<ConnectionState>(
      "SELECT * FROM connection_state WHERE tenant_id = $1",
      [tenantId],
    );
    if (!row) {
      await this.query(
        "INSERT INTO connection_state (tenant_id, status) VALUES ($1, 'disconnected') ON CONFLICT DO NOTHING",
        [tenantId],
      );
      return this.queryOne<ConnectionState>(
        "SELECT * FROM connection_state WHERE tenant_id = $1",
        [tenantId],
      ) as Promise<ConnectionState>;
    }
    return row;
  }

  async listConnectionStates(): Promise<ConnectionState[]> {
    return this.query<ConnectionState>("SELECT * FROM connection_state");
  }

  async setConnectionState(
    tenantId: number,
    input: SetConnectionStateInput,
  ): Promise<void> {
    const current = await this.getConnectionState(tenantId);
    const next: ConnectionState = {
      ...current,
      status: input.status ?? current.status,
      qr_string:
        input.qr_string === undefined ? current.qr_string : input.qr_string,
      phone: input.phone === undefined ? current.phone : input.phone,
      updated_at: Math.floor(Date.now() / 1000),
    };
    await this.query(
      `INSERT INTO connection_state (tenant_id, status, qr_string, phone, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(tenant_id) DO UPDATE SET
         status = excluded.status,
         qr_string = excluded.qr_string,
         phone = excluded.phone,
         updated_at = excluded.updated_at`,
      [tenantId, next.status, next.qr_string, next.phone, next.updated_at],
    );
  }

  // ============ Outbox ============
  async enqueueOutbox(
    tenantId: number,
    conversationId: number,
    phone: string,
    content: string,
    remoteJid?: string | null,
  ): Promise<number> {
    const result = await this.query<{ id: number }>(
      "INSERT INTO outbox (tenant_id, conversation_id, phone, remote_jid, content) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [tenantId, conversationId, phone, remoteJid ?? null, content],
    );
    return result[0].id;
  }

  async getPendingOutbox(tenantId: number, limit = 20): Promise<OutboxItem[]> {
    return this.query<OutboxItem>(
      "SELECT * FROM outbox WHERE tenant_id = $1 AND sent = 0 ORDER BY created_at ASC, id ASC LIMIT $2",
      [tenantId, limit],
    );
  }

  async markOutboxSent(id: number): Promise<void> {
    await this.query("UPDATE outbox SET sent = 1 WHERE id = $1", [id]);
  }

  // ============ Products ============
  async listProducts(tenantId: number): Promise<Product[]> {
    return this.query<Product>(
      "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE tenant_id = $1 ORDER BY active DESC, name ASC",
      [tenantId],
    );
  }

  async getActiveProducts(tenantId: number): Promise<Product[]> {
    return this.query<Product>(
      "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE tenant_id = $1 AND active = 1 ORDER BY name ASC",
      [tenantId],
    );
  }

  async getProductById(id: number, tenantId?: number): Promise<Product | null> {
    if (tenantId !== undefined) {
      return this.queryOne<Product>(
        "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE id = $1 AND tenant_id = $2",
        [id, tenantId],
      );
    }
    return this.queryOne<Product>(
      "SELECT id, tenant_id, name, price, stock, active, description, created_at, variants FROM products WHERE id = $1",
      [id],
    );
  }

  async createProduct(
    tenantId: number,
    name: string,
    price: number,
    stock: number,
    description?: string | null,
    variants?: ProductVariant[] | null,
  ): Promise<Product> {
    const active = stock > 0 ? 1 : 0;
    const variantsJson =
      variants && variants.length > 0 ? JSON.stringify(variants) : null;
    const result = await this.query<{ id: number }>(
      "INSERT INTO products (tenant_id, name, price, stock, active, description, variants) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [tenantId, name, price, stock, active, description ?? null, variantsJson],
    );
    return this.getProductById(result[0].id, tenantId) as Promise<Product>;
  }

  async updateProduct(
    tenantId: number,
    id: number,
    name: string,
    price: number,
    stock: number,
    description?: string | null,
    variants?: ProductVariant[] | null,
  ): Promise<void> {
    const active = stock > 0 ? 1 : 0;
    const variantsJson =
      variants && variants.length > 0 ? JSON.stringify(variants) : null;
    await this.query(
      "UPDATE products SET name = $1, price = $2, stock = $3, active = $4, description = $5, variants = $6 WHERE id = $7 AND tenant_id = $8",
      [
        name,
        price,
        stock,
        active,
        description ?? null,
        variantsJson,
        id,
        tenantId,
      ],
    );
  }

  async deleteProduct(tenantId: number, id: number): Promise<void> {
    await this.query("DELETE FROM products WHERE id = $1 AND tenant_id = $2", [
      id,
      tenantId,
    ]);
  }

  async toggleProductActive(
    tenantId: number,
    id: number,
    active: boolean,
  ): Promise<void> {
    if (active) {
      const product = await this.getProductById(id, tenantId);
      if (product && product.stock === 0) return;
    }
    await this.query(
      "UPDATE products SET active = $1 WHERE id = $2 AND tenant_id = $3",
      [active ? 1 : 0, id, tenantId],
    );
  }

  async listAllProducts(): Promise<(Product & { tenant_name: string })[]> {
    return this.query<Product & { tenant_name: string }>(
      `SELECT p.*, t.name as tenant_name
       FROM products p
       JOIN tenants t ON p.tenant_id = t.id
       ORDER BY t.name ASC, p.active DESC, p.name ASC`,
    );
  }

  // ============ Tenants ============
  async listTenants(): Promise<Tenant[]> {
    return this.query<Tenant>("SELECT * FROM tenants ORDER BY id ASC");
  }

  async getTenantById(id: number): Promise<Tenant | null> {
    return this.queryOne<Tenant>("SELECT * FROM tenants WHERE id = $1", [id]);
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    return this.queryOne<Tenant>("SELECT * FROM tenants WHERE slug = $1", [
      slug,
    ]);
  }

  async createTenant(name: string, slug: string): Promise<Tenant> {
    const result = await this.query<{ id: number }>(
      "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
      [name, slug],
    );
    return this.getTenantById(result[0].id) as Promise<Tenant>;
  }

  async setTenantTheme(tenantId: number, theme: TenantTheme): Promise<void> {
    await this.query("UPDATE tenants SET theme = $1 WHERE id = $2", [
      theme,
      tenantId,
    ]);
  }

  async getTenantTheme(tenantId: number): Promise<TenantTheme> {
    const t = await this.getTenantById(tenantId);
    return t?.theme ?? "light";
  }

  // ============ Users ============
  async getUserByEmail(email: string): Promise<User | null> {
    return this.queryOne<User>("SELECT * FROM users WHERE email = $1", [email]);
  }

  async getUserById(id: number): Promise<User | null> {
    return this.queryOne<User>("SELECT * FROM users WHERE id = $1", [id]);
  }

  async createUser(
    email: string,
    passwordHash: string,
    name: string,
    role: UserRole = "OPERATOR",
    tenantId: number = 1,
  ): Promise<User> {
    const result = await this.query<{ id: number }>(
      "INSERT INTO users (email, password_hash, name, role, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [email, passwordHash, name, role, tenantId],
    );
    return this.getUserById(result[0].id) as Promise<User>;
  }

  async hasAnyUser(): Promise<boolean> {
    const result = await this.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM users",
    );
    return (result?.count ?? 0) > 0;
  }

  async getUsersByTenant(tenantId: number): Promise<User[]> {
    return this.query<User>(
      "SELECT * FROM users WHERE tenant_id = $1 ORDER BY name ASC",
      [tenantId],
    );
  }

  async setSuperAdmin(userId: number, value: boolean): Promise<void> {
    await this.query("UPDATE users SET is_super_admin = $1 WHERE id = $2", [
      value ? 1 : 0,
      userId,
    ]);
  }

  // ============ Rate Limiting ============
  async recordMessageEvent(
    tenantId: number,
    phone: string,
    contentHash: string,
  ): Promise<void> {
    await this.query(
      "INSERT INTO message_events (tenant_id, phone, content_hash) VALUES ($1, $2, $3)",
      [tenantId, phone, contentHash],
    );
  }

  async countMessagesInWindow(
    tenantId: number,
    phone: string,
    windowSeconds: number,
  ): Promise<number> {
    const since = Math.floor(Date.now() / 1000) - windowSeconds;
    const result = await this.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM message_events WHERE tenant_id = $1 AND phone = $2 AND created_at >= $3",
      [tenantId, phone, since],
    );
    return result?.count ?? 0;
  }

  async countDuplicateContentInWindow(
    tenantId: number,
    phone: string,
    contentHash: string,
    windowSeconds: number,
  ): Promise<number> {
    const since = Math.floor(Date.now() / 1000) - windowSeconds;
    const result = await this.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM message_events WHERE tenant_id = $1 AND phone = $2 AND content_hash = $3 AND created_at >= $4",
      [tenantId, phone, contentHash, since],
    );
    return result?.count ?? 0;
  }

  async purgeOldMessageEvents(olderThanSeconds = 7200): Promise<void> {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
    await this.query("DELETE FROM message_events WHERE created_at < $1", [
      cutoff,
    ]);
  }

  // ============ Plans & Usage ============
  async listPlans(): Promise<Plan[]> {
    return this.query<Plan>("SELECT * FROM plans ORDER BY id ASC");
  }

  async getPlanBySlug(slug: string): Promise<Plan | null> {
    return this.queryOne<Plan>("SELECT * FROM plans WHERE slug = $1", [slug]);
  }

  async createPlan(
    name: string,
    slug: string,
    dailyChatLimit: number,
    priceCop: number,
    priceUsd: number,
    description: string | null,
  ): Promise<Plan> {
    const result = await this.query<{ id: number }>(
      "INSERT INTO plans (name, slug, daily_chat_limit, price_cop, price_usd, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [name, slug, dailyChatLimit, priceCop, priceUsd, description],
    );
    return this.getPlanBySlug(slug) as Promise<Plan>;
  }

  async getTenantPlan(tenantId: number): Promise<
    | (TenantPlan & {
        plan_slug: string;
        plan_name: string;
        daily_chat_limit: number;
      })
    | null
  > {
    return this.queryOne<
      TenantPlan & {
        plan_slug: string;
        plan_name: string;
        daily_chat_limit: number;
      }
    >(
      `SELECT tp.*, p.slug as plan_slug, p.name as plan_name, p.daily_chat_limit
       FROM tenant_plans tp
       JOIN plans p ON tp.plan_id = p.id
       WHERE tp.tenant_id = $1`,
      [tenantId],
    );
  }

  async setTenantPlan(
    tenantId: number,
    planId: number,
    status: "active" | "suspended" | "cancelled" | "trial",
    nextBillingDate: number | null,
    trialEndDate: number | null = null,
  ): Promise<void> {
    await this.query(
      `INSERT INTO tenant_plans (tenant_id, plan_id, status, next_billing_date, trial_end_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(tenant_id) DO UPDATE SET
         plan_id = excluded.plan_id,
         status = excluded.status,
         next_billing_date = excluded.next_billing_date,
         trial_end_date = excluded.trial_end_date`,
      [tenantId, planId, status, nextBillingDate, trialEndDate],
    );
  }

  async getDailyUsage(
    tenantId: number,
    date: string,
  ): Promise<TenantDailyUsage | null> {
    return this.queryOne<TenantDailyUsage>(
      "SELECT * FROM tenant_daily_usage WHERE tenant_id = $1 AND date = $2",
      [tenantId, date],
    );
  }

  async incrementDailyUsage(
    tenantId: number,
    date: string,
    newConversation = false,
    messages = 1,
  ): Promise<void> {
    await this.query(
      `INSERT INTO tenant_daily_usage (tenant_id, date, conversation_count, message_count, updated_at)
       VALUES ($1, $2, $3, $4, unixepoch())
       ON CONFLICT(tenant_id) DO UPDATE SET
         date = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.date ELSE excluded.date END,
         conversation_count = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.conversation_count + excluded.conversation_count ELSE excluded.conversation_count END,
         message_count = CASE WHEN tenant_daily_usage.date = excluded.date THEN tenant_daily_usage.message_count + excluded.message_count ELSE message_count END,
         updated_at = unixepoch()`,
      [tenantId, date, newConversation ? 1 : 0, messages],
    );
  }

  async resetDailyUsage(tenantId: number, date: string): Promise<void> {
    await this.query(
      `INSERT INTO tenant_daily_usage (tenant_id, date, conversation_count, message_count, updated_at)
       VALUES ($1, $2, 0, 0, unixepoch())
       ON CONFLICT(tenant_id) DO UPDATE SET
         date = excluded.date,
         conversation_count = 0,
         message_count = 0,
         updated_at = unixepoch()`,
      [tenantId, date],
    );
  }

  async isTrialExpired(
    tp: TenantPlan & {
      plan_slug?: string;
      plan_name?: string;
      daily_chat_limit?: number;
    },
  ): Promise<boolean> {
    if (!tp.trial_end_date) return false;
    const now = Math.floor(Date.now() / 1000);
    return now > tp.trial_end_date;
  }

  async hasExceededDailyLimit(tenantId: number): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const tp = await this.getTenantPlan(tenantId);
    if (!tp) return false;
    if (tp.daily_chat_limit <= 0) return false;
    if (await this.isTrialExpired(tp)) return true;
    const usage = await this.getDailyUsage(tenantId, today);
    if (!usage) return false;
    return usage.conversation_count >= tp.daily_chat_limit;
  }

  // ============ Orders ============
  async createOrder(
    input: CreateOrderInput,
  ): Promise<Order & { items: OrderItem[] }> {
    return this.transactionAsync(async () => {
      const orderResult = await this.query<{ id: number }>(
        `INSERT INTO orders (tenant_id, customer_phone, customer_name, status, total_amount, notes, created_at, updated_at)
         VALUES ($1, $2, $3, 'PENDING', 0, $4, unixepoch(), unixepoch()) RETURNING id`,
        [
          input.tenant_id,
          input.customer_phone,
          input.customer_name || null,
          input.notes || null,
        ],
      );
      const orderId = orderResult[0].id;
      let totalAmount = 0;
      const items: OrderItem[] = [];
      for (const item of input.items) {
        const totalPrice = item.quantity * item.unit_price;
        totalAmount += totalPrice;
        const itemResult = await this.query<{ id: number }>(
          "INSERT INTO order_items (order_id, product_name, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [
            orderId,
            item.product_name,
            item.quantity,
            item.unit_price,
            totalPrice,
          ],
        );
        items.push({
          id: itemResult[0].id,
          order_id: orderId,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: totalPrice,
        });
      }
      await this.query(
        "UPDATE orders SET total_amount = $1, updated_at = unixepoch() WHERE id = $2",
        [totalAmount, orderId],
      );
      const order = await this.queryOne<Order>(
        "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2",
        [orderId, input.tenant_id],
      );
      if (!order) throw new Error("No se pudo crear el pedido");
      return { ...order, items };
    });
  }

  async getOrdersByTenant(
    tenantId: number,
    limit = 50,
  ): Promise<(Order & { item_count: number })[]> {
    return this.query<Order & { item_count: number }>(
      `SELECT o.*, COUNT(oi.id) as item_count
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.tenant_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );
  }

  async getOrderById(
    tenantId: number,
    orderId: number,
  ): Promise<(Order & { items: OrderItem[] }) | null> {
    const order = await this.queryOne<Order>(
      "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2",
      [orderId, tenantId],
    );
    if (!order) return null;
    const items = await this.query<OrderItem>(
      "SELECT * FROM order_items WHERE order_id = $1 ORDER BY id",
      [orderId],
    );
    return { ...order, items };
  }

  async updateOrderStatus(
    tenantId: number,
    orderId: number,
    status: OrderStatus,
  ): Promise<boolean> {
    const result = await this.query(
      "UPDATE orders SET status = $1, updated_at = unixepoch() WHERE id = $2 AND tenant_id = $3",
      [status, orderId, tenantId],
    );
    return (result as any)?.rowCount > 0;
  }

  async getOrdersByStatus(
    tenantId: number,
    status: OrderStatus,
    limit = 50,
  ): Promise<(Order & { item_count: number })[]> {
    return this.query<Order & { item_count: number }>(
      `SELECT o.*, COUNT(oi.id) as item_count
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.tenant_id = $1 AND o.status = $2
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT $3`,
      [tenantId, status, limit],
    );
  }

  // ============ Admin (unscoped) ============
  async listAllConversations(): Promise<
    (ConversationListItem & { tenant_name: string })[]
  > {
    return this.query<ConversationListItem & { tenant_name: string }>(
      `SELECT c.*,
        (SELECT content FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1) AS last_message_preview,
        t.name as tenant_name
       FROM conversations c
       JOIN tenants t ON c.tenant_id = t.id
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    );
  }
}

let pgAdapter: PostgreSQLAdapter | null = null;

export async function getPgAdapter(): Promise<PostgreSQLAdapter> {
  if (!pgAdapter) {
    await initPostgreSQL();
    pgAdapter = new PostgreSQLAdapter(pool);
  }
  return pgAdapter;
}

export { pool, PostgreSQLAdapter };
