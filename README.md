# Agente WhatsApp local

Agente de WhatsApp que se conecta a un número real vía
[Baileys](https://github.com/WhiskeySockets/Baileys) (no Meta API, no
Twilio) y responde mensajes con un LLM (OpenRouter). Incluye un
dashboard local en Next.js para ver conversaciones, intervenir
manualmente y togglear cada chat entre modo IA y modo Humano.

Todo corre en localhost. Datos en SQLite, sesión Baileys en `./auth/`.

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

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
```

**Importante:** los modelos `:free` de OpenRouter tienen rate limits
muy estrictos (50 requests/día). En producción real vas a pegar
contra error 429. Recomendado: `openai/gpt-4o-mini` (~$0.15 por
millón de tokens, centavos al mes para uso normal).

## Arrancar en desarrollo

Necesitás dos procesos corriendo en paralelo:

```bash
# Terminal 1 — el bot Baileys
npm run start:bot

# Terminal 2 — el dashboard
npm run dev
```

Después abrí http://localhost:3000:

1. Si no hay sesión guardada, vas a ver una pantalla con el QR.
2. Escaneá el QR desde tu WhatsApp (Configuración → Dispositivos
   vinculados → Vincular un dispositivo).
3. Apenas se conecte, la pantalla pasa al dashboard automáticamente.
4. Cuando alguien te escriba al número vinculado, vas a ver la
   conversación en la lista de la izquierda.

La sesión queda guardada en `./auth/`. Reiniciar el bot **no** vuelve
a pedir QR (mientras la sesión siga viva en WhatsApp).

## Modo IA vs Humano

Cada conversación tiene un toggle arriba del panel derecho:

- **IA** (verde) — el bot responde automáticamente con el LLM usando
  el `SYSTEM_PROMPT` definido en `src/lib/system-prompt.ts`.
- **HUMANO** (ámbar) — el bot **no** responde. Vos podés escribir
  desde el dashboard y el mensaje se manda al cliente firmado como
  "humano".

## Personalizar el system prompt

Editá `src/lib/system-prompt.ts` con el prompt de tu negocio. Tiene
hot-reload en `npm run dev`, pero el bot necesita reiniciarse
(`Ctrl+C` y `npm run start:bot` de nuevo) para tomar el cambio.

## Producción (EasyPanel / Railway / Nixpacks)

1. Subí el repo. El detector va a usar `nixpacks.toml`.
2. Configurá las env vars `OPENROUTER_API_KEY` y `OPENROUTER_MODEL`.
3. **Volúmenes persistentes obligatorios:**
   - `/app/data` — base SQLite con conversaciones.
   - `/app/auth` — sesión de Baileys.
   - Sin estos, cada redespliegue pierde los chats Y obliga a
     re-escanear el QR.
4. El `Procfile` usa `npm run start:all` que levanta bot + Next.js
   en paralelo.

## ⚠️ Seguridad — dashboard sin auth

**El dashboard NO tiene autenticación.** Si lo desplegás a internet,
**poné** basic auth a nivel proxy (Caddy / Nginx / EasyPanel) o
Cloudflare Access **antes** de exponerlo. Si no, cualquiera con la
URL puede leer todas tus conversaciones de WhatsApp y enviar
mensajes haciéndose pasar por el dueño del número.

**Esto es bloqueante para producción.**

## Estructura

```
src/
  app/                 Next.js App Router (UI + API routes)
    api/
      connection/      status (GET) + disconnect (POST)
      conversations/   list (GET) + delete (DELETE)
      messages/        list (GET) + send human (POST)
      mode/            toggle AI/HUMAN (POST)
  components/          UI React (todo client components excepto MessageBubble)
  lib/
    db.ts              SQLite + helpers
    openrouter.ts      cliente OpenRouter (openai SDK + baseURL)
    system-prompt.ts   prompt por defecto del bot
    baileys/
      client.ts        socket Baileys + state machine + reconnect
      handler.ts       mensajes entrantes + outbox loop
scripts/
  env-loader.ts        carga .env.local para el bot (side-effect)
  start-bot.ts         entrypoint del bot
data/                  runtime — SQLite + .restart flag (gitignored)
auth/                  runtime — sesión Baileys (gitignored)
```

## Cómo se comunican los procesos

`bot` y `next` corren en procesos separados. **No comparten
memoria.** Se comunican vía SQLite:

- Mensajes humanos del dashboard → tabla `outbox`. El bot la lee
  cada 2s y envía vía `sock.sendMessage`. Si falla, deja `sent=0`
  y reintenta en el próximo tick.
- Estado de conexión (`qr`, `connecting`, `connected`,
  `disconnected`) → tabla `connection_state` (1 fila). La API web
  lee de ahí; el bot escribe.
- Desconexión manual → flag `data/.restart`. El bot lo poll cada 1s,
  cuando lo encuentra hace logout + borra `auth/` + reinicia.

## Troubleshooting

### El bot tira `code=440` en loop

Es `connectionReplaced`. Causas comunes:

- Browser fingerprint custom (este repo ya usa `Browsers.macOS('Desktop')`).
- Dispositivo viejo conectado de pruebas anteriores. Borralo desde
  el teléfono: WhatsApp → Configuración → Dispositivos vinculados.
- IP del VPS reportada como sospechosa. Esperá 24h o cambiá de IP.

### El bot tira `code=405`

Versión de Baileys vs WhatsApp Web protocol desincronizada. El repo
ya hace `fetchLatestBaileysVersion()` en cada arranque. Si persiste,
actualizá `@whiskeysockets/baileys` a la última y reintentá.

### El bot tira `code=515`

Es **bueno**. Es la señal de pairing exitoso post-QR; el bot
necesita reconectar una sola vez (lo hace solo).

### El LLM responde con error 429

Tu modelo `:free` saturó la cuota (50 req/día sin créditos
cargados). Cambiá a `openai/gpt-4o-mini` en `.env.local`.

### El QR no aparece en el frontend

Verificá que el proceso del bot esté corriendo. La terminal del bot
también imprime el QR ASCII como fallback de debugging.

### Procesos zombies en Windows

`Ctrl+C` no siempre mata los hijos de `tsx` y `concurrently`. Matá
manualmente:

```cmd
tasklist | findstr node
taskkill /F /PID <pid>
```

## Mejoras pendientes (v2)

- Soporte de imágenes salientes (enviar PNG de productos).
- Function calling con `tools` de OpenRouter.
- Auto-toggle a HUMAN cuando el bot detecta una frase específica
  (regex en `handler.ts`).
- WebSocket en lugar de polling (server-sent events o socket.io).
- Auth básica en Next.js (middleware con basic auth).
- Multi-usuario (cada operador con su login).
- Soporte de grupos.
- Recibir/transcribir mensajes de audio.
