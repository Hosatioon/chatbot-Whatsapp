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
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  // Los navegadores suspenden el AudioContext hasta que haya una
  // interacción del usuario con la página — si sigue "suspended", lo
  // intentamos reanudar (no pasa nada si falla, simplemente no sonará
  // hasta la primera interacción, como cualquier audio en la web).
  if (sharedCtx.state === "suspended") void sharedCtx.resume().catch(() => {});
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

export function playNotificationSound(sound?: NotificationSoundId): void {
  const id = sound ?? getSelectedSound();
  if (id === "none") return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (id === "ping") {
    beep(ctx, 880, now, 0.18);
  } else if (id === "chime") {
    beep(ctx, 660, now, 0.15, 0.12);
    beep(ctx, 990, now + 0.12, 0.2, 0.12);
  } else if (id === "pop") {
    beep(ctx, 520, now, 0.08, 0.18);
  }
}
