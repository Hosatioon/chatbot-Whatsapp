export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoCandidate {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

// Segmentos administrativos/técnicos que Nominatim mete en display_name y
// que en Colombia nadie usa para describir dónde vive ("AMCO" = Área
// Metropolitana Centro Occidente, "RAP Eje Cafetero", códigos postales).
// Se filtran antes de mostrarle una dirección al cliente por WhatsApp.
const DISPLAY_NAME_NOISE = new Set([
  "amco",
  "area metropolitana centro occidente",
  "perimetro urbano pereira",
  "rap eje cafetero",
  "colombia",
]);

function normalizeSegment(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Limpia un display_name de Nominatim/Photon para mostrarlo a un cliente:
 * quita siglas técnicas de área metropolitana, códigos postales y "Colombia"
 * (redundante), y se queda con los primeros `maxParts` segmentos útiles.
 */
export function cleanDisplayName(
  displayName: string,
  maxParts: number = 3,
): string {
  const parts = displayName
    .split(",")
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (DISPLAY_NAME_NOISE.has(normalizeSegment(p))) return false;
      if (/^\d{4,7}$/.test(p)) return false; // código postal
      return true;
    });
  return parts.slice(0, maxParts).join(", ");
}

/**
 * Extraer lat/lng de un URL de Google Maps.
 * Formatos soportados:
 *   https://maps.google.com/?q=4.8,-75.7
 *   https://maps.google.com/maps?ll=4.8,-75.7
 *   https://maps.google.com/@4.8,-75.7,15z
 *   https://www.google.com/maps/place/.../@4.8,-75.7
 *   https://maps.app.goo.gl/XXX (short URL — follows redirect)
 */
export async function extractLatLngFromUrl(
  url: string,
): Promise<LatLng | null> {
  // Primero intentar extraer directamente de la URL
  const direct = extractLatLngFromUrlSync(url);
  if (direct) return direct;

  // Si es un link corto (maps.app.goo.gl, goo.gl, etc.), seguir la redirección
  if (url.includes("goo.gl") || url.includes("maps.app")) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
      });
      const finalUrl = res.url;
      const resolved = extractLatLngFromUrlSync(finalUrl);
      if (resolved) return resolved;

      // A veces la URL final tampoco tiene coords pero el HTML sí
      if (finalUrl !== url) {
        const fullRes = await fetch(finalUrl, {
          signal: AbortSignal.timeout(5000),
        });
        const html = await fullRes.text();
        // Buscar coordenadas en el HTML: !3dLAT!4dLNG o @lat,lng
        let m = html.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        m = html.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
      }
    } catch (err) {
      console.error("[geo] Error resolviendo short URL:", err);
    }
  }

  return null;
}

function extractLatLngFromUrlSync(url: string): LatLng | null {
  // ?q=lat,lng
  let m = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // ?ll=lat,lng
  m = url.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // @lat,lng
  m = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // !3dLAT!4dLNG (formato de Google Maps embed)
  m = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  return null;
}

/**
 * Buscar en Nominatim (OpenStreetMap) devolviendo múltiples candidatos.
 * Si origin está definido, filtra resultados a ≤maxKm del local (default 15km:
 * suficiente para una zona de reparto urbana tipo Pereira-Dosquebradas; 30km
 * dejaba pasar municipios vecinos como Chinchiná o Palestina, Caldas).
 */
export async function searchNominatim(
  query: string,
  limit: number = 5,
  origin?: LatLng,
  maxKm: number = 15,
): Promise<GeoCandidate[]> {
  const candidates: GeoCandidate[] = [];

  let viewbox = "";
  let bounded = "";
  if (origin) {
    const delta = maxKm / 111; // ~111km por grado de latitud
    const left = origin.lng - delta;
    const right = origin.lng + delta;
    const top = origin.lat + delta;
    const bottom = origin.lat - delta;
    viewbox = `&viewbox=${left},${top},${right},${bottom}`;
    bounded = "&bounded=1";
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&countrycodes=co${viewbox}${bounded}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "OrdifastBot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
        name?: string;
      }>;
      for (const item of data) {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        if (origin) {
          const dist = haversineKm(origin, { lat, lng });
          if (dist > maxKm) {
            console.log(
              `[geo] Nominatim (viewbox) "${query}" → ${item.display_name.slice(0, 50)} está a ${dist.toFixed(1)}km, ignorando`,
            );
            continue;
          }
        }
        candidates.push({
          name: item.name || item.display_name.split(",")[0] || query,
          displayName: item.display_name,
          lat,
          lng,
        });
      }
    }
  } catch (err) {
    console.error(`[geo] Nominatim error for "${query}":`, err);
  }

  // Si no hubo resultados con viewbox, intentar sin restricción geográfica
  if (candidates.length === 0) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&countrycodes=co`;
      const res = await fetch(url, {
        headers: { "User-Agent": "OrdifastBot/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{
          lat: string;
          lon: string;
          display_name: string;
          name?: string;
        }>;
        for (const item of data) {
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          if (origin) {
            const dist = haversineKm(origin, { lat, lng });
            if (dist > maxKm) continue;
          }
          candidates.push({
            name: item.name || item.display_name.split(",")[0] || query,
            displayName: item.display_name,
            lat,
            lng,
          });
        }
      }
    } catch (err) {
      console.error(`[geo] Nominatim (no viewbox) error for "${query}":`, err);
    }
  }

  return candidates;
}

/**
 * Buscar en Photon (komoot.io) devolviendo múltiples candidatos.
 * Photon es mejor para landmarks y nombres de lugares.
 * Si origin está definido, filtra resultados a ≤maxKm (default 15km).
 */
export async function searchPhoton(
  query: string,
  limit: number = 5,
  origin?: LatLng,
  maxKm: number = 15,
): Promise<GeoCandidate[]> {
  const candidates: GeoCandidate[] = [];

  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}`;
    if (origin) {
      url += `&lat=${origin.lat}&lon=${origin.lng}`;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as {
        features?: Array<{
          geometry: { coordinates: [number, number] };
          properties?: {
            name?: string;
            city?: string;
            state?: string;
            country?: string;
            osm_value?: string;
            osm_key?: string;
          };
        }>;
      };
      if (data.features) {
        for (const f of data.features) {
          const [lng, lat] = f.geometry.coordinates;
          if (origin) {
            const dist = haversineKm(origin, { lat, lng });
            if (dist > maxKm) continue;
          }
          const props = f.properties || {};
          const name = props.name || query;
          const parts = [name, props.city, props.state, props.country].filter(
            Boolean,
          );
          candidates.push({
            name,
            displayName: parts.join(", "),
            lat,
            lng,
          });
        }
      }
    }
  } catch (err) {
    console.error(`[geo] Photon error for "${query}":`, err);
  }

  return candidates;
}

/**
 * Geocodificar una dirección textual usando Nominatim (OpenStreetMap).
 * Rate limit: 1 req/seg (recomendado por Nominatim).
 * Intenta normalizar la dirección (quitar #, números de casa) si la búsqueda exacta falla.
 * Mantiene compatibilidad con el flujo anterior (devuelve el primer resultado).
 */
export async function geocodeAddress(
  address: string,
  origin?: LatLng,
): Promise<LatLng | null> {
  const variants = normalizeAddressForGeocoding(address);

  for (const q of variants) {
    const results = await searchNominatim(q, 1, origin);
    if (results.length > 0) {
      return { lat: results[0].lat, lng: results[0].lng };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Si Nominatim no encontró nada, intentar con Photon
  if (origin) {
    for (const q of variants) {
      const results = await searchPhoton(q, 1, origin);
      if (results.length > 0) {
        return { lat: results[0].lat, lng: results[0].lng };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return null;
}

/**
 * Generar variantes de una dirección para intentar geocodificar.
 * El LLM ya limpia la dirección antes de llamar setAddress,
 * así que aquí solo hacemos limpieza básica por si acaso.
 */
export function normalizeAddressForGeocoding(address: string): string[] {
  const variants: string[] = [address];

  // BUG real encontrado (2026-09-10): el símbolo "N°"/"Nº" (típico de
  // direcciones colombianas, ej. "Calle 8 N°31-177") rompe la búsqueda de
  // Nominatim por completo — con el símbolo devuelve 0 resultados, sin él
  // resuelve bien. Se descubrió geocodificando un dataset oficial completo
  // de direcciones de Dosquebradas, donde casi todas usan ese formato.
  const noGradeSymbol = address
    .replace(/N[°º]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (noGradeSymbol !== address) variants.push(noGradeSymbol);

  // Reemplazar # por espacio
  const noHash = noGradeSymbol.replace(/#/g, " ").replace(/\s+/g, " ").trim();
  if (noHash !== noGradeSymbol && noHash !== address) variants.push(noHash);

  // Quitar números de casa (patrón: número-número o número suelto)
  const noNumbers = noHash
    .replace(/\b\d+-\d+\b/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (noNumbers !== noHash && noNumbers.length > 3) variants.push(noNumbers);

  // Deduplicar
  return [...new Set(variants)];
}

/**
 * Geocodificación inversa: convierte lat/lng en un nombre de lugar legible.
 * Se usa cuando el cliente manda su ubicación GPS por WhatsApp (un link o
 * pin) en vez de escribir la dirección — sin esto, la dirección guardada
 * queda como el link crudo de Maps, sin nombre de lugar reconocible.
 * Devuelve null si Nominatim no responde o no hay nada útil.
 */
export async function reverseGeocode(point: LatLng): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${point.lat}&lon=${point.lng}&format=json&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "OrdifastBot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
      error?: string;
    };
    if (!data || data.error || !data.display_name) return null;
    // Priorizar nombre de lugar/edificio + barrio si existen, en vez del
    // display_name completo (que suele venir con ciudad/depto/país de más).
    const addr = data.address || {};
    const place =
      addr.amenity ||
      addr.building ||
      addr.residential ||
      addr.neighbourhood ||
      addr.suburb ||
      addr.road;
    const locality = addr.suburb || addr.neighbourhood || addr.city_district;
    if (place) {
      return locality && locality !== place ? `${place}, ${locality}` : place;
    }
    // Fallback: primeros 2-3 componentes del display_name completo
    return data.display_name.split(",").slice(0, 3).join(",").trim();
  } catch (err) {
    console.error("[geo] Error en reverseGeocode:", err);
    return null;
  }
}

/**
 * Calcular distancia en km entre dos puntos usando OSRM (ruta en carro).
 * Fallback a Haversine si OSRM falla.
 */
export async function calculateDistance(
  origin: LatLng,
  dest: LatLng,
): Promise<{ km: number; source: "osrm" | "haversine" }> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const meters = data.routes[0].distance as number;
      return { km: meters / 1000, source: "osrm" };
    }
    throw new Error("OSRM no routes");
  } catch (err) {
    console.warn("[geo] OSRM fallback a Haversine:", err);
    return { km: haversineKm(origin, dest), source: "haversine" };
  }
}

/**
 * Distancia Haversine (línea recta) en km.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calcular precio de domicilio: km × pricePerKm, redondeado al múltiplo de 100.
 * Si minPrice está configurado y el resultado es menor, usar minPrice.
 */
export function calculateDeliveryPrice(
  km: number,
  pricePerKm: number,
  minPrice?: number,
): number {
  const raw = Math.round(km * pricePerKm);
  const rounded = Math.round(raw / 100) * 100;
  if (minPrice && rounded < minPrice) return minPrice;
  return rounded;
}
