import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agente WhatsApp",
  description: "Dashboard local para agente de WhatsApp con IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gray-100 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
