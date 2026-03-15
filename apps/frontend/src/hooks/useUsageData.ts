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
      totalBuyerSpent: 0,
      totalBuyerCalls: 0,
      totalSellerEarned: 0,
      totalSellerCalls: 0,
      aggregatedList: [] as AggregatedUsage[]
    };
    
    let totalBuyerSpent = 0;
    let totalBuyerCalls = 0;
    let totalSellerEarned = 0;
    let totalSellerCalls = 0;
    
    const serviceAggMap: Record<string, AggregatedUsage> = {};

    const myAddress = userAddress.toLowerCase();

    for (const log of logs) {
      const isBuyer = (log.buyer || "").toLowerCase() === myAddress;
      const isSeller = (log.seller || "").toLowerCase() === myAddress;
      
      const sId = log.service_id || "unknown";
      if (!serviceAggMap[sId]) {
        serviceAggMap[sId] = { serviceId: sId, totalCalls: 0, totalSpent: 0, totalEarned: 0, platformFee: 0 };
      }

      if (isBuyer) {
        totalBuyerCalls++;
        const spent = log.unit_price || 0;
        totalBuyerSpent += spent;
        serviceAggMap[sId].totalCalls++;
        serviceAggMap[sId].totalSpent += spent;
      }
      
      if (isSeller) {
        totalSellerCalls++;
        const earned = log.seller_net || ((log.unit_price || 0) - (log.platform_fee || 0));
        totalSellerEarned += Math.max(0, earned);
        serviceAggMap[sId].totalCalls++;
        serviceAggMap[sId].totalEarned += Math.max(0, earned);
        serviceAggMap[sId].platformFee += (log.platform_fee || 0);
      }
    }

    const aggregatedList = Object.values(serviceAggMap).sort((a, b) => b.totalCalls - a.totalCalls);

    return {
      totalBuyerSpent,
      totalBuyerCalls,
      totalSellerEarned,
      totalSellerCalls,
      aggregatedList
    };
  }, [logs, userAddress]);

  return { loading, logs, stats, refetch: fetchUsage };
}
