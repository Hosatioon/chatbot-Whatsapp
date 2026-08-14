import {
  type ConversationState,
  type ConversationStateName,
  type DraftItem,
  getConversationState,
  upsertConversationState,
  clearConversationState,
  searchProducts,
} from "./db";

export type { ConversationState, ConversationStateName, DraftItem };

const CONFIRM_WORDS = [
  "confirmo",
  "confirmar",
  "si",
  "sí",
  "dale",
  "ok",
  "esta bien",
  "está bien",
  "perfecto",
  "adelante",
  "hagalo",
  "hazlo",
  "claro",
  "yes",
  "seguro",
];

const CANCEL_WORDS = [
  "cancelar",
  "cancelo",
  "no",
  "nop",
  "nope",
  "mejor no",
  "olvidalo",
  "olvídalo",
  "nada",
  "dejar",
  "cancela",
];

const PAYMENT_KEYWORDS: Record<string, string[]> = {
  transferencia: [
    "transferencia",
    "transferir",
    "transf",
    "nequi",
    "daviplata",
    "bancolombia",
    "cuenta",
    "deposito",
    "pse",
  ],
  efectivo: ["efectivo", "cash", "plata", "contraentrega", "contra entrega"],
};

const ADDRESS_KEYWORDS = [
  "calle",
  "carrera",
  "cra",
  "av",
  "avenida",
  "cll",
  "diagonal",
  "transversal",
  "barrio",
  "conjunto",
  "torre",
  "apto",
  "apartamento",
  "interior",
  "manzana",
  "casa",
  "#",
  "n°",
  "no.",
  "edificio",
  "sector",
  "via",
  "vía",
  "km",
  "vereda",
  "finca",
  "lote",
];

export function isConfirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return CONFIRM_WORDS.some((w) => t === w || t.startsWith(w + " "));
}

export function isCancellation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return CANCEL_WORDS.some((w) => t === w || t.startsWith(w + " "));
}

const DELIVERY_KEYWORDS: Record<string, string[]> = {
  domicilio: [
    "domicilio",
    "envio",
    "envío",
    "entrega",
    "reparto",
    "me lo llevan",
    "lleven",
    "a casa",
  ],
  recoger: [
    "recoger",
    "recojo",
    "paso a buscar",
    "retiro",
    "lo recojo",
    "lo busco",
    "en tienda",
    "ahi mismo",
    "ahí mismo",
    "recogida",
  ],
};

export function detectDeliveryMethod(text: string): string | null {
  const t = text.toLowerCase();
  for (const [method, keywords] of Object.entries(DELIVERY_KEYWORDS)) {
    if (keywords.some((kw) => t.includes(kw))) return method;
  }
  return null;
}

export function detectPaymentMethod(text: string): string | null {
  const t = text.toLowerCase();
  for (const [method, keywords] of Object.entries(PAYMENT_KEYWORDS)) {
    if (keywords.some((kw) => t.includes(kw))) return method;
  }
  return null;
}

export function looksLikeAddress(text: string): boolean {
  const t = text.toLowerCase();
  // Must have at least one address keyword AND some number
  const hasKeyword = ADDRESS_KEYWORDS.some((kw) => t.includes(kw));
  const hasNumber = /\d/.test(t);
  return hasKeyword && hasNumber;
}

export function addToDraft(
  state: ConversationState,
  name: string,
  quantity: number,
  price: number,
): ConversationState {
  const existing = state.draft_items.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    existing.quantity += quantity;
  } else {
    state.draft_items.push({ name, quantity, price });
  }
  return state;
}

export function computeDraftTotal(items: DraftItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function computeStateFromDraft(
  state: ConversationState,
): ConversationState {
  const hasItems = state.draft_items.length > 0;
  const hasDeliveryMethod = !!state.draft_delivery_method;
  const hasAddress = !!state.draft_address;
  const hasPayment = !!state.draft_payment;

  // Only advance from SELECTING_PRODUCTS if the client already provided
  // delivery method, address or payment (meaning they moved forward on their own).
  // Otherwise stay in SELECTING_PRODUCTS so the LLM can ask "¿algo más?"
  if (state.state === "SELECTING_PRODUCTS") {
    if (hasDeliveryMethod || hasAddress || hasPayment) {
      // Client jumped ahead — recompute full state
    } else {
      // Otherwise stay in SELECTING_PRODUCTS
      return state;
    }
  }

  // Recompute based on what's missing
  if (!hasItems) {
    state.state = "SELECTING_PRODUCTS";
  } else if (!hasDeliveryMethod) {
    state.state = "ASKING_DELIVERY_METHOD";
  } else if (state.draft_delivery_method === "domicilio" && !hasAddress) {
    state.state = "ASKING_ADDRESS";
  } else if (!hasPayment) {
    state.state = "ASKING_PAYMENT";
  } else {
    state.state = "WAITING_CONFIRMATION";
  }

  return state;
}

const DONE_WORDS = [
  "nada mas",
  "nada más",
  "eso es todo",
  "es todo",
  "solo eso",
  "no mas",
  "no más",
  "ya",
  "listo",
  "eso es",
  "nada",
  "no quiero mas",
  "no quiero más",
  "eso seria todo",
  "eso sería todo",
  "no gracias",
  "ya no",
  "nada mas gracias",
  "nada más gracias",
  "solo eso gracias",
  "es todo gracias",
  "eso es todo gracias",
  "no nada mas",
  "no nada más",
  "ya estoy listo",
  "ya termine",
  "ya terminé",
  "eso seria",
  "eso sería",
  "no pido mas",
  "no pido más",
  "asi esta bien",
  "así está bien",
  "asi está bien",
  "así esta bien",
  "esta bien",
  "está bien",
  "asi que si",
  "así que sí",
  "dale",
  "perfecto",
  "ok",
  "no asi",
  "no así",
  "no, asi",
  "no, así",
];

export function isDoneSelecting(text: string): boolean {
  const t = text.toLowerCase().trim();
  // Short words must match exactly or with "gracias" suffix only
  const exactWords = [
    "ya",
    "nada",
    "listo",
    "es todo",
    "eso es",
    "ya no",
    "no gracias",
    "ok",
    "dale",
    "perfecto",
    "esta bien",
    "está bien",
    "asi esta bien",
    "así está bien",
  ];
  // Longer phrases can use includes
  const phraseWords = DONE_WORDS.filter((w) => !exactWords.includes(w));

  if (exactWords.some((w) => t === w || t === w + " gracias")) return true;
  return phraseWords.some((w) => t.includes(w));
}

export function getStateForConversation(
  conversationId: number,
  tenantId: number,
): ConversationState {
  return getConversationState(conversationId, tenantId);
}

export function saveState(state: ConversationState): void {
  upsertConversationState(state);
}

export function resetState(conversationId: number): void {
  clearConversationState(conversationId);
}

export function tryAddProductsFromText(
  state: ConversationState,
  text: string,
): { added: boolean; products: { name: string; quantity: number }[] } {
  const t = text.toLowerCase().trim();

  // Split by separators: "y", ",", "también", "y también", ";"
  const parts = t
    .split(/\s+y\s+|\s*,\s*|\s+también\s+|\s+y también\s+|\s*;\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Patterns: "quiero 2 vasca", "dame 1 croissant", "3 galletas de nutella"
  const patterns = [
    /(?:quiero|dame|ponme|me das|me pones|necesito|poné|anotame|anotá|agregame|agregá)\s+(\d+)\s+(?:de\s+)?(.+)/i,
    /(\d+)\s+(?:de\s+)?(.+)/i,
  ];

  const products: { name: string; quantity: number }[] = [];

  for (const part of parts) {
    for (const pattern of patterns) {
      const match = part.match(pattern);
      if (match) {
        const quantity = parseInt(match[1], 10);
        const productName = match[2].trim();
        if (quantity > 0 && quantity < 1000 && productName.length > 2) {
          const results = searchProducts(state.tenant_id, productName, 1);
          if (results.length > 0) {
            const product = results[0];
            addToDraft(state, product.name, quantity, product.price);
            products.push({ name: product.name, quantity });
          }
          break; // Only use first matching pattern per part
        }
      }
    }
  }

  return { added: products.length > 0, products };
}

export function formatDraftForPrompt(state: ConversationState): string {
  const lines: string[] = [];

  if (state.draft_items.length > 0) {
    lines.push("Items:");
    for (const item of state.draft_items) {
      const subtotal = item.price * item.quantity;
      lines.push(
        `  - ${item.quantity}x ${item.name} ($${item.price.toLocaleString("es-CO")} c/u = $${subtotal.toLocaleString("es-CO")})`,
      );
    }
    const total = computeDraftTotal(state.draft_items);
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
