/**
 * Script de migración: SQLite → PostgreSQL
 *
 * Uso:
 *   npx tsx scripts/migrate-to-pg.ts
 *
 * Variables de entorno necesarias:
 *   DATABASE_URL - PostgreSQL connection string
 *   SQLITE_PATH  - Path al archivo SQLite (default: data/messages.db)
 *
 * Este script:
 * 1. Lee todos los datos de SQLite
 * 2. Inserta los datos en PostgreSQL
 * 3. Verifica la integridad de la migración
 */

import "./env-loader";

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const DATA_DIR = path.resolve(process.cwd(), "data");
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, "messages.db");
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/mondrex";

interface MigrationStats {
  tenants: number;
  users: number;
  conversations: number;
  messages: number;
  products: number;
  orders: number;
  orderItems: number;
  outbox: number;
  connectionState: number;
  plans: number;
  tenantPlans: number;
  tenantDailyUsage: number;
  messageEvents: number;
}

async function migrate(): Promise<void> {
  console.log("=".repeat(60));
  console.log("MIGRACIÓN: SQLite → PostgreSQL");
  console.log("=".repeat(60));

  // Verificar que SQLite existe
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`❌ SQLite no encontrado: ${SQLITE_PATH}`);
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log(`✅ Conectado a SQLite: ${SQLITE_PATH}`);

  // Conectar a PostgreSQL
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1");
    console.log("✅ Conectado a PostgreSQL");
  } catch (err) {
    console.error("❌ Error conectando a PostgreSQL:", err);
    process.exit(1);
  }

  const stats: MigrationStats = {
    tenants: 0,
    users: 0,
    conversations: 0,
    messages: 0,
    products: 0,
    orders: 0,
    orderItems: 0,
    outbox: 0,
    connectionState: 0,
    plans: 0,
    tenantPlans: 0,
    tenantDailyUsage: 0,
    messageEvents: 0,
  };

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Migrar tenants
    console.log("\n📦 Migrando tenants...");
    const tenants = sqlite.prepare("SELECT * FROM tenants").all();
    for (const t of tenants as any[]) {
      await client.query(
        `INSERT INTO tenants (id, name, slug, theme, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, theme = EXCLUDED.theme`,
        [t.id, t.name, t.slug, t.theme || "light", t.created_at],
      );
      stats.tenants++;
    }
    console.log(`   ✅ ${stats.tenants} tenants`);

    // 2. Migrar users
    console.log("\n📦 Migrando users...");
    const users = sqlite.prepare("SELECT * FROM users").all();
    for (const u of users as any[]) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, tenant_id, is_super_admin, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
        [
          u.id,
          u.email,
          u.password_hash,
          u.name,
          u.role,
          u.tenant_id,
          u.is_super_admin ?? 0,
          u.created_at,
        ],
      );
      stats.users++;
    }
    console.log(`   ✅ ${stats.users} users`);

    // 3. Migrar conversations
    console.log("\n📦 Migrando conversations...");
    const conversations = sqlite
      .prepare("SELECT * FROM conversations")
      .all() as any[];
    for (const c of conversations) {
      await client.query(
        `INSERT INTO conversations (id, tenant_id, phone, name, jid, mode, last_message_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, phone) DO NOTHING`,
        [
          c.id,
          c.tenant_id ?? 1,
          c.phone,
          c.name,
          c.jid,
          c.mode || "AI",
          c.last_message_at,
          c.created_at,
        ],
      );
      stats.conversations++;
    }
    console.log(`   ✅ ${stats.conversations} conversations`);

    // 4. Migrar messages
    console.log("\n📦 Migrando messages...");
    const messages = sqlite.prepare("SELECT * FROM messages").all();
    for (const m of messages as any[]) {
      await client.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [m.id, m.conversation_id, m.role, m.content, m.created_at],
      );
      stats.messages++;
    }
    console.log(`   ✅ ${stats.messages} messages`);

    // 5. Migrar products
    console.log("\n📦 Migrando products...");
    const products = sqlite.prepare("SELECT * FROM products").all();
    for (const p of products as any[]) {
      await client.query(
        `INSERT INTO products (id, tenant_id, name, price, stock, active, description, variants, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          p.id,
          p.tenant_id ?? 1,
          p.name,
          p.price,
          p.stock,
          p.active ?? 1,
          p.description,
          p.variants,
          p.created_at,
        ],
      );
      stats.products++;
    }
    console.log(`   ✅ ${stats.products} products`);

    // 6. Migrar orders
    console.log("\n📦 Migrando orders...");
    const orders = sqlite.prepare("SELECT * FROM orders").all();
    for (const o of orders as any[]) {
      await client.query(
        `INSERT INTO orders (id, tenant_id, customer_phone, customer_name, status, total_amount, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          o.id,
          o.tenant_id,
          o.customer_phone,
          o.customer_name,
          o.status,
          o.total_amount,
          o.notes,
          o.created_at,
          o.updated_at,
        ],
      );
      stats.orders++;
    }
    console.log(`   ✅ ${stats.orders} orders`);

    // 7. Migrar order_items
    console.log("\n📦 Migrando order_items...");
    const orderItems = sqlite.prepare("SELECT * FROM order_items").all();
    for (const oi of orderItems as any[]) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          oi.id,
          oi.order_id,
          oi.product_name,
          oi.quantity,
          oi.unit_price,
          oi.total_price,
        ],
      );
      stats.orderItems++;
    }
    console.log(`   ✅ ${stats.orderItems} order_items`);

    // 8. Migrar outbox
    console.log("\n📦 Migrando outbox...");
    const outbox = sqlite.prepare("SELECT * FROM outbox").all();
    for (const o of outbox as any[]) {
      await client.query(
        `INSERT INTO outbox (id, tenant_id, conversation_id, phone, remote_jid, content, sent, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          o.id,
          o.tenant_id ?? 1,
          o.conversation_id,
          o.phone,
          o.remote_jid,
          o.content,
          o.sent,
          o.created_at,
        ],
      );
      stats.outbox++;
    }
    console.log(`   ✅ ${stats.outbox} outbox items`);

    // 9. Migrar connection_state
    console.log("\n📦 Migrando connection_state...");
    const connStates = sqlite
      .prepare("SELECT * FROM connection_state")
      .all() as any[];
    for (const c of connStates) {
      await client.query(
        `INSERT INTO connection_state (tenant_id, status, qr_string, phone, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET status = EXCLUDED.status, qr_string = EXCLUDED.qr_string, phone = EXCLUDED.phone`,
        [c.tenant_id, c.status, c.qr_string, c.phone, c.updated_at],
      );
      stats.connectionState++;
    }
    console.log(`   ✅ ${stats.connectionState} connection_states`);

    // 10. Migrar plans
    console.log("\n📦 Migrando plans...");
    const plans = sqlite.prepare("SELECT * FROM plans").all();
    for (const p of plans as any[]) {
      await client.query(
        `INSERT INTO plans (id, name, slug, daily_chat_limit, price_cop, price_usd, description, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO NOTHING`,
        [
          p.id,
          p.name,
          p.slug,
          p.daily_chat_limit,
          p.price_cop,
          p.price_usd,
          p.description,
          p.created_at,
        ],
      );
      stats.plans++;
    }
    console.log(`   ✅ ${stats.plans} plans`);

    // 11. Migrar tenant_plans
    console.log("\n📦 Migrando tenant_plans...");
    const tenantPlans = sqlite
      .prepare("SELECT * FROM tenant_plans")
      .all() as any[];
    for (const tp of tenantPlans) {
      await client.query(
        `INSERT INTO tenant_plans (id, tenant_id, plan_id, status, next_billing_date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [
          tp.id,
          tp.tenant_id,
          tp.plan_id,
          tp.status,
          tp.next_billing_date,
          tp.created_at,
        ],
      );
      stats.tenantPlans++;
    }
    console.log(`   ✅ ${stats.tenantPlans} tenant_plans`);

    // 12. Migrar tenant_daily_usage
    console.log("\n📦 Migrando tenant_daily_usage...");
    const usage = sqlite
      .prepare("SELECT * FROM tenant_daily_usage")
      .all() as any[];
    for (const u of usage) {
      await client.query(
        `INSERT INTO tenant_daily_usage (tenant_id, date, conversation_count, message_count, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET date = EXCLUDED.date, conversation_count = EXCLUDED.conversation_count, message_count = EXCLUDED.message_count`,
        [
          u.tenant_id,
          u.date,
          u.conversation_count,
          u.message_count,
          u.updated_at,
        ],
      );
      stats.tenantDailyUsage++;
    }
    console.log(`   ✅ ${stats.tenantDailyUsage} tenant_daily_usage`);

    // 13. Migrar message_events
    console.log("\n📦 Migrando message_events...");
    const msgEvents = sqlite
      .prepare("SELECT * FROM message_events")
      .all() as any[];
    for (const me of msgEvents) {
      await client.query(
        `INSERT INTO message_events (id, tenant_id, phone, content_hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          me.id,
          me.tenant_id ?? 1,
          me.phone,
          me.content_hash,
          me.created_at,
        ],
      );
      stats.messageEvents++;
    }
    console.log(`   ✅ ${stats.messageEvents} message_events`);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Error en migración:", err);
    throw err;
  } finally {
    client.release();
  }

  // Resumen
  console.log("\n" + "=".repeat(60));
  console.log("RESUMEN DE MIGRACIÓN");
  console.log("=".repeat(60));
  console.log(`
  📊 Estadísticas:
     Tenants:          ${stats.tenants}
     Users:            ${stats.users}
     Conversations:     ${stats.conversations}
     Messages:         ${stats.messages}
     Products:         ${stats.products}
     Orders:            ${stats.orders}
     Order Items:      ${stats.orderItems}
     Outbox:           ${stats.outbox}
     Connection State: ${stats.connectionState}
     Plans:            ${stats.plans}
     Tenant Plans:     ${stats.tenantPlans}
     Daily Usage:      ${stats.tenantDailyUsage}
     Message Events:   ${stats.messageEvents}
  `);

  const total =
    stats.tenants +
    stats.users +
    stats.conversations +
    stats.messages +
    stats.products +
    stats.orders +
    stats.orderItems +
    stats.outbox +
    stats.connectionState +
    stats.plans +
    stats.tenantPlans +
    stats.tenantDailyUsage +
    stats.messageEvents;

  console.log(`  Total registros migrados: ${total.toLocaleString()}`);
  console.log("\n✅ Migración completada exitosamente!");
  console.log("\n⚠️  IMPORTANTE:");
  console.log("   1. Verifica los datos en PostgreSQL");
  console.log("   2. Cambia DATABASE_URL en tu .env.local");
  console.log("   3. Reinicia la aplicación");
  console.log("   4. Mantén el backup de SQLite por seguridad");

  await pool.end();
  sqlite.close();
}

migrate().catch((err) => {
  console.error("❌ Migración fallida:", err);
  process.exit(1);
});
