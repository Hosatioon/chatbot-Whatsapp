import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import { getActiveProducts } from "./db";
import type { Message } from "./db";

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
    "HTTP-Referer": "http://localhost:3000",
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
  const products = getActiveProducts(tenantId);
  let catalog = "";
  if (products.length > 0) {
    catalog = "\n\n--- CATÁLOGO ACTUAL ---\n";
    for (const p of products) {
      catalog += `- ${p.name}: ${new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
      }).format(p.price)} (stock: ${p.stock})\n`;
    }
    catalog += "\nUsá estos precios exactos. No inventes otros.\n";
  }
  return SYSTEM_PROMPT + catalog;
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

export async function generateReply(
  history: Message[],
  tenantId: number,
): Promise<LLMResponse> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: buildSystemPrompt(tenantId) },
      ...mapHistory(history),
    ];

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    response_format: {
      type: "json_object",
    },
  });

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("LLM devolvió respuesta vacía");
  }

  try {
    const parsed = JSON.parse(reply) as LLMResponse;

    // Validar estructura mínima
    if (!parsed.intent || !parsed.reply) {
      throw new Error("Respuesta JSON inválida: falta intent o reply");
    }

    // Validar que si es create_order, tenga items
    if (
      parsed.intent === "create_order" &&
      (!parsed.order_data?.items || parsed.order_data.items.length === 0)
    ) {
      throw new Error("Respuesta JSON inválida: create_order requiere items");
    }

    return parsed;
  } catch (error) {
    console.error("Error parsing LLM JSON response:", error);
    console.error("Raw response:", reply);

    // Fallback: tratar como respuesta simple de chat
    return {
      intent: "chat",
      reply: reply,
    };
  }
}
