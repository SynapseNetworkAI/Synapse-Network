"use client";

import { useEffect, useState } from "react";

import {
  getConfigOverview,
  type BusinessPolicyOverviewResponse,
} from "@/services/admin-api";

export type ConfigOverviewState = {
  overview: BusinessPolicyOverviewResponse | null;
  bootstrapping: boolean;
  error: string | null;
  refreshOverview: () => Promise<BusinessPolicyOverviewResponse | null>;
};

export function useConfigOverview(token: string | null): ConfigOverviewState {
  const [overview, setOverview] =
    useState<BusinessPolicyOverviewResponse | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshOverview(): Promise<BusinessPolicyOverviewResponse | null> {
    if (!token) {
      return null;
    }
    const nextOverview = await getConfigOverview(token);
    setOverview(nextOverview);
    setError(null);
    return nextOverview;
  }

  useEffect(() => {
    if (!token) {
      setBootstrapping(false);
      return;
    }
    setBootstrapping(true);
    let cancelled = false;
    void getConfigOverview(token)
      .then((nextOverview) => {
        if (cancelled) return;
        setOverview(nextOverview);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error ? loadError.message : "加载配置中心失败"
        );
      })
      .finally(() => {
        if (!cancelled) setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { overview, bootstrapping, error, refreshOverview };
}
