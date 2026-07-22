import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listProducts,
  listAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductActive,
} from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { checkApiRateLimit, apiRateLimitResponse } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  description: z.string().trim().max(500).optional(),
  variants: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        price: z.number().int().nonnegative(),
        stock: z.number().int().nonnegative().optional(),
      })
    )
    .optional(),
  tenantId: z.number().int().positive().optional(),
});

const UpdateBody = CreateBody.extend({
  id: z.number().int().positive(),
});

const PatchBody = z.object({
  id: z.number().int().positive(),
  active: z.boolean(),
  tenantId: z.number().int().positive().optional(),
});

const DeleteBody = z.object({
  id: z.number().int().positive(),
  tenantId: z.number().int().positive().optional(),
});

// Helper: resuelve el tenant target. Si el body trae tenantId y el user es superadmin,
// usa ese. Sino, el del propio user.
function resolveTenantId(
  authTenantId: number,
  isSuperAdmin: boolean,
  bodyTenantId?: number,
): number {
  if (isSuperAdmin && bodyTenantId && bodyTenantId > 0) return bodyTenantId;
  return authTenantId;
}

function handleErr(e: unknown) {
  if (e instanceof Response) return e;
  console.error("[api/products]", e);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const { tenantId, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    const { searchParams } = new URL(req.url);
    const filterTenant = searchParams.get("tenantId");

    if (isSuperAdmin) {
      if (filterTenant) {
        return NextResponse.json(listProducts(Number(filterTenant)));
      }
      return NextResponse.json(listAllProducts());
    }

    return NextResponse.json(listProducts(tenantId));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const {
      name,
      price,
      stock,
      description,
      variants,
      tenantId: bodyTenantId,
    } = parsed.data;
    const target = resolveTenantId(tenantId, isSuperAdmin, bodyTenantId);
    const product = createProduct(target, name, price, stock, description, variants ?? null);
    return NextResponse.json(product, { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PUT(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const {
      id,
      name,
      price,
      stock,
      description,
      variants,
      tenantId: bodyTenantId,
    } = parsed.data;
    const target = resolveTenantId(tenantId, isSuperAdmin, bodyTenantId);
    updateProduct(target, id, name, price, stock, description, variants ?? null);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleErr(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const target = resolveTenantId(
      tenantId,
      isSuperAdmin,
      parsed.data.tenantId,
    );
    toggleProductActive(target, parsed.data.id, parsed.data.active);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const { tenantId, role, isSuperAdmin } = await requireTenantId();
    const rl = checkApiRateLimit(`tenant:${tenantId}`);
    if (!rl.ok) return apiRateLimitResponse(rl.retryAfter);
    if (role !== "ADMIN" && !isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    }
    const target = resolveTenantId(
      tenantId,
      isSuperAdmin,
      parsed.data.tenantId,
    );
    deleteProduct(target, parsed.data.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleErr(e);
  }
}
