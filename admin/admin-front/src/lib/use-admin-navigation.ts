"use client";

import { useEffect, useState } from "react";

import { readAdminToken } from "@/lib/admin-session";
import {
  getVisibleAdminNavigation,
  getVisibleAdminNavigationFromConfig,
  adminNavigationTree,
  type AdminNavSection,
} from "@/lib/navigation";
import { getAdminMenuConfig, type AdminProfile } from "@/services/admin-api";


type UseAdminNavigationResult = {
  navigation: AdminNavSection[];
};


export function useAdminNavigation(admin: AdminProfile): UseAdminNavigationResult {
  const [navigation, setNavigation] = useState<AdminNavSection[]>(() => getVisibleAdminNavigation(admin));

  useEffect(() => {
    const token = readAdminToken();
    let cancelled = false;

    async function loadNavigation() {
      if (!token) {
        if (!cancelled) {
          setNavigation(getVisibleAdminNavigation(admin));
        }
        return;
      }
      try {
        const response = await getAdminMenuConfig(token, { stage: "published" });
        if (!cancelled) {
          setNavigation(getVisibleAdminNavigationFromConfig(admin, response.items));
        }
      } catch {
        if (!cancelled) {
          setNavigation(getVisibleAdminNavigationFromConfig(admin, [], adminNavigationTree));
        }
      }
    }

    void loadNavigation();
    return () => {
      cancelled = true;
    };
  }, [admin]);

  return { navigation };
}