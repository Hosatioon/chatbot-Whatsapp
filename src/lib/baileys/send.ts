import { getUrlInfo, type WASocket } from "@whiskeysockets/baileys";
import { resolveSafeExternalIp } from "../url-safety";

const URL_REGEX = /(https?:\/\/[^\s]+)/i;

// BUG DE SEGURIDAD real encontrado (2026-09-11): @whiskeysockets/baileys
// intenta generar automáticamente una vista previa de link para CUALQUIER
// URL que aparezca en CUALQUIER texto que mandemos con sendMessage — eso
// corre por default salvo que se pase `linkPreview` explícito. La
// librería que usa por debajo (link-preview-js) tiene un CVE de SSRF
// conocido (ataques a IPv6/loopback y DNS rebinding). Como el texto de
// las respuestas del LLM no es 100% controlado (podría llegar a incluir
// una URL sugerida por el cliente), dejar ese comportamiento automático
// prendido abre una superficie de SSRF en cada mensaje que manda el bot.
//
// Esta función es el ÚNICO lugar autorizado para generar preview: solo
// lo hace para URLs que pasan el chequeo de red interna/privada
// (resolveSafeExternalIp), y siempre pasa `linkPreview` explícito (nunca
// undefined) para que Baileys NUNCA dispare su propio fetch automático.
//
// INTENTO Y REVERSIÓN (2026-09-14): link-preview-js soporta un
// `resolveDNSHost` que fija el fetch real a una IP ya validada, cerrando
// el hueco de DNS rebinding entre nuestro chequeo y su propio fetch. Pero
// el `getUrlInfo` de Baileys (wrapper que usamos acá) NO reenvía esa
// opción por dentro — así que probé bypasear el wrapper y llamar
// `getLinkPreview` de link-preview-js directo, pasándole `resolveDNSHost`.
// Verificado en vivo: ESO ROMPE cualquier sitio HTTPS real (Drive, wa.me,
// etc.) — al fijar la conexión a la IP literal, el hostname que ve TLS ya
// no es el dominio original, y la verificación del certificado (SNI)
// falla siempre ("self-signed certificate" / "hostname doesn't match
// altnames"). Arreglarlo bien requeriría un Agent HTTPS a medida que fije
// la conexión a la IP pero mantenga el SNI/Host original — mucho más
// superficie y riesgo (podría terminar debilitando la verificación TLS)
// para cerrar un hueco que hoy es angosto: las únicas URLs que pasan por
// acá son el link del catálogo que configura el propio tenant, nunca texto
// libre del cliente. Nos quedamos con la mitigación que sí funciona sin
// romper nada: validar que la URL resuelve a una IP pública ANTES de
// pedirle el preview a Baileys.
// Devuelve el id del mensaje en WhatsApp (o null si no vino) — se usa para
// casar después los recibos de entrega/lectura con el mensaje del dashboard.
export async function sendTextWithSafePreview(
  sock: WASocket,
  jid: string,
  text: string,
): Promise<string | null> {
  const match = text.match(URL_REGEX);
  let linkPreview: Awaited<ReturnType<typeof getUrlInfo>> | null = null;

  if (match) {
    const url = match[1];
    try {
      await resolveSafeExternalIp(url);
      linkPreview =
        (await getUrlInfo(url, {
          thumbnailWidth: 192,
          fetchOpts: { timeout: 5000 },
        })) ?? null;
    } catch {
      linkPreview = null;
    }
  }

  const sent = await sock.sendMessage(jid, { text, linkPreview });
  return sent?.key?.id ?? null;
}
