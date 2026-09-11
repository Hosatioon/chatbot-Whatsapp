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
  "cancela",
  "cancelen",
  "mejor no",
  "olvidalo",
  "olvídalo",
  "olvídelo",
  "dejar",
  "déjalo",
  "dejalo",
  "no quiero nada",
  "cancelen el pedido",
  "cancelar pedido",
];

const PAYMENT_KEYWORDS: Record<string, string[]> = {
  transferencia: [
    "transferencia",
    "transaferencia",
    "trasferencia",
    "transferir",
    "transf",
    "transa",
    "trasf",
    "nequi",
    "daviplata",
    "bancolombia",
    "cuenta",
    "deposito",
    "pse",
    "transfer",
    "banco",
  ],
  efectivo: [
    "efectivo",
    "cash",
    "plata",
    "contraentrega",
    "contra entrega",
    "efectiv",
  ],
};

const ADDRESS_KEYWORDS = [
  "calle",
  "carrera",
  "avenida",
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
  "km",
  "vereda",
  "finca",
  "lote",
];

const ADDRESS_KEYWORDS_SHORT = ["av", "cra", "cll", "via", "vía"];

const CONFIRM_FIRST_WORDS = new Set([
  "si",
  "sii",
  "sip",
  "sisas",
  "dale",
  "ok",
  "okay",
  "okey",
  "bueno",
  "va",
  "claro",
  "porfa",
  "confirmo",
  "confirmar",
  "confirmado",
  "confirmada",
  "perfecto",
  "adelante",
  "hagale",
  "hazlo",
  "hagalo",
  "listo",
  "yes",
  "seguro",
]);

export function isConfirmation(text: string): boolean {
  // Normaliza: minúsculas, sin tildes, sin signos de puntuación
  const t = normalizeText(text)
    .replace(/[.,!¡¿?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  // "no" como palabra invalida la confirmación ("sí pero no", "seguro que no")
  if (/(^|\s)no(\s|$)/.test(t)) return false;
  const first = t.split(" ")[0];
  if (CONFIRM_FIRST_WORDS.has(first)) return true;
  return CONFIRM_WORDS.some((w) => {
    const n = normalizeText(w);
    return t === n || t.startsWith(n + " ");
  });
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
  const hasNumber = /\d/.test(t);
  if (!hasNumber) return false;
  const hasKeyword = ADDRESS_KEYWORDS.some((kw) => t.includes(kw));
  if (hasKeyword) return true;
  const hasShortKeyword = ADDRESS_KEYWORDS_SHORT.some((kw) =>
    new RegExp(`\\b${kw}\\b`).test(t),
  );
  return hasShortKeyword;
}

export { searchProducts };

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

  // Si estamos en SELECTING_PRODUCTS y hay items, permitir avanzar
  // cuando se hayan agregado datos de entrega/pago/dirección.
  // El cliente sale de selección de productos cuando dice "nada más" etc,
  // pero los tools pueden haber agregado datos de entrega que deben reflejarse.
  if (state.state === "SELECTING_PRODUCTS" && hasItems) {
    // Si hay método de entrega o pago, el cliente ya avanzó — recalcular
    if (hasDeliveryMethod || hasPayment) {
      // caer al flujo normal de abajo
    } else {
      return state;
    }
  }

  // Si hay dirección pero no hay método de entrega, inferir domicilio
  if (hasAddress && !hasDeliveryMethod) {
    state.draft_delivery_method = "domicilio";
    return computeStateFromDraft(state);
  }

  // Recompute based on what's missing
  if (!hasItems) {
    state.state = "SELECTING_PRODUCTS";
  } else if (!hasDeliveryMethod) {
    state.state = "ASKING_DELIVERY_METHOD";
  } else if (state.draft_delivery_method === "domicilio") {
    if (!hasAddress) {
      state.state = "ASKING_ADDRESS";
    } else if (!hasPayment) {
      state.state = "ASKING_PAYMENT";
    } else {
      state.state = "WAITING_CONFIRMATION";
    }
  } else if (!hasPayment) {
    // recoger: skip zone and address
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
    "no",
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
  const state = getConversationState(conversationId, tenantId);
  // Expirar drafts abandonados: si el estado tiene datos de pedido y no se
  // ha tocado en DRAFT_TTL_MINUTES, resetear para no contaminar conversaciones nuevas
  const ttlMinutes = parseInt(process.env.DRAFT_TTL_MINUTES || "60", 10) || 60;
  const now = Math.floor(Date.now() / 1000);
  const hasDraftData =
    state.draft_items.length > 0 ||
    state.draft_payment ||
    state.draft_delivery_method ||
    state.draft_address;
  if (hasDraftData && now - state.updated_at > ttlMinutes * 60) {
    console.log(
      `[state] Draft de conversación ${conversationId} expirado (${ttlMinutes}min), reseteando`,
    );
    clearConversationState(conversationId);
    return getConversationState(conversationId, tenantId);
  }
  return state;
}

export function saveState(state: ConversationState): void {
  upsertConversationState(state);
}

export function resetState(conversationId: number): void {
  clearConversationState(conversationId);
}

const WORD_NUMBERS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
};

const LEADING_VERBS =
  /^(?:quiero|dame|ponme|me das|me pones|necesito|ponga|anoteme|anote|agregueme|agregue|me regalas|regaleme|envieme|mande|busqueme|traeme|llevar|llévame|comprar|vamos a|vamo a|deseo|solicito|pido|pedir)\s+/i;

function cleanProductName(raw: string): string {
  let s = raw.trim();
  // Quitar "de " inicial sobrante ("de maracuya" → "maracuya")
  s = s.replace(/^de\s+/i, "");
  // Quitar conectores finales sueltos ("y", "también", "gracias", "por favor")
  s = s.replace(/\s+(?:y|también|gracias|por favor|porfa|pls|please)$/i, "");
  // Quitar "galleta(s) de" → dejar el sabor ("galletas de maracuya" → "maracuya")
  // solo si queda muy corto sin eso, sino dejar completo
  return s.trim();
}

export function tryAddProductsFromText(
  state: ConversationState,
  text: string,
): { added: boolean; products: { name: string; quantity: number }[] } {
  let t = text.toLowerCase().trim();
  // Quitar verbos iniciales
  t = t.replace(LEADING_VERBS, "");

  // Tokenizar: encontrar todas las posiciones de cantidades
  // (dígitos o palabras-número) y dividir el texto en segmentos
  // cada uno con [cantidad, nombre_del_producto]
  const qtyRegex =
    /(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta)\b/gi;

  interface Segment {
    quantity: number;
    name: string;
  }

  const segments: Segment[] = [];
  const matches: { index: number; quantity: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = qtyRegex.exec(t)) !== null) {
    const word = m[1].toLowerCase();
    const qty = /^\d+$/.test(word)
      ? parseInt(word, 10)
      : (WORD_NUMBERS[word] ?? 0);
    if (qty > 0 && qty < 1000) {
      matches.push({ index: m.index, quantity: qty, length: m[0].length });
    }
  }

  if (matches.length === 0) return { added: false, products: [] };

  for (let i = 0; i < matches.length; i++) {
    const nameStart = matches[i].index + matches[i].length;
    const nameEnd = i + 1 < matches.length ? matches[i + 1].index : t.length;
    let rawName = t.slice(nameStart, nameEnd).trim();
    // Quitar separadores "y", ",", "también" al final del segmento
    rawName = rawName.replace(/[\s,;]+(?:y|también|tambien)\s*$/i, "");
    rawName = rawName.replace(/[,;]+$/g, "").trim();
    if (rawName.length < 2) continue;
    segments.push({
      quantity: matches[i].quantity,
      name: cleanProductName(rawName),
    });
  }

  const products: { name: string; quantity: number }[] = [];

  for (const seg of segments) {
    if (seg.name.length < 2) continue;
    const results = searchProducts(state.tenant_id, seg.name, 1);
    if (results.length > 0) {
      const product = results[0];
      addToDraft(state, product.name, seg.quantity, product.price);
      products.push({ name: product.name, quantity: seg.quantity });
    }
  }

  return { added: products.length > 0, products };
}

const ACCEPTANCE_PATTERN =
  /^(sí|si|dale|ok|okay|okey|bueno|va|de una|claro|porfa|por favor|hagale|hágale)\b/i;

const EXPLICIT_CLOSING = [
  "eso es todo",
  "nada mas",
  "nada más",
  "es todo",
  "solo eso",
  "eso seria todo",
  "eso sería todo",
  "eso seria",
  "eso sería",
  "no gracias",
  "ya estoy",
  "ya termine",
  "ya terminé",
];

export function isMereAcceptance(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    ACCEPTANCE_PATTERN.test(t) && !EXPLICIT_CLOSING.some((c) => t.includes(c))
  );
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Cuando el cliente acepta una oferta del bot ("sí por favor", "dale") sin
// nombrar el producto, lo buscamos en el último mensaje del assistant.
export function tryAddProductFromLastOffer(
  state: ConversationState,
  userText: string,
  lastAssistantText: string | null,
): { added: boolean; product?: string } {
  if (!lastAssistantText) return { added: false };
  if (!ACCEPTANCE_PATTERN.test(userText.trim())) return { added: false };

  const normOffer = normalizeText(lastAssistantText);
  const allProducts = searchProducts(state.tenant_id, "", 500);
  const match = allProducts
    .filter((p) => p.name.length > 2)
    .sort((a, b) => b.name.length - a.name.length)
    .find((p) => normOffer.includes(normalizeText(p.name)));
  if (!match) return { added: false };

  const numMatch = userText.match(/(\d+)/);
  const quantity = numMatch ? Math.min(parseInt(numMatch[1], 10), 99) : 1;
  addToDraft(state, match.name, quantity > 0 ? quantity : 1, match.price);
  return { added: true, product: match.name };
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
