// Transcripción de notas de voz vía Groq (API compatible con la de OpenAI,
// pero corre en el hardware propio de Groq — mucho más barata y rápida).
// whisper-large-v3-turbo es el modelo rápido/económico de Groq para esto.
// No es crítico: si falla, el caller sigue con el acuse genérico de
// siempre (ver transcribeVoiceNote) — nunca se rompe el flujo del bot por
// un problema de transcripción.
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

export async function transcribeAudio(
  buffer: Buffer,
  mimetype: string,
): Promise<string | null> {
  if (!GROQ_API_KEY) {
    console.warn(
      "[transcribe] GROQ_API_KEY no está definida, no se puede transcribir",
    );
    return null;
  }
  try {
    const ext = mimetype.includes("ogg")
      ? "ogg"
      : mimetype.includes("m4a") || mimetype.includes("mp4")
        ? "m4a"
        : "ogg";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mimetype }),
      `audio.${ext}`,
    );
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "es");
    form.append("response_format", "text");

    const res = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      },
    );
    if (!res.ok) {
      console.error(
        `[transcribe] Groq respondió ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
      return null;
    }
    const text = (await res.text()).trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error("[transcribe] Error llamando a Groq:", err);
    return null;
  }
}
