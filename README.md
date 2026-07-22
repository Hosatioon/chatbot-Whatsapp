# Agente WhatsApp — Chatbot con IA + Dashboard

Chatbot de WhatsApp completo que se conecta a un número real vía
[Baileys](https://github.com/WhiskeySockets/Baileys) (no Meta API, no
Twilio) y responde mensajes con un LLM (OpenRouter). Incluye un
dashboard local en Next.js para ver conversaciones, intervenir
manualmente, togglear entre modo IA/Humano, y **gestionar productos**
desde una cuadrícula tipo Excel.

**Stack:** Next.js 16 + TypeScript + Tailwind + SQLite + Baileys +
OpenRouter + Docker.

## Features actuales

- **Bot WhatsApp con IA** — Responde automáticamente con un LLM usando
  un `SYSTEM_PROMPT` personalizable.
- **Dashboard web** — Ve conversaciones en tiempo real, envía mensajes
  como humano, cambia modo IA/Humano por chat.
- **Panel de productos** — Cuadrícula editable tipo Excel para agregar,
  editar, eliminar y activar/desactivar productos con precios y stock.
  El catálogo se inyecta automáticamente al LLM en cada conversación.
- **Envío de catálogo** — Al primer mensaje del cliente, el bot envía
  el saludo + un enlace al catálogo configurable (`CATALOG_URL`).
- **Persistencia completa** — SQLite con WAL, sesión Baileys en
  `./auth/`, nada se pierde al reiniciar.
- **Dockerizado** — Levantá todo con un solo comando.
- **Reconexión automática** — El bot se reconecta solo si se cae la
  conexión.
- **Outbox** — Mensajes humanos del dashboard se encolan y se envían
  cuando la conexión está estable.

## Requisitos

- Node.js **20.9+** (recomendado 22 — ver `.nvmrc`).
- Un número de WhatsApp real para vincular.
- API key de [OpenRouter](https://openrouter.ai).

## Instalación

```bash
npm install
cp .env.example .env.local
# editar .env.local con tu API key
```

> El `npm install` tarda ~1 min por la compilación nativa de
> `better-sqlite3`. Si falla, asegurate de tener `python3`, `gcc` y
> `make` disponibles.

## Variables de entorno (`.env.local`)

```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
CATALOG_URL=https://drive.google.com/file/d/.../view
```

| Variable             | Descripción                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | Tu API key de [OpenRouter](https://openrouter.ai)                                                               |
| `OPENROUTER_MODEL`   | Modelo LLM. Recomendado gratuito: `meta-llama/llama-3.3-70b-instruct:free`. En producción: `openai/gpt-4o-mini` |
| `CATALOG_URL`        | Enlace al catálogo (Drive, PDF, etc). Se envía automáticamente después del saludo inicial                       |

**Modelos gratuitos** (`:free`) tienen ~50 requests/día. Para
producción real con 20+ conversaciones diarias, usá modelo de pago
(~$0.15 por millón de tokens, unos pocos USD al mes).

---

## Cómo levantar y bajar

### Levantar (producción)

```bash
npm run build && npm run start:all
```

Levanta el bot + dashboard en paralelo. El dashboard está en
`http://localhost:3000`.

### Bajar

Apretá `Ctrl + C` en la terminal. Si quedó algo corriendo:

```bash
pkill -f "concurrently"; pkill -f "next-server"; pkill -f "start-bot"
```

### Solo el bot (sin dashboard)

```bash
npm run start:bot
```

### Solo el dashboard (sin bot)

```bash
npm run dev    # desarrollo
npm run start  # producción (requiere build previo)
```

---

## Primer uso: conectar WhatsApp

1. Levantá el proyecto con `npm run start:all`
2. Andá a `http://localhost:3000`
3. Si no hay sesión guardada, vas a ver un QR
4. Escaneá el QR desde tu WhatsApp (Configuración → Dispositivos
   vinculados → Vincular un dispositivo)
5. Apenas se conecte, la pantalla pasa al dashboard
6. La sesión queda guardada en `./auth/` — reiniciar no pide QR

---

## Dashboard — Chats

- **Lista izquierda** — Conversaciones activas ordenadas por fecha
- **Panel derecho** — Mensajes de la conversación seleccionada
- **Toggle IA/Humano** — Arriba del chat. En modo HUMANO, el bot no
  responde y vos podés escribir desde el dashboard
- **Borrar chat** — Elimina conversación + mensajes

## Dashboard — Productos

Click en el botón **"Productos"** arriba del dashboard.

- **Agregar** — Click "+ Nuevo producto", completá nombre, precio,
  stock y guardá
- **Editar** — Click "Editar" en cualquier fila
- **Eliminar** — Click "Eliminar" (con confirmación)
- **Activar/Desactivar** — Click en el badge "Activo/Inactivo".
  Solo los activos se muestran al LLM

Los productos activos se inyectan automáticamente al `SYSTEM_PROMPT`
en cada llamada al LLM. El bot siempre responde con precios exactos
y stock real.

## Personalizar el system prompt

Editá `src/lib/system-prompt.ts` con el prompt de tu negocio.
Reiniciá el bot para que tome el cambio:

```bash
Ctrl + C
npm run start:all
```

## Docker

```bash
docker compose up --build
```

Volumenes persistentes ya configurados en `docker-compose.yml` para
`data/` y `auth/`.

## Producción (EasyPanel / Railway / Nixpacks)

1. Subí el repo. El detector usa `nixpacks.toml`.
2. Configurá las env vars (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
   `CATALOG_URL`).
3. **Volúmenes persistentes obligatorios:**
   - `/app/data` — SQLite con conversaciones y productos
   - `/app/auth` — sesión de Baileys
4. El `Procfile` usa `npm run start:all`.

## ⚠️ Seguridad — dashboard sin auth

**El dashboard NO tiene autenticación.** Si lo desplegás a internet,
poné basic auth a nivel proxy (Caddy / Nginx / EasyPanel) o
Cloudflare Access **antes** de exponerlo. Esto es bloqueante para
producción.

## Estructura

```
src/
  app/                 Next.js App Router (UI + API routes)
    api/
      connection/      status (GET) + disconnect (POST)
      conversations/   list (GET) + delete (DELETE)
      messages/        list (GET) + send human (POST)
      mode/            toggle AI/HUMAN (POST)
      products/        CRUD productos (GET/POST/PUT/PATCH/DELETE)
  components/          UI React
    ConnectionGate.tsx   Navegación Chats / Productos
    ConversationList.tsx Lista de conversaciones
    ConversationPanel.tsx Chat individual
    ProductsPanel.tsx    Cuadrícula editable de productos
    DashboardHeader.tsx  Header con info de conexión
    QRScreen.tsx         Pantalla de QR para vincular
  lib/
    db.ts              SQLite + helpers (conversaciones, mensajes,
                       outbox, productos, estado de conexión)
    openrouter.ts      Cliente OpenRouter. Inyecta catálogo dinámico
                       al system prompt antes de cada llamada
    system-prompt.ts   Prompt base del bot (personalizable)
    baileys/
      client.ts        Socket Baileys + reconexión automática
      handler.ts       Mensajes entrantes + outbox loop + envío
                       automático de catálogo en primer mensaje
scripts/
  env-loader.ts        Carga .env.local para el bot
  start-bot.ts         Entrypoint del bot
data/                  SQLite (gitignored)
auth/                  Sesión Baileys (gitignored)
```

## Cómo se comunican los procesos

`bot` y `next` corren en procesos separados. **No comparten
memoria.** Se comunican vía SQLite:

- **Mensajes humanos del dashboard** → tabla `outbox`. El bot la lee
  cada 2s y envía vía `sock.sendMessage`. Si falla, deja `sent=0`
  y reintenta en el próximo tick.
- **Estado de conexión** (`qr`, `connecting`, `connected`,
  `disconnected`) → tabla `connection_state` (1 fila). La API web
  lee de ahí; el bot escribe.
- **Productos** → tabla `products`. El dashboard lee/escribe. El bot
  lee los activos para inyectarlos al system prompt del LLM.
- **Desconexión manual** → flag `data/.restart`. El bot lo poll cada
  1s, cuando lo encuentra hace logout + borra `auth/` + reinicia.

## Troubleshooting

### Sesión perdida (code=401)

El bot perdió la sesión de WhatsApp. Borrá `auth/` y reescaneá el QR:

```bash
rm -rf auth/*
```

### Bot tira `code=440` en loop

Es `connectionReplaced`. Borrá el dispositivo viejo desde el celular:
WhatsApp → Configuración → Dispositivos vinculados → Desvincular.

### Bot tira `code=405`

Versión de Baileys desactualizada. El repo ya hace
`fetchLatestBaileysVersion()` en cada arranque. Si persiste,
actualizá `@whiskeysockets/baileys`.

### Bot tira `code=515`

Es **bueno**. Señal de pairing exitoso post-QR. El bot se reconecta
solo.

### LLM devuelve 404 "model no longer available"

El modelo gratuito cambió a pago. Cambiá el modelo en `.env.local`.
Modelos gratuitos actuales: `meta-llama/llama-3.3-70b-instruct:free`,
`google/gemma-2-9b-it:free`.

### LLM devuelve 429

Saturaste la cuota del modelo `:free` (~50 requests/día). Cambiá a
modelo de pago o esperá al día siguiente.

### QR no aparece

Verificá que el proceso del bot esté corriendo. La terminal del bot
también imprime el QR ASCII como fallback.

### Procesos zombies (Linux/macOS)

```bash
pkill -f "concurrently"; pkill -f "next-server"; pkill -f "start-bot"
```

### Procesos zombies (Windows)

```cmd
tasklist | findstr node
taskkill /F /PID <pid>
```

## Precios estimados para vender (mercado Colombia)

Este proyecto ya es un **MVP completo** listo para producción.

| Concepto                                                             | Valor                        |
| -------------------------------------------------------------------- | ---------------------------- |
| **Setup inicial** (instalación + configuración + prompt + productos) | $800k – $1.2M COP            |
| **Mensualidad** (hosting + mantenimiento + ajustes)                  | $150k – $250k COP/mes        |
| **Costo LLM gratis** (modelo `:free`)                                | $0 (límite ~50 requests/día) |
| **Costo LLM pago** (producción real, ~50 conversaciones/día)         | ~$9 USD/mes (~$36k COP)      |

**Recomendación:** Vendelo con modelo gratuito inicialmente. Cuando
el cliente crezca, ofrecé upgrade a modelo de pago (+$30k COP/mes
de tu margen).

---

## Comandos útiles

```bash
# Levantar todo
npm run start:all

# Solo bot
npm run start:bot

# Solo web (dev)
npm run dev

# Solo web (prod, requiere build)
npm run start

# Build
npm run build

# Bajar todo
pkill -f "concurrently"; pkill -f "next-server"; pkill -f "start-bot"

# Limpiar sesión WhatsApp (re-escanear QR)
rm -rf auth/*

# Limpiar mensajes pendientes en outbox
sqlite3 data/messages.db "DELETE FROM outbox WHERE sent = 0;"

# Ver productos en la base de datos
sqlite3 data/messages.db "SELECT * FROM products;"

# Ver conversaciones
sqlite3 data/messages.db "SELECT * FROM conversations;"

# Ver últimos mensajes
sqlite3 data/messages.db "SELECT * FROM messages ORDER BY created_at DESC LIMIT 10;"
```

---

## Mejoras pendientes (v2)

- Soporte de imágenes (enviar fotos de productos).
- Function calling con `tools` de OpenRouter (confirmar pedido,
  calcular total, etc).
- Auto-toggle a HUMAN cuando el bot detecta frases específicas.
- WebSocket / Server-Sent Events en lugar de polling cada 2s.
- Auth en el dashboard (login básico o OAuth).
- Multi-usuario (varios operadores con sus credenciales).
- Soporte de grupos de WhatsApp.
- Transcripción de mensajes de audio.
- Webhooks (notificar pedidos nuevos a un sistema externo).
- Multi-tenant (un solo bot para múltiples negocios).
