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

export async function assertSafeExternalUrl(rawUrl: string): Promise<void> {
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
}

export async function isSafeExternalUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeExternalUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
