import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTenant,
  getTenantBySlug,
  createUser,
  getUserByEmail,
  getPlanBySlug,
  setTenantPlan,
} from "@/lib/db";
import bcrypt from "bcryptjs";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// Slugs reservados que no deben permitirse como tenant slug
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "dashboard",
  "health",
  "login",
  "logout",
  "register",
  "root",
  "static",
  "www",
]);

// Dominios de email desechables conocidos
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "tempmail.org",
  "mailinator.com",
  "throwaway.email",
  "yopmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakemail.net",
  "sharklasers.com",
  "guerrillamailblock.com",
  "spam4.me",
  "temp-mail.org",
  "emailondeck.com",
  "fakeinbox.com",
  "mintemail.com",
  "mohmal.com",
  "tmpmail.net",
]);

function isDisposableEmail(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}

const RegisterBody = z.object({
  tenantName: z.string().trim().min(2).max(80),
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug solo permite a-z 0-9 -")
    .refine((s) => !RESERVED_SLUGS.has(s), "slug reservado"),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: z.string().trim().min(8).max(100),
  // Honeypot: campo oculto que los bots llenan automáticamente
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  try {
    // Rate limit: 5 registros por hora por IP para evitar spam
    const ip = getClientIp(req);
    const rl = checkApiRateLimit(`register:${ip}`, 5, 3600000);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);

    const parsed = RegisterBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", detail: parsed.error.format() },
        { status: 400 },
      );
    }

    const { tenantName, tenantSlug, name, email, password, website } =
      parsed.data;

    // Honeypot: si el campo oculto tiene contenido, es un bot
    if (website) {
      return NextResponse.json(
        { ok: true, message: "Cuenta creada." },
        { status: 201 },
      );
    }

    // Validar email desechable
    const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
    if (isDisposableEmail(emailDomain)) {
      return NextResponse.json(
        { error: "No se permiten emails desechables. Usá un email real." },
        { status: 400 },
      );
    }

    if (getTenantBySlug(tenantSlug)) {
      return NextResponse.json(
        { error: "El slug ya existe. Elegí otro." },
        { status: 409 },
      );
    }
    if (getUserByEmail(email)) {
      return NextResponse.json(
        { error: "El email ya está registrado" },
        { status: 409 },
      );
    }

    // 1. Crear tenant
    const tenant = createTenant(tenantName, tenantSlug);

    // 2. Crear usuario ADMIN del tenant
    const hash = await bcrypt.hash(password, 12);
    createUser(email, hash, name, "ADMIN", tenant.id);

    // 3. Asignar plan Prueba (15 días, 50 chats/día)
    const trialPlan = getPlanBySlug("trial");
    if (trialPlan) {
      const trialEndDate = Math.floor(Date.now() / 1000) + 15 * 24 * 60 * 60;
      setTenantPlan(tenant.id, trialPlan.id, "trial", null, trialEndDate);
    }

    return NextResponse.json(
      {
        ok: true,
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        message: "Cuenta creada. Iniciá sesión para conectar tu WhatsApp.",
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    console.error("[register] Error:", e);
    return NextResponse.json(
      { error: "Error interno. Intentá de nuevo." },
      { status: 500 },
    );
  }
}
