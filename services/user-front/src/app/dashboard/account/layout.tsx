"use client";

import AuthMask from "@/components/AuthMask";

export default function AccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthMask
      sessionHelpText="Sign in with your wallet to access account settings."
    >
      {children}
    </AuthMask>
  );
}
