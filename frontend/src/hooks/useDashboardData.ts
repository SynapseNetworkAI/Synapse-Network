
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useAccount } from "wagmi";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import A2APaySyncRouterABI from "@/A2APaySyncRouterABI.json";
import { listServiceRegistry } from "@/utils/serviceApi";
import { buildAuthedHeaders, clearAuthSession } from "@/utils/authSession";

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

export type ServicePaidRow = {
  buyer: string;
  seller: string;
  serviceId: string;
  amount: number;
  fee: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
};

export type DashboardService = {
  id: string;
  name: string;
  serviceId: string;
  pricing: string;
  endpoint: string;
  isActive: boolean;
};

export type FlowStats = {
  income: number;
  expense: number;
};

export function useDashboardData() {
  const { address: userAddress } = useAccount();
  const [services, setServices] = useState<DashboardService[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [masterBalance, setMasterBalance] = useState("0.00");
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [paidEvents, setPaidEvents] = useState<ServicePaidRow[]>([]);
  const [providerStats, setProviderStats] = useState({
    totalEarned: 0,
    totalFees: 0,
    netEarned: 0,
    paidCount24h: 0,
  });

  const loadDashboardServices = useCallback(async (): Promise<DashboardService[]> => {
    if (!userAddress) {
      setServices([]);
      return [];
    }

    try {
      const rows = await listServiceRegistry(userAddress, userAddress);
      const mapped = rows.map((service) => ({
        id: service.id,
        name: service.name,
        serviceId: service.serviceId,
        pricing: service.pricing,
        endpoint: service.endpoint,
        isActive: service.isActive,
      }));

      setServices(mapped);
      return mapped;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load services";
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
        setServices([]);
        return [];
      }
      throw error;
    }
  }, [userAddress]);

  const fetchBalances = useCallback(async (masterAddr: string | undefined) => {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);

      if (masterAddr) {
        try {
          const mBal = await usdcContract.balanceOf(masterAddr);
          setMasterBalance(Number.parseFloat(ethers.formatUnits(mBal, 18)).toFixed(2));
        } catch (error) {
          console.warn("Could not fetch master balance", error);
        }
      }
    } catch (error) {
      console.error("Failed to fetch real on-chain balances:", error);
    }
  }, []);

  const fetchServicePaidEvents = useCallback(async (sellerAddr: string) => {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const router = new ethers.Contract(contractConfig.A2APaySyncRouter, A2APaySyncRouterABI, provider);

      const filter = router.filters.ServicePaid(null, sellerAddr, null);
      const logs = await router.queryFilter(filter, 0, "latest");

      const rows = await Promise.all(
        logs.map(async (log) => {
          if (!("args" in log) || !log.args || log.args.length < 6) return null;

          const block = await provider.getBlock(log.blockNumber);
          const timestamp = block?.timestamp ? Number(block.timestamp) : 0;
          const amount = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[3]), 18));
          const fee = Number.parseFloat(ethers.formatUnits(ethers.toBigInt(log.args[4]), 18));

          return {
            buyer: String(log.args[0]),
            seller: String(log.args[1]),
            serviceId: String(log.args[5]),
            amount,
            fee,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            timestamp,
          } satisfies ServicePaidRow;
        })
      );

      const safeRows = rows.filter((row): row is ServicePaidRow => row !== null);
      safeRows.sort((a, b) => b.blockNumber - a.blockNumber);
      setPaidEvents(safeRows);

      const now = Math.floor(Date.now() / 1000);
      const dayAgo = now - 24 * 60 * 60;

      const totalEarned = safeRows.reduce((sum, row) => sum + row.amount, 0);
      const totalFees = safeRows.reduce((sum, row) => sum + row.fee, 0);
      const paidCount24h = safeRows.filter((row) => row.timestamp >= dayAgo).length;

      setProviderStats({
        totalEarned,
        totalFees,
        netEarned: totalEarned - totalFees,
        paidCount24h,
      });
    } catch (error) {
      console.error("Failed to fetch ServicePaid logs:", error);
      setPaidEvents([]);
      setProviderStats({ totalEarned: 0, totalFees: 0, netEarned: 0, paidCount24h: 0 });
    }
  }, []);

  useEffect(() => {
    if (!userAddress) return;
    void loadDashboardServices();
    void fetchServicePaidEvents(userAddress);
  }, [fetchServicePaidEvents, loadDashboardServices, userAddress]);

  useEffect(() => {
    void fetchBalances(userAddress);
  }, [fetchBalances, userAddress]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadDashboardServices();
    await fetchBalances(userAddress);
    if (userAddress) {
      await fetchServicePaidEvents(userAddress);
    }
    setTimeout(() => setIsRefreshing(false), 800);
  }, [fetchBalances, fetchServicePaidEvents, loadDashboardServices, userAddress]);

  const handleLogout = useCallback(async () => {
    if (userAddress) {
      try {
        await fetch("http://127.0.0.1:8000/api/client/logout", {
          method: "POST",
          headers: {
            ...buildAuthedHeaders(userAddress, false),
          },
        });
      } catch (error) {
        console.warn("Backend logout warning:", error);
      }
    }
    clearAuthSession();
    globalThis.location.href = "/";
  }, [userAddress]);

  const platformFeeRatePercent = useMemo(() => {
    if (providerStats.totalEarned <= 0) return null;
    return (providerStats.totalFees / providerStats.totalEarned) * 100;
  }, [providerStats.totalEarned, providerStats.totalFees]);

  return {
    userAddress,
    services,
    isRefreshing,
    masterBalance,
    copiedAddress,
    setCopiedAddress,
    paidEvents,
    providerStats,
    platformFeeRatePercent,
    handleRefresh,
    handleLogout,
  };
}
