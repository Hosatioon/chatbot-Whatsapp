"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

/* ── Animaciones CSS en línea ── */
const keyframes = `
@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-12px); }
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulseDot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.7; }
}
@keyframes spinSlow {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <style>{keyframes}</style>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Email o contraseña inválidos");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div
      className="relative min-h-screen flex items-center justify-center overflow-hidden px-4"
      style={{
        background:
          "linear-gradient(-45deg, #0f172a, #1e293b, #0f172a, #111827)",
        backgroundSize: "400% 400%",
        animation: "gradientShift 12s ease infinite",
      }}
    >
      {/* Partículas decorativas flotantes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-emerald-400/10"
            style={{
              width: `${40 + i * 20}px`,
              height: `${40 + i * 20}px`,
              left: `${10 + i * 15}%`,
              top: `${15 + (i % 3) * 25}%`,
              animation: `float ${4 + i * 0.8}s ease-in-out infinite`,
              animationDelay: `${i * 0.5}s`,
            }}
          />
        ))}
      </div>

      {/* Anillo giratorio decorativo */}
      <div
        className="pointer-events-none absolute rounded-full border border-emerald-500/10"
        style={{
          width: "500px",
          height: "500px",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          animation: "spinSlow 30s linear infinite",
        }}
      >
        <div
          className="absolute h-2 w-2 rounded-full bg-emerald-400/40"
          style={{ top: "-4px", left: "50%", transform: "translateX(-50%)" }}
        />
      </div>
      <div
        className="pointer-events-none absolute rounded-full border border-emerald-500/5"
        style={{
          width: "380px",
          height: "380px",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          animation: "spinSlow 20s linear infinite reverse",
        }}
      />

      {/* Card de login */}
      <div
        className="relative z-10 w-full max-w-sm"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 0.8s ease, transform 0.8s ease",
        }}
      >
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          {/* Logo / Icono animado */}
          <div className="mb-6 flex flex-col items-center">
            <div
              className="relative mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10"
              style={{ animation: "float 3s ease-in-out infinite" }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-8 w-8 text-emerald-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                />
              </svg>
              <div
                className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-400"
                style={{ animation: "pulseDot 2s ease-in-out infinite" }}
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              OrdiFast
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Atención al cliente automatizada
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-zinc-500 backdrop-blur-sm transition focus:border-emerald-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                placeholder="tu@negocio.com"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Contraseña
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-zinc-500 backdrop-blur-sm transition focus:border-emerald-500/50 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                <svg
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full overflow-hidden rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 hover:shadow-emerald-500/30 disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                {loading ? "Ingresando..." : "Iniciar sesión"}
              </span>
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-zinc-500">
            ¿No tenés cuenta?{" "}
            <span className="text-zinc-400">
              Pedile al administrador que te cree una.
            </span>
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-600">
          OrdiFast · v0.1.0
        </p>
      </div>
    </div>
  );
}
