import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/shared";
import localFont from "next/font/local";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Synapse Docs | Settlement Layer for AI Agents",
    template: "%s | Synapse Docs",
  },
  description:
    "Developer documentation for agent-native USDC settlement, off-chain charging, SDKs, and API provider monetization.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Synapse Docs",
    description:
      "Build agents that discover, invoke, and pay for APIs with USDC budget guardrails.",
    url: siteUrl,
    siteName: "Synapse Docs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Synapse Docs",
    description:
      "Build agents that discover, invoke, and pay for APIs with USDC budget guardrails.",
  },
  icons: {
    icon: "/brand/synapse-network-icon.svg",
    shortcut: "/brand/synapse-network-icon.svg",
    apple: "/brand/synapse-network-icon.svg",
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col bg-[#030405] font-sans text-fd-foreground">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
