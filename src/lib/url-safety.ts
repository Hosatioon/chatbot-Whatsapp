import dns from "node:dns/promises";

// Compartido entre el import de productos por URL y la generación de
// preview de links del bot — cualquier lugar donde el servidor hace
// fetch() a una URL que no controlamos 100% debe pasar por acá primero.
// Bloquea SSRF: URLs que apuntan a redes internas/privadas o localhost.

function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "::1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("127.") || ip.startsWith("169.254.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  const m = ip.match(/^172\.(\d{1,3})\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80"))
    return true; // IPv6 ULA/link-local
  return false;
}

// Devuelve la IP ya validada (no privada/interna) a la que resuelve la URL.
// BUG DE SEGURIDAD real encontrado (2026-09-14): `assertSafeExternalUrl`
// hacía este mismo chequeo pero DESCARTABA la IP resuelta — quien la
// llamaba (send.ts) validaba con ESTA IP y después le pedía a
// `link-preview-js` que hiciera su propio fetch, que internamente vuelve a
// resolver el dominio por su cuenta. Eso deja abierta una ventana de DNS
// rebinding: un dominio controlado por un atacante puede responder una IP
// pública en nuestro chequeo y, milisegundos después, una IP interna en el
// fetch real de la librería — nuestra validación no protegía nada en ese
// caso. Ahora devolvemos la IP validada para que el caller se la pase tal
// cual a `resolveDNSHost` de link-preview-js y así fije el fetch a la
// MISMA IP que ya revisamos, sin una segunda resolución de DNS.
export async function resolveSafeExternalIp(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http/https");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("No se permiten URLs locales");
  }
  const { address } = await dns.lookup(hostname);
  if (isPrivateOrLocalIp(address)) {
    throw new Error("No se permiten URLs a redes internas/privadas");
  }
  return address;
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
  await resolveSafeExternalIp(rawUrl);
}

export async function isSafeExternalUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeExternalUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
