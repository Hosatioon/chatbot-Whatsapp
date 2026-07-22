/**
 * Interfaz común para adaptadores de base de datos.
 * Permite swapping entre SQLite (desarrollo local) y PostgreSQL (producción).
 *
 * Todos los métodos son async porque PostgreSQL es inherentemente async.
 * El adaptador SQLite puede envolver sus resultados en Promise.resolve()
 * para satisfacer la interfaz.
 */
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
  CreateOrderItemInput,
  LLMUsageRecord,
  LLMBudgetStatus,
} from "./db";

export interface DBAdapter {
  // ============ Conversations ============
  getOrCreateConversation(
    tenantId: number,
    phone: string,
    name?: string | null,
    jid?: string | null,
  ): Promise<Conversation>;
  getConversationById(
    id: number,
    tenantId?: number,
  ): Promise<Conversation | null>;
  listConversations(tenantId: number): Promise<ConversationListItem[]>;
  setMode(
    tenantId: number,
    conversationId: number,
    mode: Mode,
  ): Promise<void>;
  deleteConversation(
    tenantId: number,
    conversationId: number,
  ): Promise<void>;

  // ============ Messages ============
  insertMessage(
    conversationId: number,
    role: Role,
    content: string,
  ): Promise<number>;
  getMessages(
    tenantId: number,
    conversationId: number,
    limit?: number,
  ): Promise<Message[]>;
  getRecentHistory(
    conversationId: number,
    limit?: number,
  ): Promise<Message[]>;

  // ============ Connection State ============
  getConnectionState(tenantId: number): Promise<ConnectionState>;
  listConnectionStates(): Promise<ConnectionState[]>;
  setConnectionState(
    tenantId: number,
    input: SetConnectionStateInput,
  ): Promise<void>;

  // ============ Outbox ============
  enqueueOutbox(
    tenantId: number,
    conversationId: number,
    phone: string,
    content: string,
    remoteJid?: string | null,
  ): Promise<number>;
  getPendingOutbox(tenantId: number, limit?: number): Promise<OutboxItem[]>;
  markOutboxSent(id: number): Promise<void>;

  // ============ Products ============
  listProducts(tenantId: number): Promise<Product[]>;
  getActiveProducts(tenantId: number): Promise<Product[]>;
  getProductById(id: number, tenantId?: number): Promise<Product | null>;
  createProduct(
    tenantId: number,
    name: string,
    price: number,
    stock: number,
    description?: string | null,
    variants?: ProductVariant[] | null,
  ): Promise<Product>;
  updateProduct(
    tenantId: number,
    id: number,
    name: string,
    price: number,
    stock: number,
    description?: string | null,
    variants?: ProductVariant[] | null,
  ): Promise<void>;
  deleteProduct(tenantId: number, id: number): Promise<void>;
  toggleProductActive(
    tenantId: number,
    id: number,
    active: boolean,
  ): Promise<void>;
  listAllProducts(): Promise<(Product & { tenant_name: string })[]>;

  // ============ Tenants ============
  listTenants(): Promise<Tenant[]>;
  getTenantById(id: number): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  createTenant(name: string, slug: string): Promise<Tenant>;
  setTenantTheme(tenantId: number, theme: TenantTheme): Promise<void>;
  getTenantTheme(tenantId: number): Promise<TenantTheme>;

  // ============ Users ============
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: number): Promise<User | null>;
  createUser(
    email: string,
    passwordHash: string,
    name: string,
    role?: UserRole,
    tenantId?: number,
  ): Promise<User>;
  hasAnyUser(): Promise<boolean>;
  getUsersByTenant(tenantId: number): Promise<User[]>;
  setSuperAdmin(userId: number, value: boolean): Promise<void>;

  // ============ Rate Limiting ============
  recordMessageEvent(
    tenantId: number,
    phone: string,
    contentHash: string,
  ): Promise<void>;
  countMessagesInWindow(
    tenantId: number,
    phone: string,
    windowSeconds: number,
  ): Promise<number>;
  countDuplicateContentInWindow(
    tenantId: number,
    phone: string,
    contentHash: string,
    windowSeconds: number,
  ): Promise<number>;
  purgeOldMessageEvents(olderThanSeconds?: number): Promise<void>;

  // ============ Plans & Usage ============
  listPlans(): Promise<Plan[]>;
  getPlanBySlug(slug: string): Promise<Plan | null>;
  createPlan(
    name: string,
    slug: string,
    dailyChatLimit: number,
    priceCop: number,
    priceUsd: number,
    description: string | null,
  ): Promise<Plan>;
  getTenantPlan(
    tenantId: number,
  ): Promise<
    | (TenantPlan & {
        plan_slug: string;
        plan_name: string;
        daily_chat_limit: number;
      })
    | null
  >;
  setTenantPlan(
    tenantId: number,
    planId: number,
    status: "active" | "suspended" | "cancelled" | "trial",
    nextBillingDate: number | null,
    trialEndDate?: number | null,
  ): Promise<void>;
  getDailyUsage(
    tenantId: number,
    date: string,
  ): Promise<TenantDailyUsage | null>;
  incrementDailyUsage(
    tenantId: number,
    date: string,
    newConversation?: boolean,
    messages?: number,
  ): Promise<void>;
  resetDailyUsage(tenantId: number, date: string): Promise<void>;
  hasExceededDailyLimit(tenantId: number): Promise<boolean>;

  // ============ LLM Usage ============
  recordLLMUsage(rec: LLMUsageRecord): Promise<void>;
  getLLMBudgetStatus(tenantId: number): Promise<LLMBudgetStatus>;

  // ============ Orders ============
  createOrder(
    input: CreateOrderInput,
  ): Promise<Order & { items: OrderItem[] }>;
  getOrdersByTenant(
    tenantId: number,
    limit?: number,
  ): Promise<(Order & { item_count: number })[]>;
  getOrderById(
    tenantId: number,
    orderId: number,
  ): Promise<(Order & { items: OrderItem[] }) | null>;
  updateOrderStatus(
    tenantId: number,
    orderId: number,
    status: OrderStatus,
  ): Promise<boolean>;
  getOrdersByStatus(
    tenantId: number,
    status: OrderStatus,
    limit?: number,
  ): Promise<(Order & { item_count: number })[]>;

  // ============ Admin (unscoped) ============
  listAllConversations(): Promise<
    (ConversationListItem & { tenant_name: string })[]
  >;

  // ============ Utility ============
  close(): void;
  transaction<T>(fn: () => T): T;
  transactionAsync<T>(fn: () => Promise<T>): Promise<T>;
}

export type { CreateOrderInput, CreateOrderItemInput };
