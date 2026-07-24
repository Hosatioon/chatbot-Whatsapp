import { auth } from "@/auth";

export { getBotTenantId } from "./bot-tenant";

export type AuthContext = {
  tenantId: number;
  userId: number;
  email: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
  isSuperAdmin: boolean;
};

/**
 * Tenant ID asociado a la sesión actual (lado API/dashboard).
 * Lanza si no hay sesión válida.
 */
export async function requireTenantId(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return {
    tenantId: session.user.tenantId,
    userId: Number(session.user.id),
    email: session.user.email.toLowerCase(),
    role: session.user.role,
    isSuperAdmin: session.user.isSuperAdmin ?? false,
  };
}

/**
 * Solo el propietario puede consultar costos, tokens y configuración interna de IA.
 */
export async function requireOwnerAdmin(): Promise<AuthContext> {
  const ctx = await requireTenantId();
  const ownerEmail = (process.env.SUPER_ADMIN_EMAIL || "hosatioon@gmail.com")
    .trim()
    .toLowerCase();
  if (!ctx.isSuperAdmin || ctx.email !== ownerEmail) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return ctx;
}

/**
 * Solo autenticación, sin checkeo de tenant (útil para rutas de super-admin).
 */
export async function requireAuth(): Promise<
  Omit<AuthContext, "tenantId"> & { tenantId?: number }
> {
  const session = await auth();
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return {
    tenantId: session.user.tenantId,
    userId: Number(session.user.id),
    email: session.user.email.toLowerCase(),
    role: session.user.role,
    isSuperAdmin: session.user.isSuperAdmin ?? false,
  };
}
