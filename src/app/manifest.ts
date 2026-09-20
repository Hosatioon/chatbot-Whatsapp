import type { MetadataRoute } from "next";

// Manifiesto de la app instalable (PWA). Sin esto, "Añadir a pantalla de
// inicio" solo crea un acceso directo del navegador: en iPhone las
// notificaciones push exigen una app instalada de verdad, y en Android
// Chrome instala un acceso directo en vez de una app con su propio ícono.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OrdiFast",
    short_name: "OrdiFast",
    description: "Atención al cliente automatizada por WhatsApp",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#10b981",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
