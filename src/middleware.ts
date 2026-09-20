import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";

// Rutas que se autogestionan (validan auth/token internamente).
// /api/health acepta tanto super-admin como token externo (HEALTH_CHECK_TOKEN).
// /sw.js (service worker de notificaciones push) tiene que ser público: el
// navegador lo pide directo, sin cookies de sesión en ese momento — si lo
// bloqueamos, el middleware lo redirige a /login y el navegador termina
// "registrando" el HTML del login como si fuera el service worker (bug
// real encontrado 2026-09-16: navigator.serviceWorker.register('/sw.js')
// fallaba en silencio por esto).
// /manifest.webmanifest: el navegador lo pide SIN cookies (así lo define la
// especificación) — si pasa por el login, "Añadir a inicio" instala un simple
// acceso directo del navegador en vez de una app real, y en iPhone/Android
// eso deja las notificaciones push sin poder activarse bien.
// /o/<token> es el link "mágico" de un pedido puntual que se manda por
// WhatsApp al número de notificaciones — tiene que ser público (sin
// sesión) a propósito: la seguridad viene del token impredecible en la
// URL, no de una cookie de sesión. La página misma decide adentro si
// mandar al login-normal-redirigido-al-panel (si ya hay sesión) o mostrar
// el resumen de solo lectura (si no la hay).
const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/health",
  "/sw.js",
  "/manifest.webmanifest",
  "/o/",
];

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Permitir rutas públicas
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Sin sesión: redirigir
  if (!req.auth) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Protege todo excepto archivos estáticos y assets de Next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp)).*)",
  ],
};
