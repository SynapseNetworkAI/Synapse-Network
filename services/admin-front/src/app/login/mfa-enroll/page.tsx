"use client";

import { useRouter } from "next/navigation";

import { MfaEnrollmentScreen } from "@/features/auth/mfa-enrollment-screen";

export default function MfaEnrollPage() {
  const router = useRouter();

  return <MfaEnrollmentScreen router={router} />;
}
