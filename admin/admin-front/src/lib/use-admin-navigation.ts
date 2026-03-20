"use client";

import { useEffect, useState } from "react";

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
    let cancelled = false;

    async function loadNavigation() {
      try {
        const response = await getAdminMenuConfig("cookie-session", { stage: "published" });
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