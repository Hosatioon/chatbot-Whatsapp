import OpenAI from "openai";
import { buildSystemPromptForTenant } from "./system-prompt";
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
  const basePrompt = buildSystemPromptForTenant(tenantId);
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
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
  "google/gemma-2-9b-it:free": { input: 0, output: 0 },
};

const UNKNOWN_MODEL_PRICING = {
  input: parseFloat(process.env.LLM_UNKNOWN_MODEL_INPUT_PRICE_USD_PER_MILLION || "1"),
  output: parseFloat(process.env.LLM_UNKNOWN_MODEL_OUTPUT_PRICE_USD_PER_MILLION || "4"),
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

export async function generateReply(
  history: Message[],
  tenantId: number,
): Promise<{ response: LLMResponse; usage: LLMUsage }> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: buildSystemPrompt(tenantId) },
      ...mapHistory(history),
    ];

  const t0 = Date.now();
  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: MAX_TOKENS,
    response_format: {
      type: "json_object",
    },
  });
  const durationMs = Date.now() - t0;

  const promptTokens = completion.usage?.prompt_tokens ?? 0;
  const completionTokens = completion.usage?.completion_tokens ?? 0;
  const totalTokens = completion.usage?.total_tokens ?? 0;
  const costUsd = estimateCost(model, promptTokens, completionTokens);

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("LLM devolvió respuesta vacía");
  }

  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(reply) as LLMResponse;

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

    parsed = {
      intent: "chat",
      reply: reply,
    };
  }

  return {
    response: parsed,
    usage: {
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      durationMs,
    },
  };
}
