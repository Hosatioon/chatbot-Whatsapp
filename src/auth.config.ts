import type { NextAuthConfig } from "next-auth";

// Config compartida entre Edge (middleware) y Node.js (route handlers).
// Sin providers ni acceso a la BD para que sea Edge-safe.
export const authConfig: NextAuthConfig = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
  },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.tenantId = (user as { tenantId?: number }).tenantId;
        token.isSuperAdmin = (user as { isSuperAdmin?: boolean }).isSuperAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = String(token.sub);
        // @ts-expect-error campos custom
        session.user.role = token.role;
        // @ts-expect-error campos custom
        session.user.tenantId = token.tenantId;
        // @ts-expect-error campos custom
        session.user.isSuperAdmin = token.isSuperAdmin ?? false;
      }
      return session;
    },
  },
};
