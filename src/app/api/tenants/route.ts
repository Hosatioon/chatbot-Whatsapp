import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listTenants,
  createTenant,
  getTenantBySlug,
  createUser,
  getUserByEmail,
  getPlanBySlug,
  setTenantPlan,
} from "@/lib/db";
import { requireAuth } from "@/lib/tenant";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug solo permite a-z 0-9 -"),
  // Opcional: crear usuario admin para este tenant
  adminEmail: z.string().trim().email().optional(),
  adminPassword: z.string().trim().min(6).optional(),
  adminName: z.string().trim().min(1).optional(),
});

async function requireSuperAdmin() {
  const auth = await requireAuth();
  if (!auth.isSuperAdmin) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return auth;
}

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(listTenants());
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detail: parsed.error.format() },
        { status: 400 },
      );
    }
    if (getTenantBySlug(parsed.data.slug)) {
      return NextResponse.json({ error: "slug ya existe" }, { status: 409 });
    }
    const t = createTenant(parsed.data.name, parsed.data.slug);

    // Asignar plan Prueba (15 días, 50 chats/día)
    const trialPlan = getPlanBySlug("trial");
    if (trialPlan) {
      const trialEndDate = Math.floor(Date.now() / 1000) + 15 * 24 * 60 * 60;
      setTenantPlan(t.id, trialPlan.id, "trial", null, trialEndDate);
    }

    // Crear usuario admin si se proporcionaron datos
    if (
      parsed.data.adminEmail &&
      parsed.data.adminPassword &&
      parsed.data.adminName
    ) {
      if (getUserByEmail(parsed.data.adminEmail)) {
        return NextResponse.json(
          { error: "El email del admin ya existe" },
          { status: 409 },
        );
      }
      const hash = await bcrypt.hash(parsed.data.adminPassword, 12);
      createUser(
        parsed.data.adminEmail,
        hash,
        parsed.data.adminName,
        "ADMIN",
        t.id,
      );
    }

    return NextResponse.json(t, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
