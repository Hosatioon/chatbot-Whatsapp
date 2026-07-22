import { auth } from "@/auth";

export { getBotTenantId } from "./bot-tenant";

export type AuthContext = {
  tenantId: number;
  userId: number;
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
    role: session.user.role,
    isSuperAdmin: session.user.isSuperAdmin ?? false,
  };
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
    role: session.user.role,
    isSuperAdmin: session.user.isSuperAdmin ?? false,
  };
}
