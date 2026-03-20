"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getCurrentAdmin, type AdminProfile } from "@/services/admin-api";


type UseAdminSessionResult = {
  admin: AdminProfile | null;
  token: string | null;
  loading: boolean;
};


export function useAdminSession(): UseAdminSessionResult {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const session = await getCurrentAdmin("cookie-session");
        if (cancelled) {
          return;
        }
        setAdmin(session.admin);
        setToken("cookie-session");
        setLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        setAdmin(null);
        setToken(null);
        setLoading(false);
        router.replace("/login");
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { admin, token, loading };
}