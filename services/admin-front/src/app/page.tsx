"use client";

import { useRouter } from "next/navigation";

import { SessionRouteBootstrapScreen } from "@/features/auth/session-route-bootstrap-screen";

export default function HomePage() {
  const router = useRouter();

  return <SessionRouteBootstrapScreen router={router} />;
}
