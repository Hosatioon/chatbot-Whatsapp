# Flujo Operativo y Escalabilidad

## Objetivo

Operar una plataforma de atención por WhatsApp para emprendimientos con inventario, conversaciones, pedidos y operadores humanos. Cada negocio es un tenant aislado y paga instalación más suscripción mensual.

## Principios no negociables

1. Cada tenant tiene sus datos, usuarios, catálogo, presupuesto y sesión de WhatsApp aislados por `tenant_id`.
2. Las claves de OpenRouter, credenciales de base de datos y sesiones de WhatsApp solo viven en el backend o en un gestor de secretos.
3. El consumo de IA se limita por tenant y por plataforma; ningún cliente puede consumir el presupuesto de los demás.
4. La mensajería se limita a atención esperada por el usuario; no se ofrecen campañas masivas mediante Baileys.
5. Baileys es una integración no oficial. Para clientes que requieran garantía, campañas o funciones oficiales, se ofrecerá WhatsApp Cloud API como modalidad separada.
6. Se escala por métricas reales, no por una cantidad teórica de sesiones.

## Flujo de negocio

```text
Prospecto
  -> Demo y definición de plan
  -> Pago de instalación
  -> Crear tenant y usuario ADMIN
  -> Configurar catálogo, prompt y reglas
  -> Vincular número mediante QR
  -> Pruebas controladas
  -> Activar suscripción
  -> Monitorear uso, costo y salud
  -> Soporte, renovación o upgrade
```

### Onboarding de un tenant

1. Crear el tenant y asignar un plan.
2. Crear el usuario ADMIN del negocio; el cliente administra sus operadores.
3. Definir identidad del negocio: nombre, horario, entrega, pagos, preguntas frecuentes y tono.
4. Cargar o importar productos, precios, variantes y stock.
5. Ajustar el prompt del tenant sin incluir instrucciones que permitan acciones no autorizadas.
6. Conectar un número exclusivo del negocio. El propietario escanea el QR y conserva control de su cuenta.
7. Probar con números internos: saludo, consulta de inventario, pedido, modo humano y desconexión.
8. Activar el bot solo cuando las pruebas estén aprobadas.

## Aislamiento por tenant

| Recurso | Regla de aislamiento |
| --- | --- |
| Usuarios, productos, chats y pedidos | Todas las consultas se filtran por `tenant_id`. |
| Roles | `ADMIN`, `OPERATOR` y `VIEWER`; el super-admin administra la plataforma. |
| Sesión WhatsApp | Directorio de auth exclusivo: `auth/{tenantId}`. Nunca se comparte entre tenants. |
| Prompt y catálogo | Se construyen usando únicamente información del tenant actual. |
| Presupuesto IA | Contadores y límites diarios/mensuales por tenant. |
| Logs | Incluir `tenantId` y ocultar datos sensibles y contenido cuando no sea indispensable. |
| Backups | Restauración selectiva y prueba periódica de recuperación. |

## Arquitectura por etapas

### Etapa A — Piloto: 1 a 5 tenants

```text
Internet -> Reverse proxy HTTPS -> Next.js + bot worker -> SQLite
                                            -> OpenRouter
                                            -> sesiones Baileys
```

- Un servidor pequeño es suficiente para validar el producto.
- Un número/sesión de Baileys por tenant.
- Backups diarios de SQLite y de los directorios de auth cifrados.
- No vender disponibilidad empresarial ni volumen alto.
- Medir RAM, CPU, reconexiones, mensajes y costo IA antes de incorporar más clientes.

### Etapa B — Operación inicial: 5 a 20 tenants

```text
Internet -> Reverse proxy HTTPS -> Next.js API/dashboard
                                      |-> PostgreSQL
                                      |-> Redis
                                      |-> cola de trabajos
                                      |-> bot workers Baileys
                                      |-> OpenRouter
```

- Migrar la operación a PostgreSQL antes de depender de muchas escrituras concurrentes.
- Separar el dashboard/API de los workers de bot.
- Usar Redis y BullMQ para colas, reintentos y límites de concurrencia.
- Mantener una sesión y carpeta de auth por tenant.
- Hacer pruebas de carga y fijar una capacidad por worker basada en métricas, no en supuestos.

### Etapa C — Escala controlada: 20+ tenants

- Ejecutar varios workers y asignar tenants a cada worker.
- Guardar la asignación `tenant -> worker` para evitar que dos workers abran la misma sesión.
- Usar health checks, reinicios controlados y alertas de desconexión.
- Mantener PostgreSQL administrado, Redis administrado y backups automáticos fuera del servidor.
- Aislar clientes de alto volumen en un grupo de workers y presupuesto independiente.
- Preparar el adaptador de WhatsApp Cloud API sin cambiar el dominio de negocio: inventario, pedidos, conversaciones y roles permanecen iguales.

## Control de IA y costos

### Límites obligatorios

| Control | Política inicial |
| --- | --- |
| Respuesta del modelo | `max_tokens` bajo y prompt que exija mensajes breves. |
| Historial | Últimos mensajes relevantes más un resumen, no toda la conversación. |
| Rate limit | Por tenant, teléfono e intervalo de tiempo. |
| Concurrencia | Cola con cantidad limitada de llamadas OpenRouter por worker. |
| Presupuesto tenant | Tope diario y mensual configurable por plan. |
| Presupuesto global | Tope de seguridad para toda la plataforma. |
| Errores | Máximo dos reintentos con backoff; luego fallback humano. |

### Medición mínima por solicitud

Registrar: `tenantId`, modelo, tokens de entrada, tokens de salida, costo estimado, duración, resultado y causa de error.

### Al superar el presupuesto

1. No llamar más al LLM para ese tenant durante el periodo definido.
2. Mantener la conversación accesible para el operador.
3. Informar al administrador del tenant y al super-admin.
4. Permitir upgrade de plan o reactivación manual con trazabilidad.

## Seguridad

### Acceso y secretos

- HTTPS obligatorio en producción.
- `AUTH_SECRET`, claves de OpenRouter, base de datos y Redis en variables de entorno o gestor de secretos; nunca en Git, frontend o logs.
- Rotar claves si se sospecha exposición.
- Contraseñas con hash bcrypt/argon2; no guardar contraseñas en texto plano.
- Roles verificados en servidor en cada API route; la UI no es un control de seguridad.
- Cookies de sesión seguras en producción y expiración razonable.

### Datos y operación

- Validar toda entrada de API y archivos Excel.
- Aplicar rate limits al login, registro y APIs.
- Minimizar contenido de mensajes en logs; redactar teléfonos, tokens y secretos.
- Backups diarios cifrados, retención definida y restauración probada mensualmente.
- Actualizar dependencias con revisión de vulnerabilidades.
- Registrar auditoría de cambios críticos: usuarios, precios, productos, prompts, modos y desconexiones.

## Operación de WhatsApp

- Cada negocio controla y vincula su propio número.
- La atención debe ser reactiva: el usuario inicia o espera la conversación.
- No usar Baileys para campañas, difusión masiva o mensajes no solicitados.
- Una respuesta rápida o plantilla interna se usa dentro de una conversación y con contexto del cliente.
- El uso de Baileys no garantiza continuidad; existe riesgo por ser una integración no oficial.
- Mantener una ruta comercial y técnica hacia WhatsApp Cloud API para clientes que necesiten canal oficial.

## Monitoreo y alertas

### Métricas

- Tenants activos y sesiones conectadas/desconectadas.
- Uso de RAM y CPU por worker.
- Reconexiones y errores por tenant.
- Mensajes entrantes, salientes y pendientes en cola.
- Latencia y errores de OpenRouter.
- Tokens y costo por tenant, plan y plataforma.
- Fallos de autenticación, rate limits y operaciones administrativas.

### Alertas prioritarias

- Bot desconectado por más de 5 minutos.
- Cola detenida o con mensajes pendientes por encima del umbral.
- Tenant o plataforma cerca de presupuesto de IA.
- Error repetido de base de datos o backup.
- Pico de logins fallidos.
- Worker con memoria/CPU sostenida por encima del umbral definido.

## Incidentes

### Bot desconectado

1. Identificar tenant y motivo de desconexión.
2. Evitar reinicios simultáneos de todos los workers.
3. Reiniciar únicamente el worker afectado.
4. Si el QR expira o se invalida, solicitar al dueño del número volver a vincularlo.
5. Registrar causa y duración del incidente.

### Exceso de costo o tráfico

1. Frenar nuevas llamadas IA del tenant afectado mediante presupuesto o circuit breaker.
2. Pasar conversaciones a modo humano/fallback.
3. Revisar spam, bucles, reintentos y tamaño de contexto.
4. Restaurar solo tras confirmar la causa.

### Compromiso de credenciales

1. Revocar o rotar el secreto afectado inmediatamente.
2. Invalidar sesiones si corresponde.
3. Revisar logs y accesos.
4. Notificar a los clientes afectados según el alcance.

## Checklist antes de cobrar a un cliente

- [ ] Tenant creado y datos aislados por `tenant_id`.
- [ ] Usuario ADMIN creado y contraseña configurada.
- [ ] Productos, stock, precios y variantes revisados.
- [ ] Prompt probado con escenarios reales.
- [ ] Número correcto vinculado por QR.
- [ ] Pruebas de IA, humano, pedido, desconexión y recuperación aprobadas.
- [ ] Límites de IA y plan asignados.
- [ ] Backup y monitoreo activos.
- [ ] Condiciones de uso y alcance de soporte comunicados.
- [ ] Canal de soporte y responsable del negocio definidos.

## Prioridades de implementación

### Antes de vender a más de 5 tenants

1. ~~Corregir la interfaz entre SQLite y PostgreSQL para usar el adaptador de producción sin ignorar errores de tipos.~~ — ✅ Completado (2025-07-22)
2. ~~Implementar medición de tokens/costo y presupuesto por tenant.~~ — ✅ Completado (2025-07-22)
3. ~~Separar bot y dashboard en servicios independientes.~~ — ✅ Completado (2025-07-22)
4. ~~Agregar backups automáticos y prueba de restauración.~~ — ✅ Completado (2025-07-22)
5. ~~Agregar logs estructurados y health checks útiles.~~ — ✅ Completado (2025-07-22)

### Antes de vender a más de 20 tenants

1. PostgreSQL y Redis administrados.
2. Cola BullMQ operativa para todos los mensajes salientes y llamadas costosas.
3. Workers con asignación exclusiva de tenants.
4. Alertas de costo, desconexión y capacidad.
5. Políticas operativas y soporte definidos.
6. Plan de migración a WhatsApp Cloud API para clientes que lo requieran.

---

## Registro de progreso

### 2025-07-22 — Control de costos IA

**Archivos modificados:**
- `src/lib/db.ts` — Nueva tabla `llm_usage` con campos: `tenant_id`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`, `duration_ms`, `success`, `error_message`, `created_at`. Nuevas funciones: `recordLLMUsage()`, `getLLMBudgetStatus()`. Presupuestos configurables via env vars: `LLM_DAILY_BUDGET_USD` (default $1), `LLM_MONTHLY_BUDGET_USD` (default $25), `LLM_GLOBAL_DAILY_BUDGET_USD` (default $10).
- `src/lib/openrouter.ts` — `generateReply()` ahora retorna `{ response, usage }` con metadata de tokens y costo. Agregado `max_tokens` (default 180, configurable via `LLM_MAX_TOKENS`). Tabla de precios por modelo para estimar costo. Historial reducido de 20 a 15 mensajes.
- `src/lib/baileys/handler.ts` — Verifica presupuesto antes de llamar al LLM. Si se excede, envía mensaje fijo al cliente y no consume IA. Registra cada llamada (éxito o fallo) en `llm_usage`. Log por llamada: `[bot:N] LLM usage: X tokens, $Y USD, Zms`.

**Comportamiento:**
- Cada llamada al LLM se registra con tokens reales y costo estimado.
- Si un tenant excede su presupuesto diario/mensual, el bot responde con mensaje fijo en lugar de llamar al LLM.
- Si la plataforma entera excede el presupuesto global diario, todos los tenants pasan a fallback.
- Los errores de LLM también se registran con `success=0` y el mensaje de error.

### 2025-07-22 — Separación de servicios bot y web

**Archivos modificados/creados:**
- `Dockerfile` — Cambiado CMD de `npm run start:all` a `npm run start` (solo Next.js).
- `Dockerfile.bot` (nuevo) — Imagen ligera que no hace build de Next.js. Corre `npx tsx scripts/start-bot.ts` directamente.
- `docker-compose.yml` — Dos servicios: `web` (chatbot-web, puerto 3000) y `bot` (chatbot-bot). Comparten volúmenes `data/` y `auth/`. El bot arranca primero; la web depende de él via `depends_on`.

**Ventajas:**
- El bot y la web se reinician independientemente.
- Si el bot se cae, el dashboard sigue accesible.
- Si la web se reinicia, las sesiones de WhatsApp no se desconectan.
- Se puede escalar el bot con más instancias en el futuro.
- Logs separados por servicio.

### 2025-07-22 — API de métricas de IA

**Archivos creados:**
- `src/app/api/llm-usage/route.ts` — Endpoint GET `/api/llm-usage` que retorna consumo de tokens, costo y estado de presupuesto por tenant. Requiere autenticación (NextAuth). Super-admin puede consultar cualquier tenant via `?tenantId=N`; usuarios normales solo ven su propio tenant.

**Respuesta del endpoint:**
```json
{
  "tenantId": 1,
  "dailyCostUsd": 0.0023,
  "monthlyCostUsd": 0.015,
  "dailyTokens": 4500,
  "monthlyTokens": 28000,
  "dailyCalls": 12,
  "monthlyCalls": 85,
  "exceeded": false,
  "budgets": {
    "dailyUsd": 1.0,
    "monthlyUsd": 25.0,
    "globalDailyUsd": 10.0
  }
}
```

**Uso:**
- El dashboard puede consumir este endpoint para mostrar consumo en tiempo real.
- Permite al admin del negocio ver cuánto IA está consumiendo.
- Permite al super-admin monitorear todos los tenants.

### 2025-07-22 — Interfaz DBAdapter async

**Archivos modificados:**
- `src/lib/db-adapter.ts` — Todos los métodos de la interfaz `DBAdapter` cambiados de sincrónicos (`T`) a async (`Promise<T>`). Agregados métodos `recordLLMUsage()`, `getLLMBudgetStatus()` y `transactionAsync()` que faltaban en la interfaz original. Removido import no usado `ConnectionStatus`.

**Problema:**
- La interfaz definía métodos sincrónicos pero `PostgreSQLAdapter` los implementaba como async.
- TypeScript no puede reconciliar `Promise<T>` con `T`, causando errores de tipos.
- El build los evadía con `ignoreBuildErrors: true`.

**Solución:**
- La interfaz ahora es completamente async.
- `PostgreSQLAdapter` ya implementa todos los métodos como async → coincide exactamente.
- El adaptador SQLite (`db.ts`) exporta funciones sincrónicas directamente; si en el futuro se usa via la interfaz, se pueden envolver en `Promise.resolve()`.
- Se agregaron los métodos de LLM usage que faltaban en la interfaz original.

### 2025-07-22 — Backups automáticos y health checks

**Archivos creados/modificados:**
- `scripts/backup.ts` (nuevo) — Script de backup de SQLite usando `sqlite3 .backup` (seguro para DB en uso). Crea backups en `data/backups/`, retiene los últimos 14 (configurable via `BACKUP_MAX_FILES`), elimina los más antiguos automáticamente.
- `scripts/start-bot.ts` — Integrado backup al arranque del bot y cada 6 horas (configurable via `BACKUP_INTERVAL_HOURS`). Log: `[backup] Backup creado: messages-<timestamp>.db (139 KB)`.
- `src/app/api/health/route.ts` — Health check mejorado para super-admin: ahora retorna info de DB (tamaño, última modificación), backups (cantidad, último backup), costo global de LLM hoy, y estado de cada tenant (bot activo/inactivo).
- `Dockerfile.bot` — Agregado `sqlite3` al apt-get para que el backup funcione.

**Variables de entorno nuevas:**
```bash
BACKUP_INTERVAL_HOURS=6    # Frecuencia de backups
BACKUP_MAX_FILES=14        # Máximo de backups a retener
```

**Backup verificado:**
- Primer backup creado automáticamente al arrancar el bot: `messages-2026-07-22T20-28-23-749Z.db` (139 KB).
- Ubicación: `data/backups/` (persistido por volumen Docker).

**Health check mejorado:**
- Modo token (UptimeRobot): sigue retornando `{ status: "ok" }` sin info sensible.
- Modo super-admin: retorna DB info, backups, costo LLM global, y estado por tenant.

### 2025-07-22 — System prompt dinámico por tenant

**Problema:**
- El system prompt estaba hardcodeado para Cookliz (repostería, Nequi 3225669765).
- Cada tenant necesita su propio nombre, tipo de negocio, info de pago y saludo.
- Sin esto, no se puede vender a otros negocios.

**Archivos modificados:**
- `src/lib/db.ts` — Agregadas columnas a tabla `tenants`: `business_name`, `business_type`, `payment_info`, `custom_greeting`, `custom_prompt`. Nueva interfaz `TenantConfig` y función `updateTenantConfig()`.
- `src/lib/system-prompt.ts` — Reescrito completamente. Ya no exporta un string hardcodeado. Ahora exporta `buildSystemPromptForTenant(tenantId)` que lee la config del tenant desde la DB y construye el prompt dinámicamente.
- `src/lib/openrouter.ts` — Cambiado import de `SYSTEM_PROMPT` a `buildSystemPromptForTenant`. El prompt ahora se construye por tenant en cada llamada al LLM.
- `src/app/api/tenant/config/route.ts` (nuevo) — Endpoint GET/PUT para leer y guardar la configuración del negocio. Autenticado con `requireAuth`.
- `src/components/ConfigPanel.tsx` (nuevo) — Formulario en el dashboard con campos: nombre del negocio, tipo, saludo, info de pago, instrucciones personalizadas.
- `src/components/ConnectionGate.tsx` — Agregado tab "Configuración" que renderiza `ConfigPanel`.

**Campos configurables por tenant:**
| Campo | Descripción | Default |
|---|---|---|
| `business_name` | Nombre del negocio | Usa `tenant.name` |
| `business_type` | Tipo (repostería, ropa, etc.) | Sin tipo |
| `custom_greeting` | Saludo primer mensaje | "Hola, ¿en qué te puedo ayudar?" |
| `payment_info` | Info de pago (Nequi, efectivo, etc.) | Instrucciones genéricas |
| `custom_prompt` | Instrucciones adicionales | Vacío |

**Flujo:**
1. Admin entra al dashboard → tab "Configuración"
2. Completa los campos → click "Guardar"
3. `PUT /api/tenant/config` guarda en DB
4. En el próximo mensaje del bot, `buildSystemPromptForTenant()` lee la config y genera el prompt personalizado
5. El LLM responde con el tono, nombre e info de pago correctos
