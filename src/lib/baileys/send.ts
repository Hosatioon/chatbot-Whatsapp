import { getUrlInfo, type WASocket } from "@whiskeysockets/baileys";
import { isSafeExternalUrl } from "../url-safety";

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
// (assertSafeExternalUrl), y siempre pasa `linkPreview` explícito (nunca
// undefined) para que Baileys NUNCA dispare su propio fetch automático.
export async function sendTextWithSafePreview(
  sock: WASocket,
  jid: string,
  text: string,
): Promise<void> {
  const match = text.match(URL_REGEX);
  let linkPreview: Awaited<ReturnType<typeof getUrlInfo>> | null = null;

  if (match) {
    const url = match[1];
    try {
      if (await isSafeExternalUrl(url)) {
        linkPreview =
          (await getUrlInfo(url, {
            thumbnailWidth: 192,
            fetchOpts: { timeout: 5000 },
          })) ?? null;
      }
    } catch {
      linkPreview = null;
    }
  }

  await sock.sendMessage(jid, { text, linkPreview });
}
