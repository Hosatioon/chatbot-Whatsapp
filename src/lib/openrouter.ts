import OpenAI from "openai";
import {
  buildSystemPromptForTenant,
  buildOrderSummaryForCustomer,
} from "./system-prompt";
import {
  getTopProducts,
  searchProducts,
  getProductByName,
  getProductStock,
  getTenantById,
  getLastOrderByPhone,
  createOrder,
  type Message,
} from "./db";
import {
  type ConversationState,
  type DraftItem,
  saveState,
  addToDraft,
  computeDraftTotal,
  computeStateFromDraft,
} from "./conversation-state";
import {
  extractLatLngFromUrl,
  geocodeAddress,
  calculateDistance,
  calculateDeliveryPrice,
  reverseGeocode,
} from "./geo";
import {
  resolveDeliveryAddress,
  learnPlaceFromConfirmation,
  extractDetails,
} from "./address-resolver";
import { upsertCustomerAddress } from "./db";

// IMPORTANTE: este módulo lee process.env en top-level. En el proceso del
// bot necesita que `scripts/env-loader.ts` ya haya corrido antes (se importa
// como primer side-effect en `scripts/start-bot.ts`). En Next.js las env
// vars de `.env.local` ya están cargadas automáticamente.

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

if (!apiKey) {
  console.warn(
    "[openrouter] OPENROUTER_API_KEY no está definida. Las llamadas al LLM van a fallar.",
  );
}

const client = new OpenAI({
  apiKey: apiKey ?? "missing",
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": "OrdiFast",
  },
});

/**
 * Mapea los mensajes del historial al formato que espera el LLM.
 * - 'user' → 'user'
 * - 'assistant' → 'assistant'
 * - 'human' (mensaje enviado a mano desde el dashboard) → 'assistant',
 *   porque para el cliente final salió "del lado del bot".
 */
function mapHistory(
  history: Message[],
): { role: "user" | "assistant"; content: string }[] {
  return history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

function buildSystemPrompt(
  tenantId: number,
  conversationState?: ConversationState,
): string {
  const basePrompt = buildSystemPromptForTenant(tenantId, conversationState);
  // Inyectar solo top 10 productos como referencia rápida
  const top = getTopProducts(tenantId, 10);
  let catalog = "";
  if (top.length > 0) {
    catalog = "\n\n--- PRODUCTOS PRINCIPALES (solo nombres) ---\n";
    for (const p of top) {
      catalog += `- ${p.name}\n`;
    }
    catalog +=
      "\nEsta lista es PARCIAL. Para precios y stock, usá searchProducts o getStock.\n";
  }
  return basePrompt + catalog;
}

// Interfaz para respuesta estructurada del LLM
export interface LLMResponse {
  intent: "chat" | "create_order";
  reply: string;
  order_data?: {
    items: Array<{
      name: string;
      quantity: number;
    }>;
    notes?: string;
  };
}

export interface LLMUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "600", 10);

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
  "deepseek/deepseek-v3.2": { input: 0.21, output: 0.31 },
  "deepseek/deepseek-chat": { input: 0.28, output: 0.42 },
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
  "google/gemma-2-9b-it:free": { input: 0, output: 0 },
};

const UNKNOWN_MODEL_PRICING = {
  input: parseFloat(
    process.env.LLM_UNKNOWN_MODEL_INPUT_PRICE_USD_PER_MILLION || "1",
  ),
  output: parseFloat(
    process.env.LLM_UNKNOWN_MODEL_OUTPUT_PRICE_USD_PER_MILLION || "4",
  ),
};

function estimateCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = MODEL_PRICING[modelName];
  if (!pricing) {
    console.warn(
      `[openrouter] Modelo sin tarifa conocida: ${modelName}. Usando tarifa conservadora de respaldo.`,
    );
  }
  const effectivePricing = pricing ?? UNKNOWN_MODEL_PRICING;
  return (
    (promptTokens / 1_000_000) * effectivePricing.input +
    (completionTokens / 1_000_000) * effectivePricing.output
  );
}

export interface GenerateReplyContext {
  customerPhone?: string;
  customerName?: string | null;
  conversationState?: ConversationState;
  conversationId?: number;
  tenantId?: number;
  lastCustomerMessage?: string;
}

interface ToolResult {
  result: string;
  orderConfirmed?: boolean;
  orderId?: number;
}

/**
 * Limpia la respuesta del LLM para que sea JSON parseable:
 * - Quita bloques de markdown ```json ... ```
 * - Corrige llaves dobles {{ }} → { } (el LLM copia el formato viejo del prompt o del historial)
 * - Extrae solo el objeto JSON si viene con texto extra
 */
function sanitizeJsonReply(raw: string): string {
  let s = raw.trim();

  // Quitar fences de markdown
  s = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // Extraer el primer objeto JSON balanceado si hay texto extra
  const start = s.indexOf("{");
  if (start > 0) s = s.slice(start);

  // Corregir llaves dobles (formato viejo del prompt / historial contaminado)
  if (s.startsWith("{{")) {
    s = s.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
  }

  return s;
}

export async function generateReply(
  history: Message[],
  tenantId: number,
  ctx?: GenerateReplyContext,
): Promise<{
  response: LLMResponse;
  usage: LLMUsage;
  orderConfirmed: boolean;
  confirmedOrderId?: number;
}> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(tenantId, ctx?.conversationState),
    },
    {
      role: "system",
      content:
        "RECORDATORIO: Tu respuesta DEBE ser un JSON válido con los campos intent, reply y (opcionalmente) order_data. No respondas texto plano.",
    },
    ...mapHistory(history),
  ];

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "searchProducts",
        description:
          "Buscar productos por nombre o descripción. Usar cuando el cliente pregunte por productos específicos o categorías.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Término de búsqueda tal como lo mencionó el cliente (nombre, sabor, categoría, etc.)",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProduct",
        description:
          "Obtener detalle de un producto por nombre (precio, stock, descripción).",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nombre del producto" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getStock",
        description: "Consultar stock disponible de un producto.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nombre del producto" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getBusinessInfo",
        description:
          "Obtener información del negocio: horarios, dirección, métodos de pago, links.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "getOrderStatus",
        description:
          "Consultar el estado del último pedido del cliente. Úsala cuando el cliente pregunte por su pedido.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "addItem",
        description:
          "Agregar un producto al pedido. Busca el producto en la BD por nombre y lo agrega con la cantidad. Úsala cuando el cliente pida productos.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Nombre del producto tal como lo dijo el cliente (ej: 'camiseta talla M', 'pizza hawaiana')",
            },
            quantity: {
              type: "number",
              description: "Cantidad a agregar (default 1)",
            },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "removeItem",
        description:
          "Quitar un producto del pedido por nombre. Úsala cuando el cliente quiera quitar o corregir un item.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Nombre del producto a quitar",
            },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "setDeliveryMethod",
        description:
          "Establecer método de entrega: 'domicilio' o 'recoger'. Úsala cuando el cliente indique cómo quiere recibir el pedido.",
        parameters: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["domicilio", "recoger"],
              description: "Método de entrega",
            },
          },
          required: ["method"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "setAddress",
        description:
          "Guardar la dirección de entrega del cliente. Acepta texto (dirección) o un link de Google Maps (ubicación GPS). Calcula automáticamente la distancia y el precio del domicilio. Úsala cuando el cliente dé su dirección o ubicación.",
        parameters: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description:
                "Dirección completa (ej: 'calle 8 #31-177, Dosquebradas') o link de Google Maps (ej: 'https://maps.google.com/?q=4.8,-75.7')",
            },
          },
          required: ["address"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "setPayment",
        description:
          "Establecer método de pago: 'transferencia' o 'efectivo'. Úsala cuando el cliente indique cómo va a pagar.",
        parameters: {
          type: "object",
          properties: {
            method: {
              type: "string",
              enum: ["transferencia", "efectivo"],
              description: "Método de pago",
            },
          },
          required: ["method"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "confirmOrder",
        description:
          "Confirmar y crear el pedido. Solo úsala cuando el cliente confirme explícitamente (sí, dale, confirmo, etc.) Y el pedido tenga items, entrega y pago completos. Retorna el ID del pedido y el total.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "getOrderDraft",
        description:
          "Obtener el estado actual del pedido (items, entrega, dirección, pago, total). Úsala cuando necesites saber qué tiene el cliente en su pedido.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  // OpenRouter devuelve el costo REAL ya facturado (incluye descuento por
  // tokens en caché) en `usage.cost` de cada respuesta — no está tipado en
  // el SDK de OpenAI porque es una extensión propia de OpenRouter. Sumamos
  // ese valor real en vez de calcular un estimado propio con una tabla de
  // precios fija (que no sabe nada de caché y queda desalineada del costo
  // real facturado, como se vio comparando contra el saldo real de la cuenta).
  let totalRealCostUsd = 0;
  const t0 = Date.now();

  // Primera llamada SIN response_format json_object para que el modelo pueda
  // hacer tool calls. Cuando se fuerza json_object, gpt-4o-mini ignora los
  // tools y responde directamente sin verificar productos/stock.
  let completion = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.7,
    max_tokens: MAX_TOKENS,
  });

  console.log(
    `[openrouter] LLM response: tool_calls=${completion.choices[0]?.message?.tool_calls?.length ?? 0}, content_len=${completion.choices[0]?.message?.content?.length ?? 0}`,
  );

  totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
  totalCompletionTokens += completion.usage?.completion_tokens ?? 0;
  totalRealCostUsd +=
    (completion.usage as { cost?: number } | undefined)?.cost ?? 0;

  // Manejar tool calls (hasta 3 rondas)
  let orderConfirmed = false;
  let confirmedOrderId: number | undefined;
  let confirmedTotal: number | undefined;
  let confirmedPayment: string | undefined;
  let confirmedItems: string[] | undefined;
  let paymentSummary: string | undefined;
  // BUG real encontrado (2026-09-11): cuando una dirección ya estaba
  // guardada de un pedido anterior (confirmed), la instrucción que le
  // pasábamos al LLM decía POR QUÉ no hacía falta confirmarla ("ya la
  // tenemos registrada de un pedido anterior...") — y el LLM a veces
  // repetía esa explicación casi textual al cliente, sonando raro/robótico.
  // Ahora, cuando esto pasa, forzamos la respuesta directo en vez de
  // confiar en que el LLM redacte bien la instrucción.
  let addressAutoConfirmedNoExplain = false;
  // Respuesta ya redactada por el backend cuando setAddress devuelve
  // varias opciones (con link de mapa por cada una) — se manda tal cual,
  // no se deja que el LLM la reescriba y arriesgue perder un link.
  let ambiguousAddressReply: string | undefined;
  for (let round = 0; round < 3; round++) {
    const msg = completion.choices[0]?.message;
    if (!msg?.tool_calls || msg.tool_calls.length === 0) break;

    // Agregar el mensaje del assistant con tool_calls al historial
    messages.push(msg);

    // BUG real (2026-09-10): cuando el cliente señala que falta algo en el
    // resumen (ej: "¿y el waffle?"), a veces el modelo no llama addItem
    // solo para lo que falta — re-declara TODO el pedido en la misma tanda
    // (addItem de productos que YA estaban + setPayment/setAddress/
    // setDeliveryMethod redundantes), duplicando cantidades que ya estaban
    // en el carrito (3 → 6). La señal es clara: addItem de un producto que
    // ya está en el draft, en la MISMA tanda que tools de "cerrar pedido"
    // que no tendrían por qué llamarse si solo se está agregando un item
    // nuevo. En ese caso tratamos el addItem como no-op en vez de sumar.
    const draftBeforeRound = new Map<string, number>();
    if (ctx?.conversationState) {
      for (const it of ctx.conversationState.draft_items) {
        draftBeforeRound.set(it.name.toLowerCase(), it.quantity);
      }
    }
    const CLOSING_TOOLS = new Set([
      "setPayment",
      "setAddress",
      "setDeliveryMethod",
      "confirmOrder",
    ]);
    const hasClosingToolInBatch = msg.tool_calls.some((tc) =>
      CLOSING_TOOLS.has(tc.function.name),
    );

    // Ejecutar cada tool call
    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = {};
      }

      if (fnName === "addItem" && hasClosingToolInBatch && ctx?.conversationState) {
        const requestedName = String(args.name ?? "").toLowerCase();
        const existingEntry = [...draftBeforeRound.entries()].find(
          ([name]) =>
            name.length > 0 &&
            requestedName.length > 0 &&
            (name.includes(requestedName) || requestedName.includes(name)),
        );
        if (existingEntry && existingEntry[1] > 0) {
          console.warn(
            `[openrouter] addItem sospechoso de re-declaración: "${args.name}" ya tenía ${existingEntry[1]} en el carrito y esta tanda incluye tools de cierre — no se suma de nuevo.`,
          );
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: true,
              note: `Ese producto ya estaba en el pedido, no se modificó la cantidad. Si el cliente pidió MÁS unidades de verdad, confirmá la cantidad exacta y volvé a intentar.`,
              draft_items: ctx.conversationState.draft_items.map(
                (i) => `${i.quantity}x ${i.name}`,
              ),
            }),
          });
          continue;
        }
      }

      let toolResult: ToolResult;
      try {
        toolResult = await executeTool(fnName, args, tenantId, ctx);
        console.log(
          `[openrouter] tool ${fnName}(${JSON.stringify(args)}) → ${toolResult.result.slice(0, 200)}`,
        );
        if (toolResult.orderConfirmed) {
          orderConfirmed = true;
          confirmedOrderId = toolResult.orderId;
          try {
            const parsed = JSON.parse(toolResult.result);
            confirmedTotal = parsed.total;
            confirmedPayment = parsed.payment;
            confirmedItems = parsed.items;
          } catch {
            // ignorar
          }
        }
        if (fnName === "setPayment") {
          try {
            const parsed = JSON.parse(toolResult.result);
            if (parsed.success && parsed.summary) {
              paymentSummary = parsed.summary;
            }
          } catch {
            // ignorar
          }
        }
        if (fnName === "setAddress") {
          try {
            const parsed = JSON.parse(toolResult.result);
            if (parsed.success && parsed.skip_confirmation) {
              addressAutoConfirmedNoExplain = true;
            }
            if (parsed.ambiguous && parsed.deterministic_reply) {
              ambiguousAddressReply = parsed.deterministic_reply;
            }
          } catch {
            // ignorar
          }
        }
      } catch (err) {
        toolResult = {
          result: JSON.stringify({ error: (err as Error).message }),
        };
        console.error(`[openrouter] tool ${fnName} error:`, err);
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult.result,
      });
    }

    // Llamada con resultados de tools — aquí sí forzamos JSON porque
    // ya no necesitamos más tool calls en la respuesta final.
    completion = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    });

    totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
    totalCompletionTokens += completion.usage?.completion_tokens ?? 0;
    totalRealCostUsd +=
      (completion.usage as { cost?: number } | undefined)?.cost ?? 0;
  }

  // Si el LLM no hizo tool calls y su respuesta no es JSON válido, reintentar.
  //
  // Mensajes largos/compuestos (ej: "dame 2 galletas para el estadio yo
  // salgo y las recojo" — productos + ubicación + método de entrega en una
  // sola frase) a veces confunden a gpt-4o-mini y responde texto libre sin
  // llamar ninguna tool, ignorando el pedido. Cae directo al fallback con
  // response_format:json_object SIN tools (gpt-4o-mini las ignora cuando se
  // fuerza json_object — ver nota arriba) — el pedido se pierde sin más y el
  // bot solo reenvía el catálogo, obligando al cliente a repetirse.
  //
  // BUG real encontrado (2026-09-10): un primer intento de "reintentar con
  // tools" sin restricciones causó que, en un turno donde el cliente ya
  // tenía items en el carrito, el modelo releyera el historial y volviera a
  // llamar addItem por productos que YA estaban anotados (4 → 8 galletas), y
  // hasta se saltara directo a preguntar el pago sin entrega/dirección. Por
  // eso este reintento ahora es mucho más angosto:
  //   1. Solo se intenta si el carrito está VACÍO (el caso real que motivó
  //      el fix: primer pedido perdido). Si ya hay items, no arriesgamos
  //      duplicarlos — vamos directo al fallback seguro sin tools.
  //   2. Solo se le da acceso a tools de PRODUCTOS (addItem, removeItem,
  //      búsqueda). Nunca a setDeliveryMethod/setAddress/setPayment/
  //      confirmOrder — esas solo las debe llamar el flujo principal.
  const rawContent = completion.choices[0]?.message?.content?.trim();
  const hadToolCalls =
    (completion.choices[0]?.message?.tool_calls?.length ?? 0) > 0;
  const cartWasEmptyBeforeRetry =
    (ctx?.conversationState?.draft_items.length ?? 0) === 0;
  const SAFE_RETRY_TOOL_NAMES = new Set([
    "searchProducts",
    "getProduct",
    "getStock",
    "addItem",
    "removeItem",
    "getBusinessInfo",
    "getOrderDraft",
  ]);
  const safeRetryTools = tools.filter((t) =>
    SAFE_RETRY_TOOL_NAMES.has(t.function.name),
  );
  if (!hadToolCalls && rawContent) {
    try {
      JSON.parse(sanitizeJsonReply(rawContent));
    } catch {
      let retryMsg: typeof completion.choices[0]["message"] | undefined;
      if (cartWasEmptyBeforeRetry) {
        console.log(
          "[openrouter] Respuesta no-JSON detectada, reintentando con tools (carrito vacío, seguro)",
        );
        messages.push(completion.choices[0]!.message);
        messages.push({
          role: "system",
          content:
            "Tu respuesta anterior no fue JSON válido. Mirá SOLO el último mensaje del cliente en el historial — " +
            "NO repitas acciones de mensajes anteriores. Si ESE último mensaje menciona productos, llamá a addItem " +
            "por cada uno. Si no hay productos que agregar, respondé solo con el JSON {intent, reply}.",
        });
        completion = await client.chat.completions.create({
          model,
          messages,
          tools: safeRetryTools,
          tool_choice: "auto",
          temperature: 0.7,
          max_tokens: MAX_TOKENS,
        });
        totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
        totalCompletionTokens += completion.usage?.completion_tokens ?? 0;
        totalRealCostUsd +=
          (completion.usage as { cost?: number } | undefined)?.cost ?? 0;
        retryMsg = completion.choices[0]?.message;
      } else {
        console.log(
          "[openrouter] Respuesta no-JSON detectada con carrito no vacío — no arriesgamos reintento con tools, directo al fallback sin tools",
        );
      }

      // Si el reintento (solo corre con carrito vacío) sí llamó tools de
      // producto, ejecutarlas — una sola ronda extra, no queremos loops.
      if (retryMsg?.tool_calls && retryMsg.tool_calls.length > 0) {
        messages.push(retryMsg);
        for (const toolCall of retryMsg.tool_calls) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(toolCall.function.arguments || "{}");
          } catch {
            args = {};
          }
          let toolResult: ToolResult;
          try {
            toolResult = await executeTool(
              toolCall.function.name,
              args,
              tenantId,
              ctx,
            );
            console.log(
              `[openrouter] tool (retry) ${toolCall.function.name}(${JSON.stringify(args)}) → ${toolResult.result.slice(0, 200)}`,
            );
            // Mismo registro que el loop principal: si esta ronda extra
            // llegó a confirmar el pedido o fijar el pago, no perder ese
            // estado (si no, el texto determinístico de abajo no se arma).
            if (toolResult.orderConfirmed) {
              orderConfirmed = true;
              confirmedOrderId = toolResult.orderId;
              try {
                const p = JSON.parse(toolResult.result);
                confirmedTotal = p.total;
                confirmedPayment = p.payment;
                confirmedItems = p.items;
              } catch {
                // ignorar
              }
            }
            if (toolCall.function.name === "setPayment") {
              try {
                const p = JSON.parse(toolResult.result);
                if (p.success && p.summary) paymentSummary = p.summary;
              } catch {
                // ignorar
              }
            }
          } catch (err) {
            toolResult = {
              result: JSON.stringify({ error: (err as Error).message }),
            };
          }
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult.result,
          });
        }
        completion = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: MAX_TOKENS,
          response_format: { type: "json_object" },
        });
        totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
        totalCompletionTokens += completion.usage?.completion_tokens ?? 0;
        totalRealCostUsd +=
          (completion.usage as { cost?: number } | undefined)?.cost ?? 0;
      } else {
        // Seguía sin llamar tools ni dar JSON válido: último recurso,
        // forzar json_object sin tools para garantizar una respuesta usable.
        const stillRaw = completion.choices[0]?.message?.content?.trim();
        let stillInvalid = true;
        if (stillRaw) {
          try {
            JSON.parse(sanitizeJsonReply(stillRaw));
            stillInvalid = false;
          } catch {
            /* sigue inválido */
          }
        }
        if (stillInvalid) {
          console.log(
            "[openrouter] Segundo intento también sin tools/JSON válido, forzando json_object",
          );
          messages.push(
            retryMsg ?? { role: "assistant", content: stillRaw ?? "" },
          );
          completion = await client.chat.completions.create({
            model,
            messages,
            temperature: 0.7,
            max_tokens: MAX_TOKENS,
            response_format: { type: "json_object" },
          });
          totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
          totalCompletionTokens += completion.usage?.completion_tokens ?? 0;
          totalRealCostUsd +=
            (completion.usage as { cost?: number } | undefined)?.cost ?? 0;
        }
      }
    }
  }

  const durationMs = Date.now() - t0;
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  // Preferir el costo real que OpenRouter ya devuelve (incluye descuento por
  // caché). Solo si por algún motivo no vino en la respuesta (proveedor que
  // no lo soporte, etc.) caemos al estimado de respaldo con la tabla fija.
  const costUsd =
    totalRealCostUsd > 0
      ? totalRealCostUsd
      : estimateCost(model, totalPromptTokens, totalCompletionTokens);

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("LLM devolvió respuesta vacía");
  }

  let parsed: LLMResponse;
  try {
    const cleaned = sanitizeJsonReply(reply);
    parsed = JSON.parse(cleaned) as LLMResponse;

    if (!parsed.intent || !parsed.reply) {
      throw new Error("Respuesta JSON inválida: falta intent o reply");
    }

    if (
      parsed.intent === "create_order" &&
      (!parsed.order_data?.items || parsed.order_data.items.length === 0)
    ) {
      throw new Error("Respuesta JSON inválida: create_order requiere items");
    }
  } catch (error) {
    console.error("Error parsing LLM JSON response:", error);
    console.error("Raw response:", reply);

    // Último recurso: extraer el campo "reply" con regex para no mandar
    // el JSON crudo al cliente
    const replyMatch = reply.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    parsed = {
      intent: "chat",
      reply: replyMatch
        ? replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')
        : reply,
    };
  }

  // Overrides determinísticos: el resumen y la confirmación no dependen de
  // que el LLM copie texto — se arman en el backend con los datos reales.
  if (orderConfirmed && confirmedOrderId) {
    const tenant = getTenantById(tenantId);
    const lines = ["¡Pedido confirmado! 🎉", ""];
    if (confirmedItems && confirmedItems.length > 0) {
      for (const item of confirmedItems) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }
    lines.push(`Total: $${(confirmedTotal ?? 0).toLocaleString("es-CO")}`);
    if (confirmedPayment === "transferencia" && tenant?.payment_info) {
      lines.push("", `Datos para transferencia: ${tenant.payment_info}`);
      lines.push("Mándenos el comprobante cuando transfiera.");
    }
    lines.push("", "¡Gracias por su compra! 😊");
    parsed.reply = lines.join("\n");
  } else if (paymentSummary) {
    // setPayment se ejecutó: el resumen sale EXACTO del backend, una sola vez
    parsed.reply = `${paymentSummary}\n\n¿Confirma el pedido?`;
  } else if (ambiguousAddressReply) {
    // setAddress devolvió varias opciones con link de mapa cada una — se
    // manda el texto armado en el backend tal cual, para no arriesgar que
    // el LLM al redactarlo de nuevo pierda o transcriba mal algún link.
    parsed.reply = ambiguousAddressReply;
  } else if (addressAutoConfirmedNoExplain) {
    // BUG real encontrado (2026-09-11): cuando la dirección ya estaba
    // guardada de un pedido anterior, el LLM a veces le explicaba al
    // cliente "ya tenemos esa dirección registrada de un pedido
    // anterior..." — sonaba raro/robótico y dejaba al cliente confundido.
    // Forzamos la respuesta acá en vez de confiar en que el LLM redacte
    // bien la instrucción de "no lo menciones, solo seguí".
    parsed.reply = "¿Transferencia o efectivo?";
  } else if (
    ctx?.conversationState &&
    ctx.conversationState.draft_items.length > 0 &&
    !ctx.conversationState.draft_delivery_method
  ) {
    // SAFETY NET: falta el método de entrega. Caso real que motivó esto:
    // el cliente escribió "Asi esta bien para domiclio por favor" (con
    // errata: "domiclio") en el mismo mensaje que confirmaba que no quería
    // agregar más productos. Esa respuesta del LLM no vino en JSON válido
    // (ver "Respuesta no-JSON detectada con carrito no vacío" más arriba),
    // así que se fue directo al fallback sin tools — y ese fallback nunca
    // llamó setDeliveryMethod, ignorando por completo lo que el cliente
    // ya había dicho y preguntando de nuevo "¿domicilio o recoge?".
    //
    // Igual que con el pago: revisamos el ÚLTIMO mensaje del cliente (no
    // el texto que redactó el bot) buscando si ya lo dijo, aunque haya
    // sido de pasada o con errata, y lo ejecutamos directamente en vez de
    // volver a preguntar algo que ya contestó.
    const customerMsg = (ctx.lastCustomerMessage ?? "").toLowerCase();
    const wantsDomicilio =
      customerMsg.includes("domicilio") ||
      customerMsg.includes("domi") || // tolera errata "domiclio"
      customerMsg.includes("envien") ||
      customerMsg.includes("envíen") ||
      customerMsg.includes("me lo traen") ||
      customerMsg.includes("me lo llevan");
    const wantsRecoger =
      customerMsg.includes("recoger") ||
      customerMsg.includes("recojo") ||
      customerMsg.includes("recojer") || // errata común
      customerMsg.includes("paso por") ||
      customerMsg.includes("voy por") ||
      customerMsg.includes("recogida") ||
      customerMsg.includes("en tienda");
    const r = parsed.reply.toLowerCase();
    const isAlreadyAskingMethod =
      r.includes("domicilio o lo recoge") ||
      r.includes("domicilio o recoge") ||
      r.includes("recoge en tienda");

    if ((wantsDomicilio || wantsRecoger) && !isAlreadyAskingMethod) {
      const method = wantsDomicilio ? "domicilio" : "recoger";
      console.warn(
        `[openrouter] Safety net: cliente ya indicó método de entrega sin setDeliveryMethod — ejecutando setDeliveryMethod(${method})`,
      );
      const methodResult = await executeTool(
        "setDeliveryMethod",
        { method },
        tenantId,
        ctx,
      );
      try {
        const parsedResult = JSON.parse(methodResult.result);
        if (parsedResult.success) {
          parsed.reply =
            method === "recoger"
              ? "¿Transferencia o efectivo?"
              : "¿Me compartes tu ubicación por WhatsApp? (📎 → Ubicación). Si no puedes, también me sirve la dirección escrita";
        }
      } catch {
        // si falla, dejar la respuesta del LLM tal cual
      }
    }
    // Si no mencionó nada, dejamos que el LLM siga preguntando normalmente
    // (no forzamos texto acá porque no hay un "catch-all" seguro: a
    // diferencia del pago, el mensaje genérico de esta etapa ya suele
    // venir bien redactado del LLM cuando sí corre con tools).
  } else if (
    ctx?.conversationState &&
    ctx.conversationState.draft_items.length > 0 &&
    ctx.conversationState.draft_delivery_method &&
    !ctx.conversationState.draft_payment
  ) {
    // El LLM generó un resumen prematuro sin tener el pago.
    // Detectar si el CLIENTE (no el bot) ya mencionó un método de pago
    // y ejecutar setPayment automáticamente.
    //
    // BUG histórico: esto comparaba contra `parsed.reply` (el propio texto
    // generado por el bot) en vez del mensaje del cliente. Si el bot
    // redactaba un resumen que mencionaba "transferencia" (por ejemplo
    // citando payment_info del negocio), el sistema lo tomaba como si el
    // CLIENTE hubiera elegido ese método y confirmaba el pago solo, sin
    // preguntar nunca. Ahora se revisa el mensaje real del cliente.
    const r = parsed.reply.toLowerCase();
    const customerMsgLower = (ctx.lastCustomerMessage ?? "").toLowerCase();
    const mentionsTransferencia =
      customerMsgLower.includes("transferencia") ||
      customerMsgLower.includes("nequi") ||
      customerMsgLower.includes("daviplata") ||
      customerMsgLower.includes("bancolombia");
    const mentionsEfectivo =
      customerMsgLower.includes("efectivo") ||
      customerMsgLower.includes("plata") ||
      customerMsgLower.includes("cash");
    const isQuestion =
      r.includes("¿transferencia o efectivo?") ||
      r.includes("transferencia o efectivo?") ||
      r.includes("¿cómo va a pagar") ||
      r.includes("como va a pagar");

    // SAFETY NET: si el LLM dice "confirmado" sin haber llamado confirmOrder
    // y falta el pago, detectar el método de pago del mensaje del cliente
    // y ejecutar setPayment + mostrar resumen
    const saysConfirmed =
      r.includes("confirmado") ||
      r.includes("ha sido confirmado") ||
      r.includes("pedido confirmado") ||
      r.includes("gracias por su compra") ||
      r.includes("gracias por elegir");

    if (saysConfirmed && ctx.lastCustomerMessage) {
      const customerMsg = ctx.lastCustomerMessage.toLowerCase();
      const customerWantsTransferencia =
        customerMsg.includes("transferencia") ||
        customerMsg.includes("nequi") ||
        customerMsg.includes("daviplata") ||
        customerMsg.includes("bancolombia");
      const customerWantsEfectivo =
        customerMsg.includes("efectivo") || customerMsg.includes("plata");

      if (customerWantsTransferencia || customerWantsEfectivo) {
        const method = customerWantsTransferencia
          ? "transferencia"
          : "efectivo";
        console.warn(
          `[openrouter] Safety net: LLM dijo "confirmado" sin setPayment — ejecutando setPayment(${method})`,
        );
        const payResult = await executeTool(
          "setPayment",
          { method },
          tenantId,
          ctx,
        );
        try {
          const parsedResult = JSON.parse(payResult.result);
          if (parsedResult.success && parsedResult.summary) {
            parsed.reply = `${parsedResult.summary}\n\n¿Confirma el pedido?`;
          } else if (parsedResult.error) {
            parsed.reply = `¿Transferencia o efectivo?`;
          }
        } catch {
          parsed.reply = "¿Transferencia o efectivo?";
        }
      } else {
        // El LLM confirmó sin que el cliente dijera el método de pago
        parsed.reply = "¿Transferencia o efectivo?";
      }
    } else if ((mentionsTransferencia || mentionsEfectivo) && !isQuestion) {
      const method = mentionsTransferencia ? "transferencia" : "efectivo";
      // Ejecutar setPayment directamente
      const payResult = await executeTool(
        "setPayment",
        { method },
        tenantId,
        ctx,
      );
      try {
        const parsedResult = JSON.parse(payResult.result);
        if (parsedResult.success && parsedResult.summary) {
          parsed.reply = `${parsedResult.summary}\n\n¿Confirma el pedido?`;
        }
      } catch {
        // si falla, dejar la respuesta del LLM
      }
    } else if (isQuestion) {
      // Ya está preguntando el método de pago correctamente, no tocar.
    } else {
      // Catch-all: llegamos acá sin que el cliente haya mencionado un
      // método de pago Y sin que el LLM esté ya preguntando por uno.
      // No confiamos en texto libre del LLM para nada de pago — sin
      // importar qué frase haya inventado (puede decir "resumen",
      // "confirmado", o algo random como "Transferencia anotada." sin que
      // nadie lo haya dicho), si no llamó a setPayment, se reemplaza por
      // la pregunta canónica. Antes esto solo pasaba si el texto incluía
      // palabras específicas ("resumen", "total:", etc.) y cualquier otra
      // frase inventada se colaba sin filtro.
      parsed.reply = "¿Transferencia o efectivo?";
    }
  } else if (
    ctx?.conversationState &&
    ctx.conversationState.draft_items.length > 0 &&
    ctx.conversationState.draft_payment &&
    ctx.conversationState.draft_delivery_method
  ) {
    // El pedido está completo pero setPayment NO se llamó este turno.
    // Si el LLM escribió algo que parece un resumen, reemplazarlo con el
    // determinístico para evitar alucinaciones y dobles resúmenes.
    const r = parsed.reply.toLowerCase();
    if (
      r.includes("resumen") ||
      r.includes("confirma el pedido") ||
      r.includes("total:")
    ) {
      const summary = buildOrderSummaryForCustomer(ctx.conversationState);
      parsed.reply = `${summary}\n\n¿Confirma el pedido?`;
    }
  }

  return {
    response: parsed,
    usage: {
      model,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens,
      costUsd,
      durationMs,
    },
    orderConfirmed,
    confirmedOrderId,
  };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: number,
  ctx?: GenerateReplyContext,
): Promise<ToolResult> {
  switch (name) {
    case "searchProducts": {
      const query = String(args.query ?? "");
      const results = searchProducts(tenantId, query, 10);
      return {
        result: JSON.stringify(
          results.map((p) => ({
            name: p.name,
            price: p.price,
            stock: p.stock,
            description: p.description,
          })),
        ),
      };
    }
    case "getProduct": {
      const pname = String(args.name ?? "");
      const product = getProductByName(tenantId, pname);
      if (!product)
        return { result: JSON.stringify({ error: "Producto no encontrado" }) };
      return {
        result: JSON.stringify({
          name: product.name,
          price: product.price,
          stock: product.stock,
          description: product.description,
        }),
      };
    }
    case "getStock": {
      const pname = String(args.name ?? "");
      const info = getProductStock(tenantId, pname);
      if (!info)
        return { result: JSON.stringify({ error: "Producto no encontrado" }) };
      return { result: JSON.stringify({ name: info.name, stock: info.stock }) };
    }
    case "getBusinessInfo": {
      const tenant = getTenantById(tenantId);
      if (!tenant)
        return { result: JSON.stringify({ error: "Negocio no encontrado" }) };
      return {
        result: JSON.stringify({
          business_name: tenant.business_name,
          business_type: tenant.business_type,
          business_address: tenant.business_address,
          payment_info: tenant.payment_info,
          assistant_name: tenant.assistant_name,
          catalog_url: tenant.catalog_url,
        }),
      };
    }
    case "getOrderStatus": {
      const phone = ctx?.customerPhone;
      if (!phone)
        return {
          result: JSON.stringify({ error: "No se puede consultar el pedido" }),
        };
      const order = getLastOrderByPhone(tenantId, phone);
      if (!order)
        return {
          result: JSON.stringify({ error: "No hay pedidos recientes" }),
        };

      const statusMap: Record<string, string> = {
        PENDING: "Pendiente — aún no ha sido confirmado por el negocio",
        CONFIRMED: "Confirmado — el negocio ya lo recibió y lo va a preparar",
        PREPARING: "Preparando — están armando tu pedido",
        ON_THE_WAY: "En camino — tu pedido ya salió y llegará pronto",
        DELIVERED: "Entregado — tu pedido ya fue entregado",
        CANCELLED: "Cancelado",
      };

      return {
        result: JSON.stringify({
          order_id: order.id,
          status: order.status,
          status_description: statusMap[order.status] ?? order.status,
          total: order.total_amount,
          items: order.items.map(
            (i: { quantity: number; product_name: string }) =>
              `${i.quantity}x ${i.product_name}`,
          ),
          notes: order.notes,
        }),
      };
    }
    case "addItem": {
      const pname = String(args.name ?? "");
      const quantity = Math.max(1, Math.floor(Number(args.quantity ?? 1)) || 1);
      if (!ctx?.conversationId || !ctx.conversationState) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      // Si el pedido anterior fue confirmado, limpiar el draft para uno nuevo
      if (ctx.conversationState.state === "CONFIRMED") {
        ctx.conversationState.draft_items = [];
        ctx.conversationState.draft_delivery_method = null;
        ctx.conversationState.draft_delivery_price = null;
        ctx.conversationState.draft_address = null;
        ctx.conversationState.draft_payment = null;
        ctx.conversationState.draft_lat = null;
        ctx.conversationState.draft_lng = null;
        ctx.conversationState.state = "SELECTING_PRODUCTS";
      }
      const results = searchProducts(tenantId, pname, 1);
      if (results.length === 0) {
        // No encontrado: devolver lista de productos disponibles para sugerir
        const available = getTopProducts(tenantId, 20);
        return {
          result: JSON.stringify({
            error: `Producto no encontrado: ${pname}`,
            available_products: available.map((p) => p.name),
            hint: "Dile al cliente que no tenemos ese producto y ofrécele los de la lista available_products.",
          }),
        };
      }
      const product = results[0];
      if (product.stock <= 0) {
        return {
          result: JSON.stringify({
            error: `${product.name}: sin stock disponible`,
            stock: 0,
          }),
        };
      }
      // Verificar cuánto ya tiene en el draft
      const existing = ctx.conversationState.draft_items.find(
        (i: DraftItem) => i.name.toLowerCase() === product.name.toLowerCase(),
      );
      const inDraft = existing?.quantity ?? 0;
      const available = product.stock - inDraft;
      if (available <= 0) {
        return {
          result: JSON.stringify({
            error: `${product.name}: ya tiene ${inDraft} en el pedido y no hay más stock (total disponible: ${product.stock})`,
            stock: product.stock,
            in_draft: inDraft,
          }),
        };
      }
      const finalQty = Math.min(quantity, available);
      const capped = finalQty < quantity;
      addToDraft(ctx.conversationState, product.name, finalQty, product.price);
      computeStateFromDraft(ctx.conversationState);
      saveState(ctx.conversationState);
      const subtotal = computeDraftTotal(ctx.conversationState.draft_items);
      const tenantForAddItem = getTenantById(tenantId);
      const minOrderAddItem = tenantForAddItem?.min_order_amount ?? 0;
      const belowMinimum = minOrderAddItem > 0 && subtotal < minOrderAddItem;
      return {
        result: JSON.stringify({
          success: true,
          added: {
            name: product.name,
            quantity: finalQty,
            price: product.price,
          },
          ...(capped
            ? {
                warning: `Solo se agregaron ${finalQty} de ${quantity} pedidas de ${product.name}. Dile al cliente: "Solo tengo ${finalQty} disponibles de ${product.name}". NO menciones stock restante ni números de inventario.`,
              }
            : {}),
          ...(belowMinimum
            ? {
                below_minimum: `El pedido mínimo es $${minOrderAddItem.toLocaleString("es-CO")}. Lleva $${subtotal.toLocaleString("es-CO")}, le faltan $${(minOrderAddItem - subtotal).toLocaleString("es-CO")}. Si el cliente dice que no quiere agregar más, avisale que no se puede confirmar por debajo del mínimo.`,
              }
            : {}),
          draft_total: subtotal,
          draft_items: ctx.conversationState.draft_items.map(
            (i: DraftItem) => `${i.quantity}x ${i.name}`,
          ),
        }),
      };
    }
    case "removeItem": {
      const pname = String(args.name ?? "").toLowerCase();
      if (!ctx?.conversationState) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      const idx = ctx.conversationState.draft_items.findIndex(
        (i: DraftItem) =>
          i.name.toLowerCase().includes(pname) ||
          pname.includes(i.name.toLowerCase()),
      );
      if (idx === -1) {
        return {
          result: JSON.stringify({
            error: `Producto no está en el pedido: ${pname}`,
          }),
        };
      }
      const removed = ctx.conversationState.draft_items.splice(idx, 1)[0];
      computeStateFromDraft(ctx.conversationState);
      saveState(ctx.conversationState);
      const subtotal = computeDraftTotal(ctx.conversationState.draft_items);
      return {
        result: JSON.stringify({
          success: true,
          removed: { name: removed.name, quantity: removed.quantity },
          draft_total: subtotal,
          draft_items: ctx.conversationState.draft_items.map(
            (i: DraftItem) => `${i.quantity}x ${i.name}`,
          ),
        }),
      };
    }
    case "setDeliveryMethod": {
      const method = String(args.method ?? "");
      if (!ctx?.conversationState) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      if (method !== "domicilio" && method !== "recoger") {
        return {
          result: JSON.stringify({
            error: "Método inválido. Usar 'domicilio' o 'recoger'",
          }),
        };
      }
      ctx.conversationState.draft_delivery_method = method;
      if (method === "recoger") {
        ctx.conversationState.draft_address = null;
        ctx.conversationState.draft_delivery_price = null;
        ctx.conversationState.draft_lat = null;
        ctx.conversationState.draft_lng = null;
      }
      computeStateFromDraft(ctx.conversationState);
      saveState(ctx.conversationState);
      return {
        result: JSON.stringify({
          success: true,
          delivery_method: method,
          next:
            method === "recoger"
              ? "Preguntar método de pago: ¿Transferencia o efectivo?"
              : "Pedirle PRIMERO que envíe su ubicación por WhatsApp — solo si no puede, aceptar la dirección escrita. Ejemplo a copiar: '¿Me compartes tu ubicación por WhatsApp? (📎 → Ubicación). Si no puedes, también me sirve la dirección escrita'",
        }),
      };
    }
    case "setAddress": {
      const input = String(args.address ?? "").trim();
      if (!ctx?.conversationState) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      if (input.length < 3) {
        return {
          result: JSON.stringify({ error: "Dirección demasiado corta" }),
        };
      }
      const s = ctx.conversationState;
      const tenant = getTenantById(tenantId);
      const maxKm = tenant?.max_delivery_km ?? 15;

      // Verificar que el tenant tenga configurada su ubicación
      if (!tenant?.business_lat || !tenant?.business_lng) {
        // Sin ubicación del local: guardar dirección pero no calcular precio
        s.draft_address = input;
        s.draft_delivery_method = "domicilio";
        s.draft_delivery_price = tenant?.delivery_price ?? 0;
        computeStateFromDraft(s);
        saveState(s);
        return {
          result: JSON.stringify({
            success: true,
            address: input,
            delivery_price: s.draft_delivery_price,
            warning:
              "El negocio no tiene configurada su ubicación GPS. Se usa precio fijo de domicilio.",
            next: "Preguntar método de pago: ¿Transferencia o efectivo?",
          }),
        };
      }

      // BUG real encontrado (2026-09-10): este safety net de "ya resuelta,
      // no re-buscar" bloqueaba incluso cuando el cliente estaba corrigiendo
      // una dirección MAL resuelta (ej: "no es al conjunto, es al barrio") —
      // el pedido #49 se confirmó con la dirección equivocada porque el bot
      // insistió "ya está confirmada" en vez de escuchar la corrección. Si
      // el mensaje del cliente suena a corrección/rechazo, no aplicamos el
      // atajo: reseteamos lo resuelto y dejamos que caiga a la búsqueda
      // normal con el texto nuevo.
      const looksLikeCorrection =
        /\bno\s+(es|era|es[ao]|ah[ií])\b|\bsi\s*no\b|\bsino\b|\best[áa]\s+mal\b|\bequivocad|\ben\s+realidad\b|\bcambiar\s+la\s+direcci[oó]n\b/i.test(
          input,
        );
      if (
        looksLikeCorrection &&
        s.draft_address &&
        s.draft_delivery_price !== null
      ) {
        console.log(
          `[openrouter] setAddress: cliente corrigiendo dirección ya resuelta ("${s.draft_address}") con "${input}" — reseteando para re-buscar`,
        );
        s.draft_address = null;
        s.draft_lat = null;
        s.draft_lng = null;
        s.draft_delivery_price = null;
        saveState(s);
      }

      // Safety net: si ya hay una dirección resuelta con precio, no re-resolver.
      // Esto evita que el LLM vuelva a llamar setAddress después de que el cliente confirmó.
      if (
        s.draft_address &&
        s.draft_delivery_price !== null &&
        s.draft_lat &&
        s.draft_lng
      ) {
        // BUG real encontrado (2026-09-10): este safety net devolvía el
        // estado actual pero DESCARTABA cualquier texto nuevo — por ejemplo
        // cuando le pedimos al cliente "torre/apto" después de resolver un
        // pin de GPS, su respuesta se perdía en silencio. Ahora, si el
        // texto nuevo no es un link (osea no es otra ubicación distinta) y
        // no está ya incluido, se agrega como detalle a la dirección.
        //
        // BUG real encontrado (2026-09-11): cuando el cliente escribe rápido
        // (manda el pin de GPS y, sin esperar respuesta, ya manda "Local 16"),
        // esos dos mensajes a veces caen en debounces separados — y en ese
        // segundo turno el LLM a veces vuelve a llamar setAddress con el
        // MISMO link de antes en vez de pasar el texto nuevo del cliente
        // ("Local 16"). Resultado real: el detalle nunca llegaba a ningún
        // lado y el domiciliario se quedaba sin saber que era el Local 16.
        // Un link nunca puede ser un "detalle" válido — si lo que mandó el
        // LLM es un link, usamos el ÚLTIMO MENSAJE REAL del cliente en su
        // lugar (mismo patrón que ya usamos para pago y método de entrega).
        const trimmedInput = input.trim();
        const lastCustomerMsg = (ctx.lastCustomerMessage ?? "").trim();
        const inputLooksLikeLink = /https?:\/\//i.test(trimmedInput);
        const detailCandidate =
          inputLooksLikeLink &&
          lastCustomerMsg &&
          !/https?:\/\//i.test(lastCustomerMsg)
            ? lastCustomerMsg
            : trimmedInput;
        const looksLikeNewLink = /https?:\/\//i.test(detailCandidate);
        const alreadyIncluded = s.draft_address
          .toLowerCase()
          .includes(detailCandidate.toLowerCase());
        const isNegativeReply =
          /^(no|ninguna?|no\s*hay|nada|no\s*tengo|as[ií]\s*est[áa]\s*bien|ya\s*est[áa])\.?$/i.test(
            detailCandidate,
          );
        if (
          detailCandidate.length > 0 &&
          !looksLikeNewLink &&
          !alreadyIncluded &&
          !isNegativeReply
        ) {
          s.draft_address = `${s.draft_address} — ${detailCandidate}`;
          saveState(s);
          console.log(
            `[openrouter] setAddress: detalle agregado a dirección ya resuelta → "${s.draft_address}"`,
          );
        }
        console.log(
          `[openrouter] setAddress: dirección ya resuelta "${s.draft_address}", devolviendo estado actual`,
        );
        return {
          result: JSON.stringify({
            success: true,
            address: s.draft_address,
            delivery_price: s.draft_delivery_price,
            already_resolved: true,
            next: "La dirección ya está resuelta y confirmada. Avanza DIRECTO al pago: ¿Transferencia o efectivo?",
          }),
        };
      }

      // BUG real encontrado (2026-09-10): cuando setAddress devuelve
      // "ambiguous" o "not_found" y el cliente responde que ninguna opción
      // es correcta (a veces agregando una pista como el municipio), el LLM
      // a veces vuelve a llamar setAddress con el MISMO texto que ya había
      // fallado, ignorando la pista nueva — repitiendo la misma búsqueda
      // (que además tarda 15-18s) una y otra vez sin avanzar. En vez de
      // depender de que el LLM se dé cuenta, el backend detecta el repeat
      // exacto y corta directo a pedir ubicación por WhatsApp.
      const normalizeForRepeatCheck = (t: string) =>
        t
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      if (
        s.draft_address &&
        s.draft_delivery_price === null &&
        !s.draft_lat &&
        !s.draft_lng &&
        normalizeForRepeatCheck(s.draft_address) === normalizeForRepeatCheck(input)
      ) {
        console.log(
          `[openrouter] setAddress: repetiste el mismo texto sin resolver ("${input}"), forzando pedido de ubicación GPS`,
        );
        return {
          result: JSON.stringify({
            error:
              "Ya intentamos ubicar esa dirección antes y no se pudo — repetir el mismo texto no va a cambiar el resultado.",
            next: 'Decile al cliente EXACTAMENTE: "No logro ubicar esa dirección por texto. ¿Podés enviarme tu ubicación por WhatsApp? (botón 📍, clip → Ubicación)". NO vuelvas a llamar setAddress con el mismo texto — esperá a que mande la ubicación o un link de Google Maps.',
          }),
        };
      }

      // Intentar extraer lat/lng del input (link de Google Maps o ubicación WhatsApp)
      let clientLatLng = await extractLatLngFromUrl(input);

      if (clientLatLng) {
        // Es un link/ubicación GPS: usar directamente como antes
        const origin = { lat: tenant.business_lat, lng: tenant.business_lng };
        const { km, source: distSource } = await calculateDistance(
          origin,
          clientLatLng,
        );

        if (km > maxKm) {
          console.log(
            `[openrouter] setAddress: gps fuera de zona → ${km.toFixed(2)}km (max ${maxKm}km)`,
          );
          return {
            result: JSON.stringify({
              error: `La ubicación está a ${km.toFixed(1)}km, fuera de nuestra zona de reparto (máximo ${maxKm}km).`,
              distance_km: Number(km.toFixed(2)),
              next: "Informar al cliente que esa dirección está fuera de la zona de cobertura y que no podemos hacer el domicilio hasta allá. Preguntar si quiere recoger en tienda en cambio.",
            }),
          };
        }

        const pricePerKm = tenant.price_per_km ?? 0;
        const deliveryPrice = calculateDeliveryPrice(
          km,
          pricePerKm,
          tenant.min_delivery_price ?? undefined,
        );

        // El cliente mandó un pin de GPS — eso da coordenadas exactas pero
        // NUNCA trae detalles de unidad (torre/apto/piso). Sin eso, el
        // domiciliario llega al lugar correcto pero no sabe a qué puerta ir.
        //
        // BUG real encontrado (2026-09-10): cuando el cliente primero
        // escribe una dirección de texto que sale ambigua/no encontrada
        // (ej: "conjunto boreal torre 2 apt 804") y TERMINA mandando su
        // ubicación GPS en su lugar, el lugar se aprendía con el nombre
        // derivado de las coordenadas ("Calle 8...") — nunca con "boreal",
        // que es lo que el cliente realmente escribió y lo que un futuro
        // cliente va a volver a escribir. Si hay un intento de texto previo
        // fallido en esta conversación, lo usamos como nombre real y lo
        // aprendemos ahora mismo (no hace falta esperar a que confirme el
        // pedido) — así la próxima vez que alguien escriba "boreal" ya
        // resuelve directo, sin pasar por Nominatim/Photon.
        const prevTypedAddress =
          s.draft_address && s.draft_delivery_price === null
            ? s.draft_address
            : null;
        let addressLabel: string;
        if (prevTypedAddress) {
          const { reference } = extractDetails(prevTypedAddress);
          addressLabel = prevTypedAddress;
          if (reference && reference.length > 3) {
            learnPlaceFromConfirmation(
              tenantId,
              reference,
              clientLatLng.lat,
              clientLatLng.lng,
            );
          }
        } else {
          const readableLabel = await reverseGeocode(clientLatLng);
          addressLabel = readableLabel
            ? `${readableLabel} (ubicación GPS: ${input})`
            : input;
        }

        s.draft_address = addressLabel;
        s.draft_delivery_method = "domicilio";
        s.draft_lat = clientLatLng.lat;
        s.draft_lng = clientLatLng.lng;
        s.draft_delivery_price = deliveryPrice;
        computeStateFromDraft(s);
        saveState(s);

        console.log(
          `[openrouter] setAddress: gps → "${addressLabel}" ${km.toFixed(2)}km (${distSource}), precio=$${deliveryPrice}${prevTypedAddress ? " [aprendido de intento de texto previo]" : ""}`,
        );

        return {
          result: JSON.stringify({
            success: true,
            address: addressLabel,
            distance_km: Number(km.toFixed(2)),
            delivery_price: deliveryPrice,
            distance_source: distSource,
            next: 'Preguntar: "Perfecto, ya tengo tu ubicación. ¿Alguna referencia para el domiciliario — torre, apartamento, piso, portería, o algún negocio/lugar conocido cerca?" Cuando el cliente responda (aunque sea "no" o "ninguna", o mencione un negocio como referencia), llamá setAddress de nuevo pasando ESA respuesta como texto para guardarla. Esa referencia es solo para ubicarse — el precio del domicilio ya quedó fijo con esta ubicación, no cambia. Recién ahí avanzá a preguntar el pago.',
          }),
        };
      }

      // No es link: usar el resolver de direcciones
      const origin = { lat: tenant.business_lat, lng: tenant.business_lng };

      // Si el intento anterior falló (sin precio/coords) y el nuevo input es corto
      // (probable aclaración de ciudad/zona), intentar combinar ambos.
      //
      // Ojo — revisado 2026-09-11: al principio pensé que "carrera 5 con 21"
      // dicho después de "la boyaca" era una dirección totalmente aparte y
      // que combinarlas nunca debía pasar. El dueño del negocio corrigió
      // eso: esa cuadra SÍ queda en el sector de Boyacá, combinar era lo
      // correcto. El bug real no era combinar — era que la búsqueda
      // combinada ("boyaca carrera 5 con 21") coincidió con un lugar real
      // pero en OTRO departamento (Ulloa, Valle del Cauca, homónimo de
      // "Boyacá") que por pura casualidad quedaba a 12.5km en línea recta
      // (pasaba el filtro de radio) aunque a 23km reales por carretera. Ese
      // filtro de mismo-departamento se agregó en resolveDeliveryAddress
      // (looksLikeSameRegion) — acá se sigue combinando igual que siempre.
      const prevAddrFailed =
        s.draft_address &&
        s.draft_delivery_price === null &&
        !s.draft_lat &&
        !s.draft_lng;
      const isShortClarification =
        input.length < 30 &&
        !/\d{3,}/.test(input) &&
        !/torre|apto|apartamento|casa|bloque|piso|local|interior/i.test(input);

      let resolution = await resolveDeliveryAddress(
        tenantId,
        input,
        origin,
        ctx.customerPhone,
        maxKm,
      );

      // Si no encontró y hay dirección previa fallida, intentar combinando
      if (
        resolution.status === "not_found" &&
        prevAddrFailed &&
        isShortClarification &&
        s.draft_address
      ) {
        const combined = `${s.draft_address} ${input}`;
        console.log(
          `[openrouter] setAddress: combinando con addr previa → "${combined}"`,
        );
        const combinedResolution = await resolveDeliveryAddress(
          tenantId,
          combined,
          origin,
          ctx.customerPhone,
          maxKm,
        );
        if (combinedResolution.status !== "not_found") {
          resolution = combinedResolution;
        }
      }

      if (
        resolution.status === "resolved" &&
        resolution.lat &&
        resolution.lng
      ) {
        const { km, source: distSource } = await calculateDistance(origin, {
          lat: resolution.lat,
          lng: resolution.lng,
        });

        if (km > maxKm) {
          console.log(
            `[openrouter] setAddress: ${resolution.source} fuera de zona → "${resolution.resolvedName}" ${km.toFixed(2)}km (max ${maxKm}km)`,
          );
          return {
            result: JSON.stringify({
              error: `"${resolution.resolvedName}" está a ${km.toFixed(1)}km, fuera de nuestra zona de reparto (máximo ${maxKm}km).`,
              next: "Informar al cliente que esa dirección está fuera de la zona de cobertura. Preguntar si quiere recoger en tienda en cambio o dar otra dirección más cercana.",
            }),
          };
        }

        const pricePerKm = tenant.price_per_km ?? 0;
        const deliveryPrice = calculateDeliveryPrice(
          km,
          pricePerKm,
          tenant.min_delivery_price ?? undefined,
        );

        // Construir dirección completa: referencia + detalles
        const fullAddress = resolution.details
          ? `${resolution.reference}, ${resolution.details}`
          : resolution.reference;

        s.draft_address = fullAddress;
        s.draft_delivery_method = "domicilio";
        s.draft_lat = resolution.lat;
        s.draft_lng = resolution.lng;
        s.draft_delivery_price = deliveryPrice;
        computeStateFromDraft(s);
        saveState(s);

        console.log(
          `[openrouter] setAddress: ${resolution.source} → "${resolution.resolvedName}" ${km.toFixed(2)}km, precio=$${deliveryPrice}`,
        );

        const skipConfirmation =
          resolution.source === "known_place" &&
          resolution.knownPlaceSource === "confirmed";
        return {
          result: JSON.stringify({
            success: true,
            address: fullAddress,
            resolved_name: resolution.resolvedName,
            distance_km: Number(km.toFixed(2)),
            delivery_price: deliveryPrice,
            skip_confirmation: skipConfirmation,
            next: skipConfirmation
              ? "Preguntar método de pago: ¿Transferencia o efectivo?"
              : `Confirmar con el cliente: "¿Es ${resolution.resolvedName}?" Si confirma, preguntar método de pago: ¿Transferencia o efectivo?`,
          }),
        };
      }

      if (
        resolution.status === "saved_suggestion" &&
        resolution.lat &&
        resolution.lng
      ) {
        const { km, source: distSource } = await calculateDistance(origin, {
          lat: resolution.lat,
          lng: resolution.lng,
        });

        if (km > maxKm) {
          console.log(
            `[openrouter] setAddress: saved fuera de zona → "${resolution.savedAddress}" ${km.toFixed(2)}km (max ${maxKm}km)`,
          );
          return {
            result: JSON.stringify({
              error: `La dirección guardada está a ${km.toFixed(1)}km, fuera de nuestra zona de reparto (máximo ${maxKm}km).`,
              next: "Informar al cliente que esa dirección guardada quedó fuera de la zona de cobertura. Pedirle una dirección distinta o que recoja en tienda.",
            }),
          };
        }

        const pricePerKm = tenant.price_per_km ?? 0;
        const deliveryPrice = calculateDeliveryPrice(
          km,
          pricePerKm,
          tenant.min_delivery_price ?? undefined,
        );

        const fullAddress = resolution.details
          ? `${resolution.reference}, ${resolution.details}`
          : resolution.savedAddress || resolution.reference;

        s.draft_address = fullAddress;
        s.draft_delivery_method = "domicilio";
        s.draft_lat = resolution.lat;
        s.draft_lng = resolution.lng;
        s.draft_delivery_price = deliveryPrice;
        computeStateFromDraft(s);
        saveState(s);

        console.log(
          `[openrouter] setAddress: saved → "${fullAddress}" ${km.toFixed(2)}km, precio=$${deliveryPrice}`,
        );

        return {
          result: JSON.stringify({
            success: true,
            address: fullAddress,
            delivery_price: deliveryPrice,
            next: `Confirmar con el cliente: "¿El domicilio es para ${fullAddress}?" Si confirma, preguntar método de pago: ¿Transferencia o efectivo?`,
          }),
        };
      }

      if (resolution.status === "ambiguous" && resolution.candidates) {
        // Guardar el intento (sin precio) para que el guard de arriba pueda
        // detectar si el próximo mensaje repite el mismo texto sin resolver.
        s.draft_address = input;
        s.draft_delivery_price = null;
        s.draft_lat = null;
        s.draft_lng = null;
        saveState(s);
        // Cada opción lleva su propio link de mapa (lat/lng reales del
        // candidato) para que el cliente pueda VER dónde queda cada una en
        // vez de adivinar solo por el nombre — esto se arma acá, fijo, en
        // vez de dejar que el LLM redacte la lista (mismo motivo que el
        // resumen del pedido: un link mal transcrito manda al domiciliario
        // al lugar equivocado). El costo extra en tokens es insignificante
        // (unos 15-20 tokens por link, centavos de diferencia).
        const candidateList = resolution.candidates
          .map(
            (c, i) =>
              `${i + 1}. ${c.address}\n   📍 https://www.google.com/maps?q=${c.lat},${c.lng}`,
          )
          .join("\n");
        const ambiguousReply = `Encontré varias ubicaciones para "${resolution.reference}". ¿Cuál es la correcta?\n\n${candidateList}\n\nSi ninguna es correcta, mandame tu ubicación por WhatsApp (📎 → Ubicación).`;
        return {
          result: JSON.stringify({
            success: false,
            ambiguous: true,
            candidates: resolution.candidates.map((c) => c.address),
            deterministic_reply: ambiguousReply,
            next: "Mandale al cliente EXACTAMENTE el texto de deterministic_reply, sin resumirlo ni redactarlo de nuevo.",
          }),
        };
      }

      // not_found: guardar dirección pero pedir más info
      s.draft_address = input;
      s.draft_delivery_method = "domicilio";
      s.draft_delivery_price = null;
      s.draft_lat = null;
      s.draft_lng = null;
      computeStateFromDraft(s);
      saveState(s);
      return {
        result: JSON.stringify({
          success: true,
          address: input,
          delivery_price: null,
          warning:
            "No pude ubicar esa dirección. Pídele al cliente que envíe su ubicación por WhatsApp (botón 📍) o que comparta un link de Google Maps. También puede funcionar un punto de referencia cercano (centro comercial, universidad, parque, etc.).",
          next: "Pedirle al cliente su ubicación por WhatsApp o un link de Google Maps. Si no puede, pedir un punto de referencia cercano conocido. NO avances al pago hasta tener ubicación.",
        }),
      };
    }
    case "setPayment": {
      const method = String(args.method ?? "");
      if (!ctx?.conversationState) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      if (method !== "transferencia" && method !== "efectivo") {
        return {
          result: JSON.stringify({
            error: "Método inválido. Usar 'transferencia' o 'efectivo'",
          }),
        };
      }
      // El pago va DESPUÉS de entrega y dirección
      if (!ctx.conversationState.draft_delivery_method) {
        return {
          result: JSON.stringify({
            error:
              "Todavía no se puede fijar el pago: falta el método de entrega. Pregunta primero: ¿Es para domicilio o lo recoge en tienda?",
            next: "setDeliveryMethod",
          }),
        };
      }
      if (
        ctx.conversationState.draft_delivery_method === "domicilio" &&
        !ctx.conversationState.draft_address
      ) {
        return {
          result: JSON.stringify({
            error:
              "Todavía no se puede fijar el pago: falta la dirección de entrega. Pregunta primero el barrio y la dirección.",
            next: "setAddress",
          }),
        };
      }
      // BUG real encontrado: una dirección "not_found" igual guarda texto
      // crudo en draft_address (para poder combinarlo si el cliente aclara
      // después) pero deja draft_delivery_price en null. El chequeo de
      // arriba solo mira si draft_address tiene texto, no si el precio se
      // calculó — dejaba pasar el pago con domicilio $0 sin ubicación real.
      if (
        ctx.conversationState.draft_delivery_method === "domicilio" &&
        ctx.conversationState.draft_delivery_price === null
      ) {
        return {
          result: JSON.stringify({
            error:
              "Todavía no se puede fijar el pago: la dirección que dio el cliente no se pudo ubicar, falta calcular el precio del domicilio. Pídele que envíe su ubicación por WhatsApp (botón 📍) o un link de Google Maps — NO avances al pago sin eso.",
            next: "Pedir ubicación por WhatsApp o link de Google Maps",
          }),
        };
      }
      ctx.conversationState.draft_payment = method;
      computeStateFromDraft(ctx.conversationState);
      saveState(ctx.conversationState);
      // Armar el resumen aquí porque el system prompt de este turno se
      // construyó antes de que el pago quedara guardado
      return {
        result: JSON.stringify({
          success: true,
          payment: method,
          summary: buildOrderSummaryForCustomer(ctx.conversationState),
          next: "Enviar el resumen del campo 'summary' EXACTAMENTE como está (sin agregar ni quitar nada), seguido de: ¿Confirma el pedido?",
        }),
      };
    }
    case "confirmOrder": {
      if (!ctx?.conversationState || !ctx?.customerPhone) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      const s = ctx.conversationState;
      if (s.draft_items.length === 0) {
        return {
          result: JSON.stringify({ error: "No hay items en el pedido" }),
        };
      }
      if (!s.draft_delivery_method) {
        return { result: JSON.stringify({ error: "Falta método de entrega" }) };
      }
      if (s.draft_delivery_method === "domicilio" && !s.draft_address) {
        return {
          result: JSON.stringify({ error: "Falta dirección de entrega" }),
        };
      }
      // El domicilio debe tener un precio calculado (puede ser 0 = gratis)
      if (
        s.draft_delivery_method === "domicilio" &&
        s.draft_delivery_price === null
      ) {
        return {
          result: JSON.stringify({
            error:
              "Falta calcular el precio del domicilio. Usa setAddress con la dirección del cliente.",
          }),
        };
      }
      if (!s.draft_payment) {
        return { result: JSON.stringify({ error: "Falta método de pago" }) };
      }
      const subtotal = computeDraftTotal(s.draft_items);
      const tenantForMin = getTenantById(tenantId);
      const minOrder = tenantForMin?.min_order_amount ?? 0;
      if (minOrder > 0 && subtotal < minOrder) {
        const faltante = minOrder - subtotal;
        return {
          result: JSON.stringify({
            error: `El pedido no alcanza el mínimo de $${minOrder.toLocaleString("es-CO")}. Faltan $${faltante.toLocaleString("es-CO")} en productos.`,
            next: `Decile al cliente que el pedido mínimo es $${minOrder.toLocaleString("es-CO")} y que le faltan $${faltante.toLocaleString("es-CO")} — preguntale si quiere agregar algo más.`,
          }),
        };
      }
      const deliveryPrice = s.draft_delivery_price ?? 0;
      const total = subtotal + deliveryPrice;
      const orderItems = s.draft_items.map((item: DraftItem) => ({
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
      }));
      // Incluir el domicilio como línea del pedido para que el total cuadre
      if (s.draft_delivery_method === "domicilio" && deliveryPrice > 0) {
        orderItems.push({
          product_name: `Domicilio (envío)`,
          quantity: 1,
          unit_price: deliveryPrice,
        });
      }
      // Capturar datos del pedido antes de limpiar el draft
      const confirmedPayment = s.draft_payment;
      const confirmedItems = s.draft_items.map(
        (i: DraftItem) => `${i.quantity}x ${i.name}`,
      );
      const order = createOrder({
        tenant_id: tenantId,
        customer_phone: ctx.customerPhone,
        customer_name: ctx.customerName || null,
        items: orderItems,
        notes: `Entrega: ${s.draft_address ?? "a convenir"}. Pago: ${s.draft_payment}.`,
        delivery_lat: s.draft_lat,
        delivery_lng: s.draft_lng,
      });

      // Aprender lugar conocido y guardar dirección frecuente del cliente
      if (s.draft_lat && s.draft_lng && s.draft_address) {
        // Extraer la referencia (sin torre/apto) para guardar como known_place
        const { reference } = extractDetails(s.draft_address);
        if (reference && reference.length > 3) {
          learnPlaceFromConfirmation(
            tenantId,
            reference,
            s.draft_lat,
            s.draft_lng,
          );
        }
        // Guardar dirección frecuente del cliente
        upsertCustomerAddress(
          tenantId,
          ctx.customerPhone,
          s.draft_address,
          reference,
          s.draft_lat,
          s.draft_lng,
        );
      }
      // Limpiar el draft para permitir un nuevo pedido
      s.draft_items = [];
      s.draft_delivery_method = null;
      s.draft_delivery_price = null;
      s.draft_address = null;
      s.draft_payment = null;
      s.draft_lat = null;
      s.draft_lng = null;
      s.state = "CONFIRMED";
      saveState(s);
      return {
        result: JSON.stringify({
          success: true,
          order_id: order.id,
          total,
          payment: confirmedPayment,
          items: confirmedItems,
        }),
        orderConfirmed: true,
        orderId: order.id,
      };
    }
    case "getOrderDraft": {
      if (!ctx?.conversationState) {
        return {
          result: JSON.stringify({ error: "No hay conversación activa" }),
        };
      }
      const s = ctx.conversationState;
      const subtotal = computeDraftTotal(s.draft_items);
      const deliveryPrice = s.draft_delivery_price ?? 0;
      return {
        result: JSON.stringify({
          items: s.draft_items.map((i: DraftItem) => ({
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            subtotal: i.price * i.quantity,
          })),
          delivery_method: s.draft_delivery_method,
          delivery_price: deliveryPrice,
          address: s.draft_address,
          payment: s.draft_payment,
          subtotal,
          total: subtotal + deliveryPrice,
          state: s.state,
        }),
      };
    }
    default:
      return { result: JSON.stringify({ error: `Tool desconocido: ${name}` }) };
  }
}
