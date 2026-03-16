"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  clearAdminSession,
  persistAdminSession,
  readAdminProfile,
  readAdminToken,
} from "@/lib/admin-session";
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
    const currentToken = readAdminToken();
    const cachedProfile = readAdminProfile();
    if (!currentToken) {
      router.replace("/login");
      setLoading(false);
      return;
    }
    const activeToken = currentToken;

    setToken(activeToken);
    if (cachedProfile) {
      setAdmin(cachedProfile);
    }

    let cancelled = false;

    async function loadProfile() {
      try {
        const profile = await getCurrentAdmin(activeToken);
        if (cancelled) {
          return;
        }
        setAdmin(profile);
        persistAdminSession(activeToken, profile);
        setLoading(false);
      } catch {
        if (cancelled) {
          return;
        }
        clearAdminSession();
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