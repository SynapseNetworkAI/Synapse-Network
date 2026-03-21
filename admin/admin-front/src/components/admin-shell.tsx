"use client";

import type { ReactNode } from "react";

import { AdminLayout } from "@/layouts/admin-layout";
import type { AdminProfile } from "@/services/admin-api";

type AdminShellProps = {
  admin: AdminProfile;
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function AdminShell({
  admin,
  title,
  eyebrow,
  description,
  children,
  actions,
}: Readonly<AdminShellProps>) {
  return <AdminLayout admin={admin} title={title} eyebrow={eyebrow} description={description} actions={actions}>{children}</AdminLayout>;
}
