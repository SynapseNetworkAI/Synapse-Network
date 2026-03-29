"use client";

import { useEffect, useState } from "react";

import {
  buildAdminNavigation,
  type NavItem,
} from "@/lib/navigation";
import { getVisibleAdminMenuConfig, type AdminProfile } from "@/services/admin-api";


type UseAdminNavigationResult = {
  navigation: NavItem[];
};


export function useAdminNavigation(admin: AdminProfile): UseAdminNavigationResult {
  const [navigation, setNavigation] = useState<NavItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadNavigation() {
      try {
        const response = await getVisibleAdminMenuConfig("cookie-session");
        if (!cancelled) {
          setNavigation(buildAdminNavigation(response.items));
        }
      } catch {
        if (!cancelled) {
          setNavigation([]);
        }
      }
    }

    void loadNavigation();
    return () => {
      cancelled = true;
    };
  }, [admin.adminId]);

  return { navigation };
}