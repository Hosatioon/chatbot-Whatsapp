import { downloadMediaMessage, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { dataDir } from "./db";
import { transcribeAudio } from "./transcribe";

const logger = pino({ level: "silent" });
const audioRoot = path.join(dataDir, "audio");

export interface TranscribedVoiceNote {
  text: string;
  // Ruta relativa servida por /api/audio/<audioUrl> — ver esa route.
  audioUrl: string;
}

// Descarga la nota de voz del cliente, la transcribe con Groq Whisper y
// guarda el audio original en disco (data/audio/<tenant>/<id>.ext) para
// que el dueño pueda escucharlo desde el panel si sospecha que la
// transcripción se equivocó — no hay forma de saberlo solo con el texto.
// Nunca lanza: si algo falla (descarga, transcripción, disco lleno), el
// caller sigue con el acuse genérico de siempre para medios no legibles.
export async function transcribeVoiceNote(
  tenantId: number,
  sock: WASocket,
  msg: WAMessage,
): Promise<TranscribedVoiceNote | null> {
  try {
    const mimetype = msg.message?.audioMessage?.mimetype || "audio/ogg";
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      { reuploadRequest: sock.updateMediaMessage, logger },
    );

    const text = await transcribeAudio(buffer, mimetype);
    if (!text) return null;

    const tenantDir = path.join(audioRoot, String(tenantId));
    fs.mkdirSync(tenantDir, { recursive: true });
    const ext = mimetype.includes("ogg")
      ? "ogg"
      : mimetype.includes("m4a") || mimetype.includes("mp4")
        ? "m4a"
        : "ogg";
    const filename = `${msg.key.id || Date.now()}.${ext}`;
    fs.writeFileSync(path.join(tenantDir, filename), buffer);

    return { text, audioUrl: `${tenantId}/${filename}` };
  } catch (err) {
    console.error("[voice] Error transcribiendo nota de voz:", err);
    return null;
  }
}
