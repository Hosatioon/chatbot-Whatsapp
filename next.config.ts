import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@whiskeysockets/baileys",
    "better-sqlite3",
    "pino",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
