"use client";

// Sonido de "mensaje nuevo" reproducido directamente en la página mientras
// está abierta — esto SÍ lo controlamos nosotros (a diferencia del sonido
// de una notificación push, que decide el navegador/sistema operativo y no
// se puede forzar desde JS). Ping, Campanita y Pop se generan con la Web
// Audio API; los demás tonos son archivos MP3 en public/sounds.

export type NotificationSoundId =
  | "ping"
  | "chime"
  | "pop"
  | "confident"
  | "light-hearted"
  | "out-of-nowhere"
  | "relax"
  | "none";

export const SOUND_OPTIONS: { id: NotificationSoundId; label: string }[] = [
  { id: "ping", label: "Ping (por defecto)" },
  { id: "chime", label: "Campanita" },
  { id: "pop", label: "Pop corto" },
  { id: "confident", label: "Confiado" },
  { id: "light-hearted", label: "Alegre" },
  { id: "out-of-nowhere", label: "De la nada (corto)" },
  { id: "relax", label: "Relajado" },
  { id: "none", label: "Sin sonido" },
];

// Tonos que vienen de archivo (public/sounds/<id>.mp3) en vez de generarse
// con osciladores.
const FILE_SOUNDS: ReadonlySet<NotificationSoundId> = new Set([
  "confident",
  "light-hearted",
  "out-of-nowhere",
  "relax",
]);
const bufferCache = new Map<string, AudioBuffer>();

// Se decodifica y se reproduce con el mismo AudioContext (ya "desbloqueado"
// por el clic del usuario) en vez de un <audio>: así no depende de las
// políticas de autoplay de cada navegador. Se cachea el buffer para que la
// segunda vez suene al instante.
async function playFileSound(ctx: AudioContext, id: string): Promise<boolean> {
  let buffer = bufferCache.get(id);
  if (!buffer) {
    const res = await fetch(`/sounds/${id}.mp3`);
    if (!res.ok) return false;
    buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    bufferCache.set(id, buffer);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return true;
}

const STORAGE_KEY = "ordifast_notification_sound";
const DEFAULT_SOUND: NotificationSoundId = "ping";

export function getSelectedSound(): NotificationSoundId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && SOUND_OPTIONS.some((s) => s.id === v)) return v as NotificationSoundId;
  } catch {
    /* ignore */
  }
  return DEFAULT_SOUND;
}

export function setSelectedSound(id: NotificationSoundId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

let sharedCtx: AudioContext | null = null;

// BUG real encontrado (2026-09-17): esto reanudaba el AudioContext con
// resume() — que es asíncrono — pero sin esperarlo, y el código de arriba
// seguía de una y programaba el sonido de inmediato igual. Si el contexto
// seguía "suspended" en ese momento (pasa seguido en Firefox), el sonido
// quedaba programado pero el reloj del contexto nunca avanzaba — no sonaba
// nunca, y sin ningún error visible (por eso "le doy 30 veces y no pasa
// nada"). Ahora se espera de verdad a que termine de reanudar antes de
// programar cualquier sonido.
async function getAudioContext(): Promise<AudioContext | null> {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === "suspended") {
    await sharedCtx.resume();
  }
  return sharedCtx;
}

function beep(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  volume = 0.35,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // "triangle" en vez de "sine": a mismo volumen se percibe más presente
  // (más armónicos) sin llegar a sonar áspero como "square".
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// Devuelve true si de verdad se programó el sonido (para que un botón de
// "probar" pueda avisar si algo salió mal, en vez de quedarse callado como
// pasaba antes).
export async function playNotificationSound(
  sound?: NotificationSoundId,
): Promise<boolean> {
  const id = sound ?? getSelectedSound();
  if (id === "none") return true;
  let ctx: AudioContext | null;
  try {
    ctx = await getAudioContext();
  } catch (e) {
    console.error("[notification-sound] No se pudo iniciar el audio:", e);
    return false;
  }
  if (!ctx) {
    console.warn("[notification-sound] Este navegador no soporta Web Audio API");
    return false;
  }
  const now = ctx.currentTime;

  if (FILE_SOUNDS.has(id)) {
    try {
      return await playFileSound(ctx, id);
    } catch (e) {
      console.error("[notification-sound] No se pudo reproducir el tono:", e);
      return false;
    }
  }

  if (id === "ping") {
    // Doble beep en vez de uno solo — mucho más notorio que un tono único,
    // que reportaron que pasaba desapercibido.
    beep(ctx, 880, now, 0.15, 0.4);
    beep(ctx, 880, now + 0.18, 0.2, 0.4);
  } else if (id === "chime") {
    beep(ctx, 660, now, 0.15, 0.35);
    beep(ctx, 990, now + 0.12, 0.22, 0.35);
  } else if (id === "pop") {
    beep(ctx, 520, now, 0.1, 0.4);
  }
  return true;
}
