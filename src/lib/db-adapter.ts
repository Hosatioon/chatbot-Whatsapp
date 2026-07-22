/**
 * Interfaz común para adaptadores de base de datos.
 * Permite swapping entre SQLite (desarrollo local) y PostgreSQL (producción).
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
  CreateOrderItemInput,
} from "./db";

export interface DBAdapter {
  // ============ Conversations ============
  getOrCreateConversation(
    tenantId: number,
    phone: string,
    name?: string | null,
    jid?: string | null,
  ): Conversation;
  getConversationById(id: number, tenantId?: number): Conversation | null;
  listConversations(tenantId: number): ConversationListItem[];
  setMode(tenantId: number, conversationId: number, mode: Mode): void;
  deleteConversation(tenantId: number, conversationId: number): void;

  // ============ Messages ============
  insertMessage(conversationId: number, role: Role, content: string): number;
  getMessages(
    tenantId: number,
    conversationId: number,
    limit?: number,
  ): Message[];
  getRecentHistory(conversationId: number, limit?: number): Message[];

  // ============ Connection State ============
  getConnectionState(tenantId: number): ConnectionState;
  listConnectionStates(): ConnectionState[];
  setConnectionState(tenantId: number, input: SetConnectionStateInput): void;

  // ============ Outbox ============
  enqueueOutbox(
    tenantId: number,
    conversationId: number,
    phone: string,
    content: string,
    remoteJid?: string | null,
  ): number;
  getPendingOutbox(tenantId: number, limit?: number): OutboxItem[];
  markOutboxSent(id: number): void;

  // ============ Products ============
  listProducts(tenantId: number): Product[];
  getActiveProducts(tenantId: number): Product[];
  getProductById(id: number, tenantId?: number): Product | null;
  createProduct(
    tenantId: number,
    name: string,
    price: number,
    stock: number,
    description?: string | null,
    variants?: ProductVariant[] | null,
  ): Product;
  updateProduct(
    tenantId: number,
    id: number,
    name: string,
    price: number,
    stock: number,
    description?: string | null,
    variants?: ProductVariant[] | null,
  ): void;
  deleteProduct(tenantId: number, id: number): void;
  toggleProductActive(tenantId: number, id: number, active: boolean): void;
  listAllProducts(): (Product & { tenant_name: string })[];

  // ============ Tenants ============
  listTenants(): Tenant[];
  getTenantById(id: number): Tenant | null;
  getTenantBySlug(slug: string): Tenant | null;
  createTenant(name: string, slug: string): Tenant;
  setTenantTheme(tenantId: number, theme: TenantTheme): void;
  getTenantTheme(tenantId: number): TenantTheme;

  // ============ Users ============
  getUserByEmail(email: string): User | null;
  getUserById(id: number): User | null;
  createUser(
    email: string,
    passwordHash: string,
    name: string,
    role?: UserRole,
    tenantId?: number,
  ): User;
  hasAnyUser(): boolean;
  getUsersByTenant(tenantId: number): User[];
  setSuperAdmin(userId: number, value: boolean): void;

  // ============ Rate Limiting ============
  recordMessageEvent(
    tenantId: number,
    phone: string,
    contentHash: string,
  ): void;
  countMessagesInWindow(
    tenantId: number,
    phone: string,
    windowSeconds: number,
  ): number;
  countDuplicateContentInWindow(
    tenantId: number,
    phone: string,
    contentHash: string,
    windowSeconds: number,
  ): number;
  purgeOldMessageEvents(olderThanSeconds?: number): void;

  // ============ Plans & Usage ============
  listPlans(): Plan[];
  getPlanBySlug(slug: string): Plan | null;
  createPlan(
    name: string,
    slug: string,
    dailyChatLimit: number,
    priceCop: number,
    priceUsd: number,
    description: string | null,
  ): Plan;
  getTenantPlan(tenantId: number):
    | (TenantPlan & {
        plan_slug: string;
        plan_name: string;
        daily_chat_limit: number;
      })
    | null;
  setTenantPlan(
    tenantId: number,
    planId: number,
    status: "active" | "suspended" | "cancelled" | "trial",
    nextBillingDate: number | null,
    trialEndDate?: number | null,
  ): void;
  getDailyUsage(tenantId: number, date: string): TenantDailyUsage | null;
  incrementDailyUsage(
    tenantId: number,
    date: string,
    newConversation?: boolean,
    messages?: number,
  ): void;
  resetDailyUsage(tenantId: number, date: string): void;
  hasExceededDailyLimit(tenantId: number): boolean;

  // ============ Orders ============
  createOrder(input: CreateOrderInput): Order & { items: OrderItem[] };
  getOrdersByTenant(
    tenantId: number,
    limit?: number,
  ): (Order & { item_count: number })[];
  getOrderById(
    tenantId: number,
    orderId: number,
  ): (Order & { items: OrderItem[] }) | null;
  updateOrderStatus(
    tenantId: number,
    orderId: number,
    status: OrderStatus,
  ): boolean;
  getOrdersByStatus(
    tenantId: number,
    status: OrderStatus,
    limit?: number,
  ): (Order & { item_count: number })[];

  // ============ Admin (unscoped) ============
  listAllConversations(): (ConversationListItem & { tenant_name: string })[];

  // ============ Utility ============
  close(): void;
  transaction<T>(fn: () => T): T;
}

export type { CreateOrderInput, CreateOrderItemInput };
