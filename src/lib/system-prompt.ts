import { getTenantById, type Tenant } from "./db";
import type { ConversationState } from "./conversation-state";

const DEFAULT_GREETING = "Hola, ¿en qué te puedo ayudar?";

const BASE_PROMPT_TEMPLATE = `--- IDENTIDAD ---
Eres el asistente de WhatsApp de {BUSINESS_NAME}.
Atiendes como un empleado del negocio, no como IA.
Hablas natural, amable, breve y cálido. Primera persona.
No usas lenguaje corporativo ni frases robóticas.
Nunca digas que eres inteligencia artificial ni uses frases como "Estoy aquí para ayudarte" o "Será un placer".
Si el cliente escribe por primera vez, saludá: "{GREETING}"

--- TU ROL ---
Respondés sobre productos, precios, stock y datos del negocio.
El sistema maneja el flujo del pedido (dirección, pago, confirmación) — no lo hagas vos.
Si el cliente pide algo que no es sobre productos, redirigí amablemente.

--- TOOLS ---
- searchProducts: úsala SIEMPRE que el cliente pregunte por un producto específico.
- getStock: úsala para saber stock disponible. Nunca adivines cantidades.
- getProduct: para ver detalle de un producto específico.
- getBusinessInfo: para horarios, dirección, pagos, links.
- getOrderStatus: úsala cuando el cliente pregunte por su pedido (¿cómo va mi pedido?, ¿ya lo entregaron?, etc).
- La lista de PRODUCTOS PRINCIPALES es solo de nombres. No la uses para responder sobre disponibilidad.

--- REGLAS ---
- Responde breve y directo.
- No hagas varias preguntas al mismo tiempo.
- No repitas información que ya diste.
- Si el cliente pregunta "¿qué tienen?" o "quiero ver el menú", compartí la URL del catálogo.
- Si el cliente se sale del tema, redirigí al negocio.
- Si no entendés algo, pedí aclaración breve.
- Nequi, Daviplata, llaves y breve son todos transferencia. Solo hay dos formas de pago: transferencia o efectivo.
- No confirmes pedidos ni crees órdenes — el sistema lo hace automáticamente.

--- PEDIDO EN CURSO ---
{DRAFT_ORDER}

--- FORMATO ---
Responde SIEMPRE en JSON:
{
  "intent": "chat",
  "reply": "tu respuesta al cliente"
}

--- PAGOS ---
{PAYMENT_SECTION}

--- EJEMPLOS ---
Cliente: "hola"
{"intent": "chat", "reply": "{GREETING}\\n\\nTe dejo el catálogo para que le echés un ojo 👇 {CATALOG_URL}"}

Cliente: "quiero 2 {PRODUCT_EXAMPLE}"
{"intent": "chat", "reply": "¡Buena elección! Anotadas. ¿Querés algo más?"}

Cliente: "tienen {PRODUCT_EXAMPLE}?"
{"intent": "chat", "reply": "Déjame revisar... ¡Sí! Tenemos {PRODUCT_EXAMPLE} a $X. ¿Te anoto?"}`;

export function buildSystemPromptForTenant(
  tenantId: number,
  conversationState?: ConversationState,
): string {
  const tenant = getTenantById(tenantId);

  const businessName = tenant?.business_name || tenant?.name || "este negocio";
  const businessType = tenant?.business_type
    ? ` Eres un negocio de ${tenant.business_type}.`
    : "";
  const greeting = tenant?.custom_greeting || DEFAULT_GREETING;
  const customPrompt = tenant?.custom_prompt;

  const paymentSection = tenant?.payment_info
    ? `${tenant.payment_info}`
    : "Si el cliente quiere pagar por transferencia, pidele el número de cuenta y el comprobante. Si paga en efectivo, confirmá que tenga el monto exacto o devuelta de cuanto.";

  const catalogUrl = tenant?.catalog_url || "";

  const paymentInfo =
    tenant?.payment_info ||
    "(preguntá al cliente por su método de pago preferido)";

  const assistantName = tenant?.assistant_name || "";

  const stateName = conversationState?.state ?? "SELECTING_PRODUCTS";

  const draftOrder = conversationState
    ? formatDraftForPrompt(conversationState)
    : "Items: (vacío)\nEntrega: (pendiente)\nDirección: (pendiente)\nPago: (pendiente)";

  let prompt = BASE_PROMPT_TEMPLATE.replace(/{BUSINESS_NAME}/g, businessName)
    .replace(/{GREETING}/g, greeting)
    .replace(/{PAYMENT_SECTION}/g, paymentSection)
    .replace(/{PAYMENT_INFO}/g, paymentInfo)
    .replace(/{PRODUCT_EXAMPLE}/g, "producto del catálogo")
    .replace(/{CATALOG_URL}/g, catalogUrl)
    .replace(/{ASSISTANT_NAME}/g, assistantName)
    .replace(/{CONVERSATION_STATE}/g, stateName)
    .replace(/{DRAFT_ORDER}/g, draftOrder);

  if (businessType) {
    prompt = prompt.replace(
      "Eres el asistente de WhatsApp de",
      `Eres el asistente de WhatsApp de${businessType}\nEres el asistente de WhatsApp de`,
    );
  }

  const contextLines: string[] = [];

  if (tenant?.assistant_name) {
    contextLines.push(`Te llamas ${tenant.assistant_name}.`);
  }

  if (tenant?.business_address) {
    contextLines.push(`Dirección del negocio: ${tenant.business_address}`);
  }

  if (tenant?.business_hours) {
    try {
      const hours = JSON.parse(tenant.business_hours);
      if (
        hours.enabled &&
        Array.isArray(hours.days) &&
        hours.open &&
        hours.close
      ) {
        const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        const days = hours.days.map((d: number) => dayNames[d] ?? d).join(", ");
        contextLines.push(
          `Horario de atención: ${days} de ${hours.open} a ${hours.close}`,
        );
      }
    } catch {
      // ignore
    }
  }

  if (tenant?.catalog_url) {
    contextLines.push(`URL del catálogo: ${tenant.catalog_url}`);
  }

  if (contextLines.length > 0) {
    prompt += `\n\n--- INFORMACIÓN DEL NEGOCIO ---\n${contextLines.join("\n")}`;
  }

  if (customPrompt) {
    prompt += `\n\n--- INSTRUCCIONES PERSONALIZADAS ---\n${customPrompt}`;
  }

  return prompt;
}

function formatDraftForPrompt(state: ConversationState): string {
  const lines: string[] = [];

  if (state.draft_items.length > 0) {
    lines.push("Items:");
    for (const item of state.draft_items) {
      const subtotal = item.price * item.quantity;
      lines.push(
        `  - ${item.quantity}x ${item.name} ($${item.price.toLocaleString("es-CO")} c/u = $${subtotal.toLocaleString("es-CO")})`,
      );
    }
    const total = state.draft_items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    lines.push(`  Total: $${total.toLocaleString("es-CO")}`);
  } else {
    lines.push("Items: (vacío)");
  }

  lines.push(`Entrega: ${state.draft_delivery_method ?? "(pendiente)"}`);
  lines.push(
    `Dirección: ${state.draft_delivery_method === "recoger" ? "(recoge en tienda)" : (state.draft_address ?? "(pendiente)")}`,
  );
  lines.push(`Pago: ${state.draft_payment ?? "(pendiente)"}`);

  return lines.join("\n");
}

export { DEFAULT_GREETING };
