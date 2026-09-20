import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProviderWrapper } from "@/components/SessionProviderWrapper";

export const metadata: Metadata = {
  title: "OrdiFast",
  description: "Atención al cliente automatizada por WhatsApp",
  appleWebApp: {
    capable: true,
    title: "OrdiFast",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#10b981",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}
