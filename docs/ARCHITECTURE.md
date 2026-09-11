# Mondrex - Arquitectura Técnica

## Overview

Mondrex es una plataforma multi-tenant de chatbot WhatsApp para negocios de delivery/comercio. Permite a múltiples tenants (negocios) gestionar conversaciones de WhatsApp con IA, pedidos, catálogos de productos y más.

**Stack actual (lo que realmente corre hoy, `docker-compose.yml`):**
- **Backend:** Next.js 16 (App Router) + TypeScript
- **Bot:** Baileys (WhatsApp Web API), embebido en `src/lib/baileys/` + `src/lib/openrouter.ts`, corrido como proceso separado por `scripts/start-bot.ts` (`Dockerfile.bot`)
- **Base de datos:** SQLite (`src/lib/db.ts`), compartida entre el dashboard y el bot vía el volumen `./data`
- **Cache/Rate Limit:** rate limiting propio en SQLite (`src/lib/rate-limit.ts`)
- **Auth:** NextAuth.js con credentials
- **LLM:** OpenAI via OpenRouter, con function-calling (tools), validación de stock y cálculo de precios/domicilio en el backend
- **Despliegue:** Docker + Docker Compose (`docker-compose.yml`)

**Stack objetivo (futuro, NO desplegado todavía — `docker-compose.prod.yml` + `bot-service/`):**
- **Base de datos:** PostgreSQL vía `src/lib/db-pg.ts` / `db-adapter.ts`
- **Cache/Rate Limit/Queue:** Redis + BullMQ
- **Bot:** proceso independiente en `bot-service/`, escalable por tenant

`bot-service/` existe en el repo pero **no está terminado**: usa su
propia SQLite local (no Postgres, no la del dashboard) y no tiene la
validación de stock/precio del bot actual. Ver `bot-service/README.md`
antes de tocarlo. Para desplegar, seguí `docs/DEPLOYMENT.md`, que usa el
stack actual.

---

## Arquitectura de Producción (objetivo futuro — no desplegada)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DOCKER COMPOSE                                  │
│                                                                          │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐ │
│  │    Next.js App   │     │   Bot Service   │     │   Bot Service    │ │
│  │    Puerto 3000   │     │   Puerto 3001   │     │   (2do instance) │ │
│  │                  │     │                  │     │                  │ │
│  │  - Dashboard    │     │  - Baileys      │     │  - Baileys       │ │
│  │  - API routes   │     │  - Message Hndl │     │  - Message Hndl  │ │
│  │  - Auth         │     │  - BullMQ Worker│     │  - BullMQ Worker │ │
│  │  - React        │     │                  │     │                  │ │
│  └────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘ │
│           │                       │                       │           │
│           └───────────────────────┼───────────────────────┘           │
│                                   │                                   │
│  ┌────────────────────────────────▼────────────────────────────────┐ │
│  │                      SHARED SERVICES                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │ │
│  │  │ PostgreSQL  │  │    Redis    │  │  BullMQ     │              │ │
│  │  │  Puerto 5432│  │  Puerto 6379│  │  (via Redis)│              │ │
│  │  │             │  │             │  │             │              │ │
│  │  │  - messages │  │  - cache   │  │  - outbox   │              │ │
│  │  │  - orders   │  │  - rate    │  │  - retry    │              │ │
│  │  │  - products │  │  - session │  │  - priority │              │ │
│  │  │  - tenants  │  │            │  │             │              │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────┐                                               │
│  │   Volumes:          │                                               │
│  │  - postgres_data    │                                               │
│  │  - redis_data       │                                               │
│  │  - ./auth (tenants) │                                               │
│  └──────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Estructura del Proyecto

```
chatbot/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── admin/              # Dashboard admin
│   │   │   └── tenants/        # Gestión de tenants
│   │   ├── api/                # API routes
│   │   │   ├── auth/           # NextAuth endpoints
│   │   │   ├── connection/      # Estado conexión WhatsApp
│   │   │   ├── conversations/  # CRUD conversaciones
│   │   │   ├── health/         # Health check
│   │   │   ├── messages/       # Mensajes
│   │   │   ├── mode/           # Cambiar modo AI/HUMAN
│   │   │   ├── orders/         # CRUD pedidos
│   │   │   ├── products/       # CRUD productos
│   │   │   ├── register/       # Registro usuarios
│   │   │   ├── tenant/         # Gestión tenant
│   │   │   └── tenants/        # Lista tenants
│   │   ├── login/              # Página login
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Landing/redirect
│   ├── auth.ts                 # NextAuth config
│   ├── auth.config.ts          # Auth callbacks
│   ├── middleware.ts            # Auth middleware
│   ├── components/             # Componentes React
│   ├── hooks/                  # Custom hooks
│   └── lib/
│       ├── baileys/
│       │   ├── client.ts      # Cliente Baileys
│       │   └── handler.ts     # Message handler
│       ├── db.ts              # SQLite (desarrollo)
│       ├── db-adapter.ts      # Interface abstracción DB
│       ├── db-pg.ts          # Adaptador PostgreSQL
│       ├── redis.ts          # Redis client (rate limit + cache)
│       ├── queue.ts          # BullMQ outbox queue
│       ├── events.ts         # Sistema de eventos pedidos
│       ├── excel-parser.ts   # Parser Excel productos
│       ├── openrouter.ts    # Integración LLM
│       ├── rate-limit.ts    # Rate limiting (legacy)
│       ├── system-prompt.ts # Prompt para LLM
│       └── tenant.ts        # Helpers de tenant
├── scripts/
│   ├── create-user.ts        # Crear usuario admin
│   ├── env-loader.ts         # Carga .env.local
│   ├── migrate-to-pg.ts      # Migración SQLite → PG
│   └── start-bot.ts         # Script inicio bot
├── bot-service/              # Servicio de bot separado
│   ├── src/
│   │   ├── index.ts         # Entry point + health server
│   │   ├── db.ts           # DB layer (SQLite local)
│   │   ├── redis.ts        # Redis client
│   │   ├── queue.ts        # BullMQ client
│   │   ├── baileys/        # Baileys client + handler
│   │   ├── openrouter.ts   # LLM
│   │   ├── events.ts       # Events
│   │   └── system-prompt.ts # LLM prompt
│   ├── data/                  # SQLite local (cache)
│   ├── auth/                  # WhatsApp auth state
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── docs/
│   └── ARCHITECTURE.md       # Este archivo
├── docker-compose.yml        # Desarrollo (SQLite)
├── docker-compose.prod.yml   # Producción (PostgreSQL + Redis)
└── package.json
```

---

## Componentes Clave

### 1. Redis (`src/lib/redis.ts`)

**Responsabilidades:**
- Rate limiting por tenant/phone
- Caché de respuestas LLM
- Caché de productos
- Caché de conversaciones

**Estructura de claves:**
```
ratelimit:{tenantId}:{phone}:minute     # Sorted set (timestamp score)
ratelimit:{tenantId}:{phone}:hour      # Sorted set (timestamp score)
ratelimit:{tenantId}:{phone}:dup:{hash} # Sorted set (duplicados)
llm:cache:{cacheKey}                    # JSON con TTL
products:{tenantId}                     # JSON con TTL
convo:{tenantId}:{phone}                # JSON con TTL
```

**Límites por defecto:**
- 20 mensajes/minuto/phone
- 100 mensajes/hora/phone
- 3 mensajes idénticos en 60 segundos

### 2. BullMQ Queue (`src/lib/queue.ts`)

**Responsabilidades:**
- Persistencia de mensajes salientes
- Retry automático con backoff exponencial
- Priorización de mensajes
- Processing concurrente (5 workers)

**Cola:** `outbox`

**Job options:**
- `attempts: 3`
- `backoff: exponential (2s base)`
- `removeOnComplete: 100`
- `removeOnFail: 1000`

**Job data:**
```typescript
interface OutboxJob {
  id: number;
  tenantId: number;
  conversationId: number;
  phone: string;
  remoteJid: string;
  content: string;
  retryCount: number;
}
```

### 3. Bot Service Handler

**Flujo de mensaje:**
```
WhatsApp msg
    ↓
extractText() + jidToPhone()
    ↓
checkRateLimit() ← Redis
    ↓
getOrCreateConversation()
    ↓
hasExceededDailyLimit()
    ↓
generateReply() → LLM
    ↓
┌─ intent: "chat" → enqueueOutboxMessage() → BullMQ
│                         ↓
│                    sock.sendMessage()
│
└─ intent: "create_order" → createOrder() → DB
                              ↓
                         enqueueOutboxMessage() → BullMQ
```

---

## Base de Datos

### Schema PostgreSQL

```sql
-- Tenants (multi-tenant)
tenants
  - id (PK)
  - name
  - slug (UNIQUE)
  - theme (light|dark|blue|pink|whatsapp)
  - created_at

-- Usuarios
users
  - id (PK)
  - email (UNIQUE)
  - password_hash
  - name
  - role (ADMIN|OPERATOR|VIEWER)
  - tenant_id (FK → tenants)
  - is_super_admin
  - created_at

-- Conversaciones WhatsApp
conversations
  - id (PK)
  - tenant_id (FK → tenants)
  - phone (UNIQUE per tenant)
  - jid (WhatsApp JID, para Linked ID)
  - name (pushName)
  - mode (AI|HUMAN)
  - last_message_at
  - created_at

-- Mensajes
messages
  - id (PK)
  - conversation_id (FK → conversations)
  - role (user|assistant|human)
  - content
  - created_at

-- Estado conexión WhatsApp
connection_state
  - tenant_id (PK)
  - status (disconnected|qr|connecting|connected)
  - qr_string
  - phone
  - updated_at

-- Outbox (para legacy, ahora se usa BullMQ)
outbox
  - id (PK)
  - tenant_id (FK → tenants)
  - conversation_id (FK → conversations)
  - phone
  - remote_jid
  - content
  - sent (0|1)
  - created_at

-- Productos
products
  - id (PK)
  - tenant_id (FK → tenants)
  - name
  - price (integer, centavos COP)
  - stock
  - active (0|1)
  - description
  - variants (JSON)
  - created_at

-- Pedidos
orders
  - id (PK)
  - tenant_id (FK → tenants)
  - customer_phone
  - customer_name
  - status (PENDING|CONFIRMED|PREPARING|ON_THE_WAY|DELIVERED|CANCELLED)
  - total_amount
  - notes
  - created_at
  - updated_at

-- Items de pedido
order_items
  - id (PK)
  - order_id (FK → orders)
  - product_name
  - quantity
  - unit_price
  - total_price

-- Rate limiting (legacy, ahora en Redis)
message_events
  - id (PK)
  - tenant_id
  - phone
  - content_hash
  - created_at

-- Planes y uso
plans
  - id (PK)
  - name
  - slug (UNIQUE)
  - daily_chat_limit
  - price_cop
  - price_usd
  - description

tenant_plans
  - id (PK)
  - tenant_id (FK → tenants)
  - plan_id (FK → plans)
  - status (active|suspended|cancelled|trial)
  - next_billing_date
  - created_at

tenant_daily_usage
  - tenant_id (PK, FK → tenants)
  - date (YYYY-MM-DD)
  - conversation_count
  - message_count
  - updated_at
```

---

## API Routes

### Autenticación
- `POST /api/auth/[...nextauth]` - NextAuth handlers

### Conexión
- `GET /api/connection` - Obtener estado de conexión
- `POST /api/connection/reset` - Reset conexión (genera nuevo QR)

### Conversaciones
- `GET /api/conversations` - Lista conversaciones
- `GET /api/conversations/[id]` - Detalles conversación
- `GET /api/conversations/[id]/messages` - Mensajes
- `DELETE /api/conversations/[id]` - Eliminar conversación
- `POST /api/conversations/[id]/mode` - Cambiar modo AI/HUMAN

### Mensajes
- `POST /api/messages/send` - Enviar mensaje manual (outbox)

### Pedidos
- `GET /api/orders` - Lista pedidos
- `GET /api/orders/[id]` - Detalle pedido
- `POST /api/orders/[id]/status` - Actualizar estado

### Productos
- `GET /api/products` - Lista productos
- `POST /api/products` - Crear producto
- `PUT /api/products/[id]` - Actualizar producto
- `DELETE /api/products/[id]` - Eliminar producto
- `POST /api/products/import` - Importar desde Excel

### Tenants (super-admin)
- `GET /api/tenants` - Lista tenants
- `POST /api/tenant` - Crear tenant
- `PUT /api/tenant/[id]/theme` - Cambiar tema

### Health
- `GET /api/health` - Health check

---

## Health Checks

### Bot Service (`/health`)
```json
{
  "status": "ok",
  "service": "bot-service",
  "activeTenants": 2,
  "tenants": [1, 2],
  "uptime": 3600,
  "redis": {
    "ok": true,
    "latency": 2
  },
  "queue": {
    "waiting": 0,
    "active": 1,
    "completed": 150,
    "failed": 0,
    "delayed": 0
  }
}
```

### App (`/api/health`)
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 7200,
  "database": {
    "ok": true,
    "latency": 5
  }
}
```

---

## Migración a PostgreSQL

### Script de Migración

```bash
# 1. Exportar DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/mondrex"

# 2. Correr script
npx tsx scripts/migrate-to-pg.ts

# 3. Verificar datos
# 4. Cambiar .env.local
# 5. Reiniciar aplicación
```

### Adaptador PostgreSQL

El archivo `src/lib/db-pg.ts` implementa la misma interfaz que `db.ts`
pero usando `pg` con connection pooling.

```typescript
import { getPgAdapter } from "./db-pg";

// Uso similar a db.ts
const db = await getPgAdapter();
const products = await db.getActiveProducts(tenantId);
```

---

## Despliegue

### Desarrollo local
```bash
npm run dev
# Usa SQLite, sin Redis
```

### Producción
```bash
# 1. Configurar .env.production
cp .env.production.example .env.production
# Editar valores: DATABASE_URL, REDIS_URL, OPENROUTER_API_KEY

# 2. Iniciar servicios
docker-compose -f docker-compose.prod.yml up -d

# 3. Ver logs
docker-compose -f docker-compose.prod.yml logs -f

# 4. Migrar DB (primera vez)
docker exec mondrex-app npx tsx scripts/migrate-to-pg.ts
```

### Escalado horizontal del bot
```bash
# Agregar más instancias del bot
docker-compose -f docker-compose.prod.yml scale bot=3

# O con docker swarm
docker service scale mondrex_bot=3
```

---

## Costos Estimados (Producción)

| Servicio | Tier | Costo Mensual |
|----------|------|--------------|
| Compute (VPS x2) | 4GB RAM | $40-60 |
| PostgreSQL | Railway Starter | $25 |
| Redis | Upstash Free | $0 |
| Object Storage | R2 / S3 | $5 |
| CDN | Cloudflare | $0-20 |
| Monitoring | Grafana Cloud | $0-25 |
| Dominio | - | $10 |
| **Total** | | **$80-145/mo** |

Para 10K clientes: ~$500-800/mo
Para 100K clientes: ~$2000-4000/mo

---

## Roadmap Técnico

### Fase 1: Supervivencia (Mes 1-3) ✅
- [x] Script migración SQLite → PostgreSQL
- [x] Adaptador PostgreSQL (`db-pg.ts`)
- [x] Bot service separado (estructura)
- [x] Redis para rate limiting y caché
- [x] BullMQ para outbox

### Fase 2: Estabilidad (Mes 4-6)
- [ ] Monitoring (Prometheus + Grafana)
- [ ] Logging estructurado (Pino → Loki)
- [ ] Circuit breaker para LLM
- [ ] CDN para contenido estático

### Fase 3: Escalabilidad (Mes 7-9)
- [ ] Kubernetes / auto-scaling
- [ ] Read replicas PostgreSQL
- [ ] Redis cluster
- [ ] Message queue centralizado (Kafka)

### Fase 4: LATAM (Mes 10-12)
- [ ] Multi-region deployment
- [ ] Compliance (GDPR, leyes locales)
- [ ] Disaster recovery
- [ ] Scale to 100K+ clientes

---

## Troubleshooting

### WhatsApp desconectado
1. Verificar scanner QR en dashboard
2. Verificar logs: `docker logs mondrex-bot`
3. Reiniciar: `docker restart mondrex-bot`

### Mensajes no se envían
1. Verificar cola BullMQ: `curl localhost:3001/metrics`
2. Verificar Redis: `curl localhost:3001/health`
3. Retry manual: `docker exec mondrex-bot node -e "require('./dist/queue').retryAllFailed()"`

### LLM no responde
1. Verificar `OPENROUTER_API_KEY` en .env.production
2. Verificar quota de OpenRouter
3. Revisar logs: `docker logs mondrex-bot 2>&1 | grep -i openrouter`

### Rate limit activado
1. Esperar 1 minuto
2. Si persiste, puede ser spam
3. Verificar métricas en `/health`

### Redis desconectado
1. El bot sigue funcionando (degradado)
2. Rate limiting vuelve a SQLite (más lento)
3. Mensajes se envían directo (sin cola BullMQ)

---

## Glosario

- **Tenant:** Un negocio/empresa que usa la plataforma
- **Baileys:** Librería para conectar con WhatsApp Web
- **Outbox:** Cola de mensajes pendientes por enviar
- **BullMQ:** Cola de mensajes basada en Redis con retry
- **System Prompt:** Instrucciones para el LLM
- **Linked ID:** Cuenta WhatsApp vinculada a teléfono

---

## Referencias

- [Baileys Documentation](https://github.com/WhiskeySockets/baleays)
- [Next.js Documentation](https://nextjs.org/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [OpenRouter Documentation](https://openrouter.ai/docs)
