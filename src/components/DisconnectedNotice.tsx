"use client";

export default function DisconnectedNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-emerald-50/30 p-4 sm:p-6">
      <div className="animate-slide-up w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
          <svg
            className="h-7 w-7 text-amber-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h1 className="mt-4 text-center text-xl font-semibold text-slate-900">
          Perdimos la conexión con WhatsApp
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          Ya estamos al tanto y la estamos reconectando. No hace falta que
          hagas nada — en un momento vuelve a funcionar.
        </p>
        <a
          href="mailto:soporte@ordifast.com"
          className="mt-6 block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Contactar soporte
        </a>
      </div>
    </div>
  );
}
