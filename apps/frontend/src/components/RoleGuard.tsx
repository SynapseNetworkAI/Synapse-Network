"use client";

import "client-only";

export default function RoleGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}