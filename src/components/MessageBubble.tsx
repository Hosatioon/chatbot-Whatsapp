import type { DeliveryStatus, Role } from "@/lib/db";

interface Props {
  role: Role;
  content: string;
  createdAt: number;
  // Solo los mensajes que salen por WhatsApp (bot/humano) traen estado; los
  // del cliente y los viejos (de antes de los chulitos) vienen null.
  deliveryStatus?: DeliveryStatus | null;
}

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  pending: "Enviando...",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No enviado",
};

// Chulitos estilo WhatsApp: reloj (pendiente), ✓ enviado, ✓✓ entregado,
// ✓✓ azul leído, ⚠ no enviado. "Leído" solo aparece si el cliente tiene
// activados los recibos de lectura en su WhatsApp.
function StatusTicks({ status }: { status: DeliveryStatus }) {
  const label = STATUS_LABEL[status];
  if (status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-0.5 font-medium text-red-600"
        title="No se pudo enviar por WhatsApp"
        aria-label={label}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.5h1.5v4h-1.5V5Zm0 5.25h1.5v1.5h-1.5v-1.5Z" />
        </svg>
        {label}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span title={label} aria-label={label} className="text-gray-400">
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.3 1.4" />
        </svg>
      </span>
    );
  }
  const double = status === "delivered" || status === "read";
  const color = status === "read" ? "text-sky-500" : "text-gray-400";
  return (
    <span title={label} aria-label={label} className={color}>
      <svg viewBox="0 0 20 12" className="h-3 w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M1.5 6.5 5 10 12 2" />
        {double && <path d="M8 9.5 9 10.5 18 2" />}
      </svg>
    </span>
  );
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBubble({
  role,
  content,
  createdAt,
  deliveryStatus,
}: Props) {
  const isUser = role === "user";
  const isHuman = role === "human";

  const wrapper = isUser ? "justify-start" : "justify-end";
  const bubble = isUser
    ? "bg-white border border-gray-200 text-slate-900"
    : isHuman
      ? "bg-amber-100 border border-amber-200 text-amber-950"
      : "bg-emerald-100 border border-emerald-200 text-emerald-950";
  const label = isUser ? "Cliente" : isHuman ? "Humano" : "IA";

  return (
    // min-w-0 en toda la cadena: los mensajes del bot traen links de mapa
    // largos y sin espacios — sin esto, esa URL fuerza el flex a medir más
    // ancho que la pantalla y empuja las burbujas (y todo lo demás) fuera
    // del viewport. break-all además parte la URL en cualquier punto si
    // hace falta (break-words a veces no alcanza con un link tan largo).
    <div className={`flex min-w-0 animate-scale-in ${wrapper}`}>
      <div
        className={`max-w-[75%] min-w-0 rounded-2xl px-3 py-2 shadow-sm ${bubble}`}
      >
        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-gray-500">
          {label}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm">{content}</div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
          <span>{formatTime(createdAt)}</span>
          {!isUser && deliveryStatus && <StatusTicks status={deliveryStatus} />}
        </div>
      </div>
    </div>
  );
}
