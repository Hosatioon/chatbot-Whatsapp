import type { Role } from "@/lib/db";

interface Props {
  role: Role;
  content: string;
  createdAt: number;
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

export default function MessageBubble({ role, content, createdAt }: Props) {
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
    <div className={`flex animate-scale-in ${wrapper}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 shadow-sm ${bubble}`}>
        <div className="mb-0.5 text-[10px] uppercase tracking-wider text-gray-500">
          {label}
        </div>
        <div className="whitespace-pre-wrap break-words text-sm">{content}</div>
        <div className="mt-1 text-right text-[10px] text-gray-500">
          {formatTime(createdAt)}
        </div>
      </div>
    </div>
  );
}
