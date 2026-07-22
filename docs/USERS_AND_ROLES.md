# Usuarios y roles

## Jerarquía

```
super-admin  (is_super_admin = 1)
    └─ ADMIN     (gestiona su tenant)
        ├─ OPERATOR  (atiende conversaciones, edita inventario)
        └─ VIEWER    (solo lectura)
```

## Permisos por rol

| Acción | super-admin | ADMIN | OPERATOR | VIEWER |
|---|:---:|:---:|:---:|:---:|
| Ver dashboard | ✅ todos los tenants | ✅ su tenant | ✅ su tenant | ✅ su tenant |
| Crear/editar/eliminar tenants | ✅ | ❌ | ❌ | ❌ |
| Cambiar entre tenants (selector) | ✅ | ❌ | ❌ | ❌ |
| Crear usuarios | ✅ cualquier tenant | ✅ su tenant | ❌ | ❌ |
| Editar inventario | ✅ | ✅ | ✅ | ❌ |
| Ver conversaciones | ✅ | ✅ | ✅ | ✅ |
| Responder manualmente | ✅ | ✅ | ✅ | ❌ |
| Configurar bot / QR | ✅ | ✅ | ❌ | ❌ |
| Acceso aunque bot esté desconectado | ✅ (con banner) | ❌ | ❌ | ❌ |

## Implementación técnica

### Esquema

```sql
users(
  id,
  email,
  password_hash,
  name,
  role TEXT CHECK(role IN ('ADMIN','OPERATOR','VIEWER')),
  tenant_id INTEGER,
  is_super_admin INTEGER DEFAULT 0,
  created_at
)
```

### Sesión (NextAuth)

`auth.ts` propaga estos campos al token y a la sesión:

```ts
session.user = {
  id, email, name,
  role,           // 'ADMIN' | 'OPERATOR' | 'VIEWER'
  tenantId,       // number | null (null para super-admin sin tenant)
  isSuperAdmin,   // boolean
}
```

### Helpers

- `requireTenantId()` (`src/lib/tenant.ts`) — usa la sesión para inferir el tenant. Para super-admin con `selectedTenantId` en query/body, lo respeta.
- `requireAuth()` — solo verifica login, sin restricción de tenant. Útil para rutas de super-admin.

### Patrón en routes

```ts
const ctx = await requireTenantId();
if (!ctx.isSuperAdmin && ctx.tenantId !== requestedTenantId) {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
```

## Cómo crear un super-admin manualmente

```bash
sqlite3 data/bot.db "UPDATE users SET is_super_admin = 1 WHERE email = 'tu@correo.com';"
```

## Cómo cambiar el rol de un usuario

Vía UI (super-admin o ADMIN del tenant) en la sección de usuarios, o por SQL:

```bash
sqlite3 data/bot.db "UPDATE users SET role = 'OPERATOR' WHERE email = 'op@empresa.com';"
```
