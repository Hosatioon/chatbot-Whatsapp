# Documentación del Proyecto

Bienvenido a la documentación interna del bot de WhatsApp multi-tenant.

## Índice

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Estructura técnica, multi-tenant, base de datos.
- [COSTS.md](./COSTS.md) — Costos del LLM, cálculos por escenario y comparativa de modelos.
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Despliegue, variables de entorno, configuración de super-admin.
- [USERS_AND_ROLES.md](./USERS_AND_ROLES.md) — Roles del sistema (super-admin, ADMIN, OPERATOR, VIEWER).
- [PRICING.md](./PRICING.md) — Planes de pago implementados en la base de datos.
- [FORECAST.md](./FORECAST.md) — Proyección financiera a 12 meses y análisis Baileys vs WABA.

## Flujos principales

| Flujo                        | Quién lo usa                 | Dónde está                                                 |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------- |
| **Super-admin crea tenant**  | Vos (dueño de la plataforma) | `/admin/tenants` — con checkbox para crear usuario admin   |
| **Cliente se registra solo** | Visitante de tu landing      | `POST /api/register` — crea tenant + usuario + plan Gratis |
| **Conectar WhatsApp**        | Admin del negocio            | Dashboard → escanear QR por tenant                         |
| **Atender chats**            | Operador del negocio         | Dashboard con conversaciones filtradas por tenant          |

## Resumen rápido

- **Stack:** Next.js 15 + React 19, NextAuth v5, Baileys (WhatsApp), SQLite (better-sqlite3), TailwindCSS, OpenRouter (LLM).
- **Multi-tenant:** Cada tenant = 1 negocio = 1 número de WhatsApp. Todos los datos están aislados por `tenant_id`.
- **Super-admin:** Rol especial que ve y administra todos los tenants (`is_super_admin = 1`).
- **Bot:** Proceso aparte (`scripts/start-bot.ts`) que arranca un socket de WhatsApp por cada tenant activo. Cada tenant tiene su propia carpeta `auth/{tenantId}/` y su propio QR.
