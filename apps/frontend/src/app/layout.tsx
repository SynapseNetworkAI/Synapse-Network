import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { Providers } from "@/components/Providers";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
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
        </Providers>
      </body>
    </html>
  );
}
