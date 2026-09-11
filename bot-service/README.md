# ⚠️ bot-service — NO ESTÁ LISTO PARA PRODUCCIÓN

Este directorio es el arranque de una arquitectura futura donde el bot de
WhatsApp corre como proceso independiente del dashboard Next.js, escalable
por tenant. **Hoy no está terminado y no debe desplegarse.**

## Por qué no

- **No comparte base de datos con el dashboard.** Escribe y lee de su
  propia SQLite en `bot-service/data/messages.db`. Aunque
  `docker-compose.prod.yml` le pasa `DATABASE_URL` de Postgres, el código
  nunca la usa (`bot-service/package.json` ni siquiera tiene el driver
  `pg` como dependencia). Resultado: los productos que cargás en el
  dashboard no los ve el bot, y los pedidos que el bot crea no aparecen
  en el dashboard.
- **No valida stock ni calcula precios reales.** `generateReply()` en
  `src/openrouter.ts` no tiene function-calling/tools — confía en que el
  LLM devuelva `order_data.items` correctos. En
  `src/baileys/handler.ts`, si el nombre de producto que dice el LLM no
  matchea ningún producto real, el pedido se crea con `unit_price: 0`.
- **No tiene la máquina de estados de pedido** (entrega → dirección →
  pago → confirmación) ni el cálculo de domicilio por distancia que sí
  tiene `src/lib/` en la raíz del proyecto.

## Qué usar en su lugar

Para producción, usá `docker-compose.yml` (raíz del proyecto) +
`Dockerfile.bot`, que corre `scripts/start-bot.ts` sobre
`src/lib/baileys/` y `src/lib/openrouter.ts`. Esa es la implementación
probada: comparte la misma SQLite que el dashboard (`./data`), valida
stock, calcula precios/domicilio en el backend y tiene rate limiting.
Ver `docs/DEPLOYMENT.md`.

## Si en algún momento se retoma este servicio

Antes de usar `docker-compose.prod.yml` hace falta, como mínimo:

1. Portar acá las tools (`searchProducts`, `addItem`, `setAddress`,
   `confirmOrder`, etc.) y los helpers (`conversation-state.ts`,
   `geo.ts`, `address-resolver.ts`) de `src/lib/`.
2. Conectar `src/db.ts` a Postgres vía `DATABASE_URL` (implementar/reusar
   `db-adapter.ts` + `db-pg.ts` en vez de la SQLite local), para que
   comparta datos con el dashboard.
3. Probar en paralelo contra un tenant de prueba antes de migrar tráfico
   real.
