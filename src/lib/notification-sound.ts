"use client";

// Sonido de "mensaje nuevo" reproducido directamente en la página mientras
// está abierta — esto SÍ lo controlamos nosotros (a diferencia del sonido
// de una notificación push, que decide el navegador/sistema operativo y no
// se puede forzar desde JS). Generado con Web Audio API en vez de un
// archivo de audio: nada que cargar, nada que licenciar, funciona en
// cualquier navegador moderno.

export type NotificationSoundId = "ping" | "chime" | "pop" | "none";

export const SOUND_OPTIONS: { id: NotificationSoundId; label: string }[] = [
  { id: "ping", label: "Ping (por defecto)" },
  { id: "chime", label: "Campanita" },
  { id: "pop", label: "Pop corto" },
  { id: "none", label: "Sin sonido" },
];

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
  volume = 0.15,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
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

  if (id === "ping") {
    beep(ctx, 880, now, 0.18);
  } else if (id === "chime") {
    beep(ctx, 660, now, 0.15, 0.12);
    beep(ctx, 990, now + 0.12, 0.2, 0.12);
  } else if (id === "pop") {
    beep(ctx, 520, now, 0.08, 0.18);
  }
  return true;
}
