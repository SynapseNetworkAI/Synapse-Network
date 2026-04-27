import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { Providers } from "@/components/Providers";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { AnalyticsProvider } from "@/lib/analytics-provider";
import { Toaster } from "react-hot-toast";

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
  title: "Synapse Network",
  description: "The API settlement gateway for AI agents: owner-funded USDC vaults, agent runtime payments, and millisecond settlement.",
  icons: {
    icon: "/brand/synapse-network-icon.svg",
    shortcut: "/brand/synapse-network-icon.svg",
    apple: "/brand/synapse-network-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <Providers>
          <AnalyticsProvider>
          <LanguageProvider>
            <Navbar />
            <main className="flex-1">
              {children}
            </main>
            <Toaster 
              position="top-center" 
              toastOptions={{
                style: {
                  background: '#111827',
                  color: '#00FFA3',
                  border: '1px solid #374151',
                },
              }} 
            />
          </LanguageProvider>
          </AnalyticsProvider>
        </Providers>
      </body>
    </html>
  );
}
