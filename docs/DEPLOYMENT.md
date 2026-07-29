# Despliegue y configuración

## Variables de entorno

Copiá `.env.example` a `.env.local` y completá:

```bash
# OpenRouter (LLM)
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4o-mini

# NextAuth
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_URL=http://localhost:3000

# Multi-tenant: tenant que usa el proceso del bot
BOT_TENANT_ID=2

# Rate limiting
RATE_LIMIT_PER_MINUTE=20
RATE_LIMIT_PER_HOUR=100
RATE_LIMIT_DUPLICATE_THRESHOLD=3
RATE_LIMIT_DUPLICATE_WINDOW_SEC=60

# URL pública de la app (para OpenRouter HTTP-Referer)
APP_URL=https://tu-dominio.com

# Alertas de desconexión (webhook de Discord/Slack, opcional)
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Levantar en local

```bash
npm install
npm run dev          # Next.js en :3000
npm run bot          # Proceso bot (terminal aparte)
```

Al primer arranque del bot, escaneá el QR con WhatsApp Web → Dispositivos vinculados.

## Crear el primer super-admin

Por defecto la app crea un usuario super-admin si no existe ninguno. Si lo necesitás manualmente:

```bash
npm run create-super-admin -- --email tu@correo.com --password TuPass123 --name "Tu Nombre"
```

> Esto setea `is_super_admin = 1` y `tenant_id = NULL` (o el primer tenant disponible).

## Crear nuevos tenants

Solo el **super-admin** puede crear tenants:

1. Login como super-admin.
2. Click en el link **Tenants** del header.
3. Botón "Nuevo tenant" → ingresar nombre.
4. Crear usuarios para ese tenant desde la sección de usuarios (asignándolos al `tenant_id` correspondiente).

## Multi-tenant en producción (varios bots)

Si querés correr **N tenants simultáneos**, necesitás N procesos del bot, cada uno con:

```bash
BOT_TENANT_ID=2 BAILEYS_AUTH_DIR=./auth/tenant-2 npm run bot &
BOT_TENANT_ID=3 BAILEYS_AUTH_DIR=./auth/tenant-3 npm run bot &
```

> Cada proceso necesita su propia carpeta `auth/` con sus credenciales de WhatsApp.

## Despliegue (opciones)

### Docker

```bash
docker compose up -d
```

Ver `docker-compose.yml` y `Dockerfile`.

### VPS (Hetzner / DigitalOcean / Hostinger)

```bash
# En el servidor
git clone <repo> && cd chatbot
npm install --production=false
npm run build
pm2 start npm --name web -- start
pm2 start npm --name bot -- run bot
pm2 save
```

### Nixpacks (Railway / Coolify)

`nixpacks.toml` ya está configurado.

## Backups

La base de datos es un único archivo: `data/bot.db`. Backup recomendado:

```bash
# Cron diario
0 3 * * * sqlite3 /app/data/bot.db ".backup /backups/bot-$(date +\%F).db"
```

## Troubleshooting

| Problema                                        | Causa                                      | Solución                                                 |
| ----------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| QR no carga                                     | `BOT_TENANT_ID` incorrecto o ya hay sesión | Borrá `auth/creds.json` y reiniciá el bot                |
| `UNIQUE constraint failed: conversations.phone` | Esquema viejo                              | Reiniciá el server (las migraciones se aplican solas)    |
| Bot no responde                                 | OpenRouter sin saldo                       | Cargá créditos en https://openrouter.ai/settings/credits |
| Super-admin no ve "Tenants"                     | Falta `is_super_admin = 1`                 | `UPDATE users SET is_super_admin=1 WHERE email='...';`   |
| Mensajes en tenant equivocado                   | `BOT_TENANT_ID` mal seteado                | Ajustar y reiniciar bot                                  |
| QR expira antes de escanear                     | WhatsApp tarda más de 60s                  | Click en "Refrescar QR" en el dashboard                  |
| Bot inicia tenants inactivos                    | Plan cancelled/suspended                   | El bot ahora solo inicia tenants con plan active/trial   |

## Seguridad

- **Headers HTTP**: Se aplican automáticamente desde `next.config.ts` (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- **QR timeout**: El QR expira automáticamente a los 60s y se regenera. Botón "Refrescar QR" disponible en el dashboard.
- **Prompt dinámico**: El bot-service ahora usa `buildSystemPromptForTenant(tenantId)` en lugar de un prompt hardcodeado, igual que la app principal.
- **APP_URL**: Configurar en `.env.local` para que OpenRouter reciba el referer correcto en producción.
- **Anti-spam en registro**: Honeypot oculto + bloqueo de emails desechables (10minutemail, guerrillamail, etc.) + rate limit de 5 registros/hora por IP.
- **Alertas de desconexión**: Configurar `ALERT_WEBHOOK_URL` con un webhook de Discord/Slack para recibir notificaciones cuando un bot se desconecte inesperadamente.
- **Configuración por tenant**: Cada tenant configura su propio catálogo, links, horarios, saludo y mensaje fuera de horario desde el dashboard (Configuración). Los mensajes fijos se envían programáticamente sin usar IA, ahorrando tokens.
- **Delay humanizado**: Todas las respuestas del bot (IA y programáticas) tienen un delay aleatorio de 1-3s para parecer más humanas y evitar detección.
