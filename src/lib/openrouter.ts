import OpenAI from "openai";
import { buildSystemPromptForTenant } from "./system-prompt";
import {
  getTopProducts,
  searchProducts,
  getProductByName,
  getProductStock,
  getTenantById,
  type Message,
} from "./db";
import { createOrder } from "./events";

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

function buildSystemPrompt(tenantId: number): string {
  const basePrompt = buildSystemPromptForTenant(tenantId);
  // Inyectar solo top 10 productos como referencia rápida
  const top = getTopProducts(tenantId, 10);
  let catalog = "";
  if (top.length > 0) {
    catalog = "\n\n--- PRODUCTOS PRINCIPALES ---\n";
    for (const p of top) {
      catalog += `- ${p.name}: ${new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
      }).format(p.price)} (stock: ${p.stock})\n`;
    }
    catalog +=
      "\nEsta lista es PARCIAL (no incluye todos los productos). Usá searchProducts para buscar productos que no estén aquí.\n";
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

const MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "350", 10);

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
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
): Promise<{ response: LLMResponse; usage: LLMUsage }> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(tenantId) },
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
                "Término de búsqueda (ej: 'waffle', 'chocolate', 'pandebono')",
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
        name: "createOrder",
        description:
          "Crear un pedido cuando el cliente confirme. Valida stock automáticamente.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: {
                    type: "string",
                    description: "Nombre exacto del producto",
                  },
                  quantity: { type: "number", description: "Cantidad" },
                },
                required: ["name", "quantity"],
              },
            },
            notes: {
              type: "string",
              description:
                "Notas del pedido: dirección de entrega, método de pago",
            },
          },
          required: ["items"],
        },
      },
    },
  ];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const t0 = Date.now();
  let completion = await client.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.7,
    max_tokens: MAX_TOKENS,
  });

  totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
  totalCompletionTokens += completion.usage?.completion_tokens ?? 0;

  // Manejar tool calls (hasta 3 rondas)
  for (let round = 0; round < 3; round++) {
    const msg = completion.choices[0]?.message;
    if (!msg?.tool_calls || msg.tool_calls.length === 0) break;

    // Agregar el mensaje del assistant con tool_calls al historial
    messages.push(msg);

    // Ejecutar cada tool call
    for (const toolCall of msg.tool_calls) {
      const fnName = toolCall.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = {};
      }

      let result: string;
      try {
        result = await executeTool(fnName, args, tenantId, ctx);
      } catch (err) {
        result = JSON.stringify({ error: (err as Error).message });
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    // Segunda llamada con resultados de tools
    completion = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: MAX_TOKENS,
    });

    totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
    totalCompletionTokens += completion.usage?.completion_tokens ?? 0;
  }

  const durationMs = Date.now() - t0;
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const costUsd = estimateCost(model, totalPromptTokens, totalCompletionTokens);

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
  };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: number,
  ctx?: GenerateReplyContext,
): Promise<string> {
  switch (name) {
    case "searchProducts": {
      const query = String(args.query ?? "");
      const results = searchProducts(tenantId, query, 10);
      return JSON.stringify(
        results.map((p) => ({
          name: p.name,
          price: p.price,
          stock: p.stock,
          description: p.description,
        })),
      );
    }
    case "getProduct": {
      const name = String(args.name ?? "");
      const product = getProductByName(tenantId, name);
      if (!product) return JSON.stringify({ error: "Producto no encontrado" });
      return JSON.stringify({
        name: product.name,
        price: product.price,
        stock: product.stock,
        description: product.description,
      });
    }
    case "getStock": {
      const name = String(args.name ?? "");
      const info = getProductStock(tenantId, name);
      if (!info) return JSON.stringify({ error: "Producto no encontrado" });
      return JSON.stringify({ name: info.name, stock: info.stock });
    }
    case "getBusinessInfo": {
      const tenant = getTenantById(tenantId);
      if (!tenant) return JSON.stringify({ error: "Negocio no encontrado" });
      return JSON.stringify({
        business_name: tenant.business_name,
        business_type: tenant.business_type,
        business_address: tenant.business_address,
        payment_info: tenant.payment_info,
        assistant_name: tenant.assistant_name,
        catalog_url: tenant.catalog_url,
      });
    }
    case "createOrder": {
      const items =
        (args.items as Array<{ name: string; quantity: number }>) ?? [];
      const notes = args.notes ? String(args.notes) : undefined;
      // Resolver precios desde la DB
      const orderItems = items.map((item) => {
        const product = getProductByName(tenantId, item.name);
        return {
          product_name: product?.name ?? item.name,
          quantity: item.quantity,
          unit_price: product?.price ?? 0,
        };
      });
      try {
        const order = await createOrder({
          tenant_id: tenantId,
          customer_phone: ctx?.customerPhone ?? "whatsapp",
          customer_name: ctx?.customerName ?? null,
          items: orderItems,
          notes: notes ?? null,
        });
        return JSON.stringify({
          success: true,
          order_id: order.id,
          total: (order as { total_amount?: number }).total_amount ?? 0,
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: (err as Error).message,
        });
      }
    }
    default:
      return JSON.stringify({ error: `Tool desconocido: ${name}` });
  }
}
