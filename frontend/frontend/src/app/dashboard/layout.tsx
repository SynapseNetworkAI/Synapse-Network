"use client";

import Navbar from "@/components/Navbar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-black text-green-500 font-mono">
      <Navbar />
      <div className="pt-20">
        {children}
      </div>
    </div>
  );
}
