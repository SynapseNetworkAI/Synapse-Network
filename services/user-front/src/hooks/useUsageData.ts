"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { listUsageLogs, type UsageLogRecord } from "@/utils/usageApi";

export type AggregatedUsage = {
  serviceId: string;
  totalCalls: number;
  totalSpent: number;
  totalEarned: number;
  platformFee: number;
};

export function useUsageData() {
  const { address: userAddress } = useAccount();
  const [logs, setLogs] = useState<UsageLogRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsage = useCallback(async () => {
    if (!userAddress) {
      setLogs([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listUsageLogs(userAddress, 1000);
      setLogs(data);
    } catch (e) {
      console.error("fetchUsage error:", e);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const stats = useMemo(() => {
    if (!userAddress) return {
      totalOwnerSpent: 0,
      totalOwnerCalls: 0,
      totalProviderEarned: 0,
      totalProviderCalls: 0,
      aggregatedList: [] as AggregatedUsage[]
    };
    
    let totalOwnerSpent = 0;
    let totalOwnerCalls = 0;
    let totalProviderEarned = 0;
    let totalProviderCalls = 0;
    
    const serviceAggMap: Record<string, AggregatedUsage> = {};

    const myAddress = userAddress.toLowerCase();

    for (const log of logs) {
      const isOwner = (log.ownerAddress || "").toLowerCase() === myAddress;
      const isProvider = (log.providerAddress || "").toLowerCase() === myAddress;
      
      const sId = log.service_id || "unknown";
      if (!serviceAggMap[sId]) {
        serviceAggMap[sId] = { serviceId: sId, totalCalls: 0, totalSpent: 0, totalEarned: 0, platformFee: 0 };
      }

      if (isOwner) {
        totalOwnerCalls++;
        const spent = log.unit_price || 0;
        totalOwnerSpent += spent;
        serviceAggMap[sId].totalCalls++;
        serviceAggMap[sId].totalSpent += spent;
      }
      
      if (isProvider) {
        totalProviderCalls++;
        const earned = log.provider_net || ((log.unit_price || 0) - (log.platform_fee || 0));
        totalProviderEarned += Math.max(0, earned);
        serviceAggMap[sId].totalCalls++;
        serviceAggMap[sId].totalEarned += Math.max(0, earned);
        serviceAggMap[sId].platformFee += (log.platform_fee || 0);
      }
    }

    const aggregatedList = Object.values(serviceAggMap).sort((a, b) => b.totalCalls - a.totalCalls);

    return {
      totalOwnerSpent,
      totalOwnerCalls,
      totalProviderEarned,
      totalProviderCalls,
      aggregatedList
    };
  }, [logs, userAddress]);

  return { loading, logs, stats, refetch: fetchUsage };
}
