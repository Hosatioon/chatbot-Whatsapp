import {
  type LatLng,
  type GeoCandidate,
  searchNominatim,
  searchPhoton,
  normalizeAddressForGeocoding,
  haversineKm,
  cleanDisplayName,
} from "./geo";
import {
  findKnownPlaces,
  upsertKnownPlace,
  incrementKnownPlaceUsage,
  getCustomerAddress,
  type KnownPlace,
} from "./db";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ResolutionStatus =
  | "resolved"
  | "ambiguous"
  | "not_found"
  | "saved_suggestion";

export interface ResolutionCandidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface Resolution {
  status: ResolutionStatus;
  reference: string;
  details?: string;
  lat?: number;
  lng?: number;
  source?: "known_place" | "geo" | "saved";
  // Solo aplica cuando source="known_place": si el lugar se aprendió de un
  // pedido real confirmado ("confirmed", alta confianza, no hace falta
  // reconfirmar) o vino de una carga masiva de datos oficiales/OSM sin
  // verificar ("bulk_import", puede ser ambiguo o estar mal — sí hay que
  // confirmar con el cliente antes de avanzar, igual que una búsqueda
  // ambigua normal).
  knownPlaceSource?: "confirmed" | "bulk_import";
  resolvedName?: string;
  candidates?: ResolutionCandidate[];
  savedAddress?: string;
}

// ---------------------------------------------------------------------------
// Extracción de detalles (torre, apartamento, etc.)
// ---------------------------------------------------------------------------

const DETAIL_PATTERNS: RegExp[] = [
  /\btorre\s+\w+\b/gi,
  /\bapto\b\.?\s+\w+/gi,
  /\bapartamento\s+\w+\b/gi,
  /\bapartaestudio\s+\w+\b/gi,
  /\bbloque\s+\w+\b/gi,
  /\bcasa\s+\w+\b/gi,
  /\binterior\s+\w+\b/gi,
  /\bint\b\.?\s+\w+/gi,
  /\bpiso\s+\w+\b/gi,
  /\blocal\s+\w+\b/gi,
  /\boficina\s+\w+\b/gi,
  /\bconsultorio\s+\w+\b/gi,
  /\bbodega\s+\w+\b/gi,
  /\bmanzana\s+\w+\b/gi,
  /\bmz\b\.?\s+\w+/gi,
  /\bmza\b\.?\s+\w+/gi,
  /\blote\s+\w+\b/gi,
  /\betapa\s+\w+\b/gi,
  /\bsector\s+\w+\b/gi,
  /\bunidad\s+\w+\b/gi,
  /\bkm\s*\.?\s*\d+(?:[.,]\d+)?\b/gi,
  /\b(?:primer|segundo|tercer|cuarto|quinto|sexto|s[eé]ptimo|octavo|noveno|d[eé]cimo)\s+piso\b/gi,
  /\b\d+(?:ro|er|to|mo)?\s+piso\b/gi,
];

// Patrones de referencia relativa: "al lado de X", "frente a Y"
const RELATIVE_PATTERNS: RegExp[] = [
  /\b(?:al\s+lado\s+de(?:l)?|frente\s+a|al\s+frente\s+de(?:l)?|cerca\s+de|cerca\s+a|detr[áa]s\s+de|diagonal\s+a|junto\s+a|pegado\s+a)\s+[\w\sáéíóúÁÉÍÓÚñÑüÜ]+/gi,
];

// Prefijos de tipo de lugar que OSM casi nunca tiene en el nombre
// Incluye tipos de lugar comunes ("colegio", "iglesia", "banco"...) además
// de los conjuntos/urbanizaciones que ya cubría. Consume también un
// artículo que venga justo después ("la", "el"...) — así "colegio la
// boyacá" produce la variante "boyacá" directamente, que es la parte que
// de verdad distingue el lugar, en vez de solo "la boyacá".
const PLACE_TYPE_PREFIXES =
  /^(?:conjunto\s+residencial|conjunto|urbanizaci[oó]n|urb|condominio|cond|centro\s+comercial|c\.?c\.?|edificio|edif|barrio|residencias|plaza|unidad\s+residencial|parque\s+industrial|sector|colegio|escuela|instituto|universidad|iglesia|catedral|capilla|hospital|cl[ií]nica|hotel|banco|supermercado|restaurante|farmacia|droguer[ií]a|estaci[oó]n|terminal)\s+(?:la\s+|el\s+|los\s+|las\s+)?/i;

// Relleno con el que la gente suele empezar a describir dónde vive ("es en
// tal barrio", "queda en X", "vivo en Y") y que no aporta nada a la
// búsqueda. Caso real que motivó esto: "en san fernando cuba" sin limpiar
// mandaba a Nominatim la palabra "en" pegada, y como no encontraba nada con
// el texto completo, el recorte progresivo terminaba buscando solo "en san"
// — que Nominatim interpretaba como texto libre y devolvía negocios random
// que tenían la palabra "en" en el nombre (ej: "Publicidad en Pereira").
const LEADING_FILLER =
  /^(?:es\s+en|es\s+para|queda\s+en|vivo\s+en|vivimos\s+en|estoy\s+en|mi\s+direcci[oó]n\s+es|la\s+direcci[oó]n\s+es|direcci[oó]n\s*:?|en)\s+/i;

export function extractDetails(rawText: string): {
  reference: string;
  details: string | null;
  relativeAnchor?: string;
} {
  let cleaned = rawText.replace(LEADING_FILLER, "").trim();
  const extractedParts: string[] = [];
  let relativeAnchor: string | undefined;

  // Extraer referencias relativas ("al lado de X", "frente a Y")
  for (const pattern of RELATIVE_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      for (const m of matches) {
        extractedParts.push(m.trim());
        // Extraer el ancla (lo que viene después de la preposición)
        const anchorMatch = m.match(/(?:de(?:l)?|a)\s+(.+)/i);
        if (anchorMatch && anchorMatch[1].trim().length > 2) {
          relativeAnchor = anchorMatch[1].trim();
        }
      }
    }
  }
  for (const pattern of RELATIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  for (const pattern of DETAIL_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      for (const m of matches) {
        extractedParts.push(m.trim());
      }
    }
  }

  // Remove matched patterns from reference
  for (const pattern of DETAIL_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  // Also remove standalone numbers that look like apt numbers (after removing patterns)
  // But only if we already extracted some details
  if (extractedParts.length > 0) {
    // Clean up extra spaces
    cleaned = cleaned.replace(/\s+/g, " ").trim();
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const details = extractedParts.length > 0 ? extractedParts.join(", ") : null;

  // Si la referencia quedó vacía pero hay un ancla relativa, usar el ancla
  if (cleaned.length === 0 && relativeAnchor) {
    cleaned = relativeAnchor;
  }

  return { reference: cleaned, details, relativeAnchor };
}

// ---------------------------------------------------------------------------
// Normalización de texto para comparación
// ---------------------------------------------------------------------------

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// Palabras genéricas de tipo de lugar y conectores que NO distinguen un
// lugar de otro. BUG real encontrado (2026-09-10): el cliente escribió
// "colegio la boyacá" y el bot resolvió a "Colegio La Enseñanza" — un
// colegio totalmente distinto al otro lado de la ciudad — porque
// similarityScore contaba "colegio" y "la" como coincidencias válidas,
// dándole una similitud alta aunque la única palabra que de verdad
// distingue el lugar ("boyacá") no aparecía en ningún candidato. Se usa
// para exigir que al menos una palabra específica realmente coincida
// antes de confiar en un candidato.
const GENERIC_LOCATION_WORDS = new Set([
  "la",
  "el",
  "los",
  "las",
  "de",
  "del",
  "en",
  "con",
  "para",
  "y",
  "a",
  "al",
  "un",
  "una",
  "colegio",
  "escuela",
  "universidad",
  "instituto",
  "iglesia",
  "catedral",
  "capilla",
  "hospital",
  "clinica",
  "hotel",
  "parque",
  "plaza",
  "centro",
  "comercial",
  "barrio",
  "sector",
  "conjunto",
  "residencial",
  "urbanizacion",
  "condominio",
  "unidad",
  "edificio",
  "supermercado",
  "banco",
  "restaurante",
  "farmacia",
  "drogueria",
  "estacion",
  "terminal",
]);

function significantTokens(s: string): string[] {
  return tokenize(s).filter((t) => !GENERIC_LOCATION_WORDS.has(t));
}

// Zona de operación real de este bot (Pereira/Dosquebradas, Risaralda). Un
// candidato de geocodificación cuya jerarquía completa no menciona nada de
// esto casi seguro es un homónimo de otro departamento (ver bug de
// "boyaca carrera 5 con 21" arriba) — se descarta aunque la distancia en
// línea recta haya pasado el filtro de radio.
const SAME_REGION_HINTS = ["risaralda", "dosquebradas", "pereira"];

function looksLikeSameRegion(displayName: string): boolean {
  const n = normalizeText(displayName);
  return SAME_REGION_HINTS.some((h) => n.includes(h));
}

function similarityScore(query: string, candidateName: string): number {
  const qTokens = tokenize(query);
  const cTokens = tokenize(candidateName);
  if (qTokens.length === 0 || cTokens.length === 0) return 0;

  let matches = 0;
  for (const qt of qTokens) {
    if (cTokens.some((ct) => ct === qt || ct.includes(qt) || qt.includes(ct))) {
      matches++;
    }
  }
  return matches / qTokens.length;
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) intersection++;
  }
  const union = aTokens.size + bTokens.size - intersection;
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Generación de variantes de búsqueda
// ---------------------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  cra: "carrera",
  cr: "carrera",
  kr: "carrera",
  kra: "carrera",
  cl: "calle",
  cll: "calle",
  av: "avenida",
  avda: "avenida",
  diag: "diagonal",
  dg: "diagonal",
  transv: "transversal",
  tv: "transversal",
  trv: "transversal",
  circ: "circunvalar",
};

function expandAbbreviations(text: string): string {
  let result = text;
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const re = new RegExp(`\\b${abbr}\\b`, "gi");
    result = result.replace(re, full);
  }
  return result;
}

function generateSearchVariants(
  reference: string,
  relativeAnchor?: string,
): string[] {
  const variants: string[] = [reference];

  // Variante sin prefijo de tipo de lugar
  const withoutPrefix = reference.replace(PLACE_TYPE_PREFIXES, "").trim();
  if (withoutPrefix !== reference && withoutPrefix.length > 2) {
    variants.push(withoutPrefix);
  }

  // Variante con abreviaciones expandidas
  const expanded = expandAbbreviations(reference);
  if (expanded !== reference) {
    variants.push(expanded);
  }

  // Variante sin prefijo + abreviaciones expandidas
  const expandedNoPrefix = expandAbbreviations(withoutPrefix);
  if (expandedNoPrefix !== withoutPrefix && expandedNoPrefix !== expanded) {
    variants.push(expandedNoPrefix);
  }

  // Variante del ancla relativa (si existe)
  if (relativeAnchor && relativeAnchor.length > 2) {
    variants.push(relativeAnchor);
  }

  // Deduplicar preservando orden
  return [...new Set(variants)];
}

// ---------------------------------------------------------------------------
// Deduplicación de candidatos
// ---------------------------------------------------------------------------

function deduplicateCandidates(
  candidates: GeoCandidate[],
  origin: LatLng,
): GeoCandidate[] {
  const result: GeoCandidate[] = [];
  for (const c of candidates) {
    const isDup = result.some((r) => {
      const dist = haversineKm(
        { lat: r.lat, lng: r.lng },
        { lat: c.lat, lng: c.lng },
      );
      // Same place if within 0.3km AND high token overlap (Jaccard >= 0.5)
      // This catches candidates with same components in different order
      const nameJaccard = jaccardSimilarity(r.name, c.name);
      const displayJaccard = jaccardSimilarity(r.displayName, c.displayName);
      const nameSim = nameJaccard >= 0.5 || displayJaccard >= 0.5;
      return dist < 0.3 && nameSim;
    });
    if (!isDup) result.push(c);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resolver dirección de entrega
// ---------------------------------------------------------------------------

export async function resolveDeliveryAddress(
  tenantId: number,
  rawText: string,
  origin: LatLng,
  customerPhone?: string,
  maxKm: number = 15,
): Promise<Resolution> {
  // 1. Extraer referencia y detalles
  const { reference, details, relativeAnchor } = extractDetails(rawText);
  console.log(
    `[resolver] raw="${rawText}" → reference="${reference}", details="${details}"${relativeAnchor ? `, anchor="${relativeAnchor}"` : ""}`,
  );

  // 2. Buscar en lugares conocidos del tenant
  const knownMatches = findKnownPlaces(tenantId, reference);
  if (knownMatches.length === 1) {
    const known = knownMatches[0];
    console.log(
      `[resolver] known_place hit: "${known.name}" (${known.lat}, ${known.lng})`,
    );
    incrementKnownPlaceUsage(known.id);
    return {
      status: "resolved",
      reference: known.name,
      details: details ?? undefined,
      lat: known.lat,
      lng: known.lng,
      source: "known_place",
      knownPlaceSource: known.source,
      resolvedName: known.name,
    };
  }
  if (knownMatches.length > 1) {
    // Ambigüedad real: 2+ lugares guardados matchean el mismo texto del
    // cliente pero están en coordenadas distintas (caso real: el cliente
    // escribió "arboleda" y en la DB hay "CONJUNTO RESIDENCIAL LA
    // ARBOLEDA", "CONDOMINIO ARBOLEDA DEL RIO" y "CONDOMINIO NUEVA
    // ARBOLEDA" — se quedó con el primero por orden de uso y el domicilio
    // se mandó al lugar equivocado). Nunca hay que adivinar cuál es, EXCEPTO
    // si el cliente escribió exactamente el nombre guardado de uno de
    // ellos — ahí no hay ambigüedad posible.
    const refNorm = normalizeText(reference);
    const exactOne = knownMatches.find(
      (k) => normalizeText(k.name) === refNorm,
    );
    if (exactOne) {
      console.log(
        `[resolver] known_place hit exacto entre ${knownMatches.length} candidatos ambiguos: "${exactOne.name}"`,
      );
      incrementKnownPlaceUsage(exactOne.id);
      return {
        status: "resolved",
        reference: exactOne.name,
        details: details ?? undefined,
        lat: exactOne.lat,
        lng: exactOne.lng,
        source: "known_place",
        knownPlaceSource: exactOne.source,
        resolvedName: exactOne.name,
      };
    }
    // Ninguno de los guardados coincide exacto. Ojo: esto NO significa que
    // el cliente quiso decir alguno de ellos — caso real: "arboleda" solo
    // matcheaba conjuntos/condominios residenciales del bulk-import, pero
    // el cliente en realidad se refería al Centro Comercial Arboleda, un
    // lugar real y conocido que ni siquiera estaba guardado en la DB. Por
    // eso también buscamos en el mapa (Nominatim/Photon) con el mismo
    // texto y combinamos ambas fuentes — así el cliente elige entre TODAS
    // las opciones reales, no solo las que teníamos guardadas.
    console.log(
      `[resolver] known_place ambiguo para "${reference}": ${knownMatches.map((k) => k.name).join(" | ")} — buscando también en el mapa`,
    );
    // Usar la misma limpieza de texto que el flujo de geocodificación
    // normal (quita prefijos de tipo de lugar, expande abreviaciones) en
    // vez de mandar `reference` crudo — si no, un texto con relleno al
    // inicio ("en tal parte") puede arruinar la búsqueda por completo.
    const geoQuery =
      generateSearchVariants(reference).flatMap((v) =>
        normalizeAddressForGeocoding(v),
      )[0] ?? reference;
    let geoExtra: GeoCandidate[] = [];
    try {
      geoExtra = await searchNominatim(geoQuery, 5, origin, maxKm);
      if (geoExtra.length === 0) {
        geoExtra = await searchPhoton(geoQuery, 5, origin, maxKm);
      }
    } catch {
      // si falla la búsqueda en el mapa, seguimos solo con lo guardado
    }
    // Combinar ambas fuentes y ordenar por distancia real al negocio — un
    // lugar guardado que queda lejos no debería tapar uno del mapa que
    // está mucho más cerca y es más probable que sea el que el cliente
    // quiso decir. Se deduplica por proximidad (<0.3km = mismo lugar).
    type ScoredCandidate = ResolutionCandidate & { dist: number };
    const merged: ScoredCandidate[] = [];
    for (const k of knownMatches) {
      merged.push({
        name: k.name,
        address: k.name,
        lat: k.lat,
        lng: k.lng,
        dist: haversineKm(origin, { lat: k.lat, lng: k.lng }),
      });
    }
    for (const g of geoExtra) {
      const tooClose = merged.some(
        (c) => haversineKm({ lat: c.lat, lng: c.lng }, { lat: g.lat, lng: g.lng }) < 0.3,
      );
      if (!tooClose) {
        merged.push({
          name: g.name,
          address: cleanDisplayName(g.displayName),
          lat: g.lat,
          lng: g.lng,
          dist: haversineKm(origin, { lat: g.lat, lng: g.lng }),
        });
      }
    }
    merged.sort((a, b) => a.dist - b.dist);
    const candidates: ResolutionCandidate[] = merged
      .slice(0, 5)
      .map(({ dist: _dist, ...c }) => c);
    return {
      status: "ambiguous",
      reference,
      details: details ?? undefined,
      candidates,
    };
  }

  // 3. Buscar dirección guardada del cliente
  if (customerPhone) {
    const saved = getCustomerAddress(tenantId, customerPhone);
    if (saved) {
      const refNorm = normalizeText(reference);
      const savedRefNorm = normalizeText(saved.reference);
      const isGeneric =
        refNorm.includes("siempre") ||
        refNorm.includes("lo mismo") ||
        refNorm.includes("el de siempre") ||
        refNorm.includes("la de siempre");

      // Check if the reference matches the saved address reference
      const matchesSaved =
        isGeneric ||
        savedRefNorm.includes(refNorm) ||
        (refNorm.length > 3 && refNorm.includes(savedRefNorm)) ||
        similarityScore(reference, saved.reference) > 0.6;

      if (matchesSaved) {
        console.log(
          `[resolver] saved_address hit: "${saved.address}" for ${customerPhone}`,
        );
        return {
          status: "saved_suggestion",
          reference: saved.reference,
          details: details ?? undefined,
          lat: saved.lat,
          lng: saved.lng,
          source: "saved",
          savedAddress: saved.address,
        };
      }
    }
  }

  // 4. Buscar en Nominatim y Photon
  // Generar variantes: sin prefijo de tipo, abreviaciones expandidas, ancla relativa
  const searchVariants = generateSearchVariants(reference, relativeAnchor);
  // Además aplicar normalizeAddressForGeocoding a cada variante (quita #, números)
  const variants: string[] = [];
  for (const v of searchVariants) {
    for (const nv of normalizeAddressForGeocoding(v)) {
      if (!variants.includes(nv)) variants.push(nv);
    }
  }
  console.log(
    `[resolver] variantes de búsqueda: ${variants.map((v) => `"${v}"`).join(", ")}`,
  );
  let allCandidates: GeoCandidate[] = [];

  for (const q of variants) {
    const nominatimResults = await searchNominatim(q, 5, origin, maxKm);
    allCandidates.push(...nominatimResults);
    if (allCandidates.length >= 5) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Si Nominatim no encontró suficiente, intentar con Photon
  if (allCandidates.length < 3) {
    for (const q of variants) {
      const photonResults = await searchPhoton(q, 5, origin, maxKm);
      allCandidates.push(...photonResults);
      if (allCandidates.length >= 8) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Fallback progresivo: si aún no hay candidatos, simplificar la referencia
  // quitando palabras de atrás para adelante (como lo haría un humano)
  if (allCandidates.length === 0) {
    const refWords = reference.split(/\s+/).filter((w) => w.length > 0);
    const fallbacks: string[] = [];
    for (let n = Math.min(3, refWords.length - 1); n >= 1; n--) {
      const shorter = refWords.slice(0, n).join(" ");
      if (shorter.length > 3 && !fallbacks.includes(shorter)) {
        fallbacks.push(shorter);
      }
    }
    for (const q of fallbacks) {
      console.log(`[resolver] fallback progresivo: "${q}"`);
      const nominatimResults = await searchNominatim(q, 5, origin, maxKm);
      allCandidates.push(...nominatimResults);
      if (allCandidates.length >= 5) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (allCandidates.length < 3) {
      for (const q of fallbacks) {
        const photonResults = await searchPhoton(q, 5, origin, maxKm);
        allCandidates.push(...photonResults);
        if (allCandidates.length >= 8) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  // Deduplicar
  allCandidates = deduplicateCandidates(allCandidates, origin);

  if (allCandidates.length === 0) {
    console.log(`[resolver] not_found para "${reference}"`);
    return {
      status: "not_found",
      reference,
      details: details ?? undefined,
    };
  }

  // 5. Decisión
  if (allCandidates.length === 1) {
    const c = allCandidates[0];
    console.log(`[resolver] resolved (1 candidate): "${c.name}"`);
    return {
      status: "resolved",
      reference: c.name,
      details: details ?? undefined,
      lat: c.lat,
      lng: c.lng,
      source: "geo",
      resolvedName: cleanDisplayName(c.displayName),
    };
  }

  // 2+ candidates: try deterministic disambiguation
  // Score each candidate by similarity + distance
  // La similitud se mide primero contra el NOMBRE del lugar. Solo cuando
  // ese nombre ya matchea razonablemente (>= 0.5 — típico de homónimos
  // reales, ej. dos lugares que se llaman literalmente "San Fernando") se
  // deja que la jerarquía completa (displayName) sume más, para que un
  // calificador extra del cliente ("...CUBA") desempate a favor del que
  // sí queda en ese sector. Si el nombre NO matchea bien, la jerarquía se
  // ignora — si no, un negocio cualquiera que simplemente queda cerca de
  // un landmark conocido (ej: "Frenos Pereira" a media cuadra de la Plaza
  // de Bolívar, con "Sector Plaza de Bolivar" en su dirección) le ganaba
  // al landmark real solo por compartir esas palabras en la jerarquía.
  const scored = allCandidates.map((c) => {
    const simName = similarityScore(reference, c.name);
    const simDisplay = similarityScore(reference, c.displayName);
    const sim = simName >= 0.5 ? Math.max(simName, simDisplay) : simName;
    const dist = haversineKm(origin, { lat: c.lat, lng: c.lng });
    return { candidate: c, sim, dist };
  });
  scored.sort((a, b) => b.sim - a.sim || a.dist - b.dist);

  // BUG real encontrado (2026-09-10): direcciones con nomenclatura completa
  // ("Calle 8 N°31-177", "Cra 15 #20-30 barrio cuba") casi nunca están bien
  // indexadas en Nominatim para Pereira/Dosquebradas — al quitar el número
  // de casa para poder buscar, Nominatim devuelve resultados que solo
  // comparten UNA palabra genérica ("calle 8", "cuba") con lo que escribió
  // el cliente (ej: una estación de policía, una caseta comunal de OTRO
  // barrio). Antes se ofrecían igual como "opciones" — mostrarle al
  // cliente 3 lugares que no tienen nada que ver es peor que decirle
  // directamente que no se pudo ubicar y pedirle la ubicación por GPS.
  const MIN_CANDIDATE_SIM = 0.34;
  // Además del umbral de similitud, exigir que al menos una palabra
  // ESPECÍFICA de lo que escribió el cliente (no un tipo de lugar
  // genérico como "colegio" ni un conector como "la") realmente aparezca
  // en el candidato — si no, un candidato puede pasar el umbral solo por
  // coincidencias genéricas sin tener nada que ver con el lugar real.
  const refSignificant = significantTokens(reference);
  const plausible = scored.filter((s) => {
    if (s.sim < MIN_CANDIDATE_SIM) return false;
    // BUG real encontrado (2026-09-11): "boyaca carrera 5 con 21" (el
    // cliente se refería al barrio Boyacá de Pereira, que no está mapeado)
    // coincidió con una dirección real pero en Ulloa, Valle del Cauca — a
    // solo 12.5km en línea recta (pasaba el radio) pero en OTRO
    // departamento. El bot le dijo al cliente que su dirección estaba
    // "fuera de zona" cuando en realidad nunca buscó en el lugar correcto.
    // Un domicilio en Pereira/Dosquebradas nunca debería resolver a otro
    // departamento aunque la distancia en línea recta pase el filtro.
    if (!looksLikeSameRegion(s.candidate.displayName)) return false;
    if (refSignificant.length === 0) return true; // el cliente solo dio algo genérico
    const candTokens = new Set([
      ...significantTokens(s.candidate.name),
      ...significantTokens(s.candidate.displayName),
    ]);
    return refSignificant.some((qt) =>
      [...candTokens].some((ct) => ct === qt || ct.includes(qt) || qt.includes(ct)),
    );
  });
  if (plausible.length === 0) {
    console.log(
      `[resolver] not_found para "${reference}" (${scored.length} candidatos pero ninguno con similitud suficiente)`,
    );
    return {
      status: "not_found",
      reference,
      details: details ?? undefined,
    };
  }

  const best = plausible[0];

  // Un solo candidato con similitud suficiente: resolver directo (el resto
  // ya quedó descartado por el filtro de arriba, no hace falta comparar
  // contra nada).
  if (plausible.length === 1) {
    console.log(
      `[resolver] resolved (1 candidato plausible de ${scored.length}): "${best.candidate.name}" (sim=${best.sim.toFixed(2)})`,
    );
    return {
      status: "resolved",
      reference: best.candidate.name,
      details: details ?? undefined,
      lat: best.candidate.lat,
      lng: best.candidate.lng,
      source: "geo",
      resolvedName: cleanDisplayName(best.candidate.displayName),
    };
  }

  const second = plausible[1];

  // If best has clearly higher similarity AND is closer (or within 5km of second)
  if (
    best.sim >= 0.6 &&
    best.sim - second.sim >= 0.2 &&
    best.dist <= second.dist + 5
  ) {
    console.log(
      `[resolver] resolved (disambiguated): "${best.candidate.name}" (sim=${best.sim.toFixed(2)}, dist=${best.dist.toFixed(1)}km)`,
    );
    return {
      status: "resolved",
      reference: best.candidate.name,
      details: details ?? undefined,
      lat: best.candidate.lat,
      lng: best.candidate.lng,
      source: "geo",
      resolvedName: cleanDisplayName(best.candidate.displayName),
    };
  }

  // Ambiguous: return top 3 candidates plausibles (nunca los que ya
  // descartamos por similitud muy baja)
  const candidates: ResolutionCandidate[] = plausible.slice(0, 3).map((s) => ({
    name: s.candidate.name,
    address: cleanDisplayName(s.candidate.displayName),
    lat: s.candidate.lat,
    lng: s.candidate.lng,
  }));

  console.log(
    `[resolver] ambiguous para "${reference}": ${candidates.length} opciones`,
  );
  return {
    status: "ambiguous",
    reference,
    details: details ?? undefined,
    candidates,
  };
}

// ---------------------------------------------------------------------------
// Guardar lugar conocido al confirmar pedido
// ---------------------------------------------------------------------------

export function learnPlaceFromConfirmation(
  tenantId: number,
  reference: string,
  lat: number,
  lng: number,
): void {
  // Quitar puntuación colgada del final (ej: "Andalucia," con la coma que
  // quedó pegada al extraer el texto del cliente — quedaba guardado así
  // literalmente y se le mostraba de vuelta al cliente con la coma).
  const cleaned = reference.replace(/[.,;:]+$/, "").trim();
  if (!cleaned || cleaned.length < 3) return;
  // upsertKnownPlace hace match EXACTO de texto (UNIQUE en `name`, sin
  // normalizar mayúsculas/tildes). Si no revisamos esto antes, cada forma
  // distinta de escribir el mismo lugar en pedidos distintos ("boreal",
  // "Boreal", "BOREAL") crea una fila nueva en vez de acumularse en una
  // sola — diluye el conteo de uso y ensucia la base con duplicados. Si ya
  // existe un lugar guardado que normaliza igual, reusamos su nombre
  // exacto para que el upsert caiga en la misma fila.
  const existing = findKnownPlaces(tenantId, cleaned).find(
    (k) => normalizeText(k.name) === normalizeText(cleaned),
  );
  const name = existing ? existing.name : cleaned;
  upsertKnownPlace(tenantId, name, lat, lng);
  console.log(`[resolver] learned place: "${name}" (${lat}, ${lng})`);
}
