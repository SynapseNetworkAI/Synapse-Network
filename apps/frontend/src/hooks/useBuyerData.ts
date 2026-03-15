"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getV2Balance } from "@/utils/balanceApi";
import { listUsageLogs, type UsageLogRecord } from "@/utils/usageApi";
import { clearAuthSession } from "@/utils/authSession";
import { useAuth } from "@/components/WalletAuthGuard";

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

export type BuyerStats = {
  buyerBalance: string;
  todaySpend: string;
  todayCalls: number;
  blockedCalls: number;
};

export function useBuyerData() {
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const [stats, setStats] = useState<BuyerStats>({
    buyerBalance: "0.00",
    todaySpend: "0.00",
    todayCalls: 0,
    blockedCalls: 0,
  });

  const [logs, setLogs] = useState<UsageLogRecord[]>([]);

  const fetchBuyerData = useCallback(async (addr: string) => {
    if (!addr) return;
    try {
      const balanceSummary = await getV2Balance(addr);
      let usageLogs: UsageLogRecord[] = [];
      try {
          usageLogs = await listUsageLogs(addr, 500);
      } catch (logErr) {
          console.warn("Failed to fetch buyer logs:", logErr);
      }
      
      const buyerLogs = usageLogs.filter(log => (log.buyer || "").toLowerCase() === addr.toLowerCase());
      const todayKey = Math.floor(Date.now() / 1000 / 86400);
      
      let todayCalls = 0;
      let blockedCalls = 0;
      
      buyerLogs.forEach(log => {
          if (log.created_at) {
              const logDay = Math.floor(log.created_at / 86400);
              if (logDay === todayKey) {
                  todayCalls++;
                  if (log.status !== "succeeded" && log.status !== "accepted") {
                      blockedCalls++;
                  }
              }
          }
      });
      
      setStats({
        buyerBalance: (balanceSummary.buyerBalance || 0).toFixed(2),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        todaySpend: ((balanceSummary as any).dailySpendUsed || 0).toFixed(2),
        todayCalls,
        blockedCalls
      });
      
      setLogs(buyerLogs);
      
    } catch (error) {
      console.error("Failed to fetch buyer data:", error);
      const message = error instanceof Error ? error.message : String(error);
      if (message === WALLET_SESSION_MISSING_MESSAGE || message.includes("auth session missing") || message.includes("401")) {
        clearAuthSession();
      }
    }
  }, []);

  useEffect(() => {
    if (isConnected && userAddress && isSessionAuthenticated) {
      void fetchBuyerData(userAddress);
    } else {
      setStats({
        buyerBalance: "0.00",
        todaySpend: "0.00",
        todayCalls: 0,
        blockedCalls: 0,
      });
      setLogs([]);
    }
  }, [isConnected, isSessionAuthenticated, userAddress, fetchBuyerData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    if (isConnected && userAddress && isSessionAuthenticated) {
      await fetchBuyerData(userAddress);
    }
    setTimeout(() => setIsRefreshing(false), 500);
  }, [isConnected, isSessionAuthenticated, userAddress, fetchBuyerData]);

  return {
    userAddress,
    isRefreshing,
    stats,
    logs,
    handleRefresh,
  };
}
