# Pricing — Planes de pago implementados

> Documentación de la **estructura de planes ya implementada en la base de datos**. Ver `src/lib/db.ts` para el código fuente.

## Esquema de BD (tablas)

### `plans` — Catálogo de planes

| Campo              | Tipo        | Descripción                          |
| ------------------ | ----------- | ------------------------------------ |
| `id`               | INTEGER PK  |                                      |
| `name`             | TEXT        | Nombre visible                       |
| `slug`             | TEXT UNIQUE | `free`, `starter`, `pro`, `business` |
| `daily_chat_limit` | INTEGER     | Chats por día permitidos             |
| `price_cop`        | INTEGER     | Precio en pesos colombianos          |
| `price_usd`        | REAL        | Precio en dólares                    |
| `description`      | TEXT        | Texto marketing                      |

### `tenant_plans` — Plan asignado a cada tenant

| Campo               | Tipo                 | Descripción                                 |
| ------------------- | -------------------- | ------------------------------------------- |
| `tenant_id`         | INTEGER FK → tenants | **UNIQUE**: un plan por tenant              |
| `plan_id`           | INTEGER FK → plans   |                                             |
| `status`            | TEXT                 | `trial`, `active`, `suspended`, `cancelled` |
| `next_billing_date` | INTEGER (unix)       | Próximo cobro                               |

### `tenant_daily_usage` — Contador diario

| Campo                | Tipo              | Descripción           |
| -------------------- | ----------------- | --------------------- |
| `tenant_id`          | INTEGER PK        |                       |
| `date`               | TEXT (YYYY-MM-DD) |                       |
| `conversation_count` | INTEGER           | Chats iniciados hoy   |
| `message_count`      | INTEGER           | Total de mensajes hoy |

## Planes precargados (seed)

| Plan         | Chats/día | COP/mes  | USD/mes | Para quién              |
| ------------ | --------- | -------- | ------- | ----------------------- |
| **Gratis**   | 10        | $0       | $0      | Probar la plataforma    |
| **Starter**  | 30        | $49,000  | $12.25  | Cafetería, tienda chica |
| **Pro** ⭐   | 50        | $75,000  | $18.75  | Restaurante, ferretería |
| **Business** | Ilimitado | $120,000 | $30.00  | Farmacia, supermercado  |

> El plan **Pro a $75,000 COP** es el más competitivo para el mercado colombiano promedio.

## Costo real vs precio de venta

| Concepto                     | Costo mensual                |
| ---------------------------- | ---------------------------- |
| LLM (50 chats/día × 30 días) | ~$0.03 USD                   |
| Hosting (proporcional)       | ~$1 USD                      |
| **Tu costo total**           | **~$1.03 USD ≈ $4,100 COP**  |
| **Precio de venta (Pro)**    | **$75,000 COP ≈ $18.75 USD** |
| **Margen bruto**             | **~$71,000 COP (95%)**       |

## Flujo de "se registra y empieza"

1. Visitante crea cuenta → se crea tenant automáticamente.
2. Se asigna plan **Gratis** (10 chats/día) o **trial de 14 días** en plan Pro.
3. Al finalizar, pasarela de pago (Wompi) cobra mensual.
4. Si paga: `status = 'active'` + actualizar `next_billing_date`.

## Cuándo se bloquea el bot

La función `hasExceededDailyLimit(tenantId)` compara `tenant_daily_usage.conversation_count` contra `plans.daily_chat_limit`.

Si se excede, el bot puede responder algo como:

> _"Hoy hemos atendido el límite de chats de tu plan. Tu plan se renueva mañana. ¿Querés actualizar?"_

## Próximos pasos

- [ ] Integrar pasarela Wompi (Bancolombia) para cobro automático en COP.
- [ ] Crear UI de "Planes" en el dashboard para que el super-admin gestione precios.
- [ ] Crear landing pública con selector de plan y checkout.
- [ ] Email automático 3 días antes de que expire el plan.

## Setup fee sugerida

- **$50,000-150,000 COP una vez** por:
  - Configuración del número de WhatsApp.
  - Carga inicial del catálogo.
  - Personalización del prompt.
  - Capacitación al cliente.

## Diferenciadores vs competencia colombiana

|                            | Plataformas existentes (Wasapi, Botiffy) | Tu proyecto           |
| -------------------------- | ---------------------------------------- | --------------------- |
| Costo mensual              | $200k-400k COP                           | $49k-75k COP          |
| LLM con memoria            | No                                       | Sí (Gemini 2.0 Flash) |
| Inventario integrado       | No                                       | Sí                    |
| Flujo de pedido completo   | Flujos rígidos                           | Conversación natural  |
| Registro self-service      | Contactar ventas                         | Crear cuenta solo     |
| Costo por mensaje WhatsApp | API oficial ($0.005-0.05)                | Baileys ($0)          |
