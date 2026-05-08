import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { Message } from "./db";

// IMPORTANTE: este módulo lee process.env en top-level. En el proceso del
// bot necesita que `scripts/env-loader.ts` ya haya corrido antes (se importa
// como primer side-effect en `scripts/start-bot.ts`). En Next.js las env
// vars de `.env.local` ya están cargadas automáticamente.

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

if (!apiKey) {
  console.warn(
    "[openrouter] OPENROUTER_API_KEY no está definida. Las llamadas al LLM van a fallar."
  );
}

const client = new OpenAI({
  apiKey: apiKey ?? "missing",
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Agente WhatsApp Local",
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
  history: Message[]
): { role: "user" | "assistant"; content: string }[] {
  return history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

export async function generateReply(history: Message[]): Promise<string> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [
      { role: "system", content: SYSTEM_PROMPT },
      ...mapHistory(history),
    ];

  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
  });

  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("LLM devolvió respuesta vacía");
  }
  return reply;
}
