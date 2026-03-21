import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

const displayFont = Manrope({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700", "800"],
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Synapse Admin Sentinel",
  description: "Sentinel control plane for Synapse Network.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`}>{children}</body>
    </html>
  );
}
