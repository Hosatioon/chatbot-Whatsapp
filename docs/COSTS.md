# Costos

## Modelo recomendado: `google/gemini-2.0-flash-001`

| Concepto | Valor |
|---|---|
| Input | **$0.10 USD / 1M tokens** |
| Output | **$0.40 USD / 1M tokens** |
| Latencia | ~1s primera respuesta |
| Calidad | Alta — sigue prompts complejos correctamente |

> Precios de referencia OpenRouter (2025). Verificá en https://openrouter.ai/google/gemini-2.0-flash-001

## Comparativa de modelos probados

| Modelo | Input $/1M | Output $/1M | Sigue instrucciones | Notas |
|---|---|---|---|---|
| `inclusionai/ring-2.6-1t:free` | $0 | $0 | ❌ Baja | Gratis pero ignora flujo de orden |
| `google/gemini-2.0-flash-001` ⭐ | $0.10 | $0.40 | ✅ Alta | **Recomendado** |
| `openai/gpt-4o-mini` | $0.15 | $0.60 | ✅ Alta | Más caro, similar calidad |
| `anthropic/claude-3-haiku` | $0.25 | $1.25 | ✅ Muy alta | Mejor naturalidad, 3x más caro |
| `meta-llama/llama-3.1-8b-instruct` | $0.02 | $0.05 | ⚠️ Media | Cheapo, pero más errores |

## Estimación por escenario (con `gemini-2.0-flash-001`)

### Supuestos

- **Conversación típica:** 10 mensajes (5 usuario + 5 bot).
- **Tokens por mensaje del usuario:** ~80 tokens.
- **Tokens del system prompt + inventario:** ~500 tokens (se envían en cada llamada).
- **Tokens por respuesta del bot:** ~120 tokens.
- Por **cliente** se hacen ~5 llamadas al LLM (una por respuesta).

Por cliente:
- Input: `5 llamadas × (500 + ~400 historial) ≈ 4,500 tokens`
- Output: `5 × 120 = 600 tokens`
- Costo: `4,500 × $0.10/1M + 600 × $0.40/1M = $0.00045 + $0.00024 ≈ $0.0007 USD/cliente`

### Escenarios

| Clientes/día | Costo/día | Costo/mes (30d) | COP/mes (≈$4,000) |
|---|---|---|---|
| 10 | $0.007 | $0.21 | ~$840 |
| **50** ⭐ | **$0.035** | **$1.05** | **~$4,200** |
| 100 | $0.07 | $2.10 | ~$8,400 |
| 500 | $0.35 | $10.50 | ~$42,000 |
| 1,000 | $0.70 | $21.00 | ~$84,000 |

> Para tu caso de **50 clientes/día con Cookliz**, el costo del LLM es de aprox **$1 USD/mes** (~$4,000 COP).

## Otros costos del sistema

| Item | Costo |
|---|---|
| Hosting (VPS básico, ej. Hetzner CX11) | ~$5 USD/mes |
| WhatsApp (Baileys, no oficial) | $0 (riesgo: ban del número) |
| Dominio | ~$10 USD/año |
| Base de datos (SQLite local) | $0 |

**Total operativo Cookliz:** ~$6 USD/mes (~$24,000 COP).

## Cómo cargar saldo en OpenRouter

1. Entrá a https://openrouter.ai/settings/credits
2. Cargá un mínimo de **$5 USD** (te dura meses con el volumen actual).
3. Activá **auto-recharge** si querés evitar quedarte sin saldo.
4. La key (`OPENROUTER_API_KEY` en `.env.local`) ya queda asociada al saldo.

## Optimizaciones futuras (si escala)

- **Cache de inventario:** evitar reenviar el catálogo completo en cada llamada.
- **Resumir historial:** después de 20 mensajes, comprimirlo en un resumen de 100 tokens.
- **Modelo más barato para clasificar:** usar `llama-3.1-8b` para detectar intent (saludo, pedido, queja) y solo invocar Gemini cuando sea conversación compleja.
- **Tools/function calling:** dejar que el LLM consulte la BD por nombre en vez de mandarle el inventario completo.
