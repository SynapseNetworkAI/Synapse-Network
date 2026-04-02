
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useAccount } from "wagmi";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { listServiceRegistry } from "@/utils/serviceApi";
import { extractPricingAmount } from "@/utils/pricing";
import { getProviderEarningsSummary } from "@/utils/providerEarningsApi";
import { buildAuthedHeaders, clearAuthSession } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

const WALLET_SESSION_MISSING_MESSAGE = "Wallet auth session missing. Please sign in with wallet.";

export type ServicePaidRow = {
  ownerAddress: string;
  providerAddress: string;
  serviceId: string;
  amount: number;
  fee: number;
  routingTax: number;
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
    totalApiCalls: 0,
    totalEarned: 0,
    totalFees: 0,
    totalRoutingTax: 0,
    netEarned: 0,
    receivable: 0,
    paidCount24h: 0,
    duplicateRowsDropped: 0,
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
        pricing: extractPricingAmount(service.pricing, "0.00"),
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

  const fetchProviderStatsFromBackend = useCallback(async (providerAddress: string) => {
    try {
      const summary = await getProviderEarningsSummary(providerAddress, 500);
      const safeRows: ServicePaidRow[] = (summary.recentCalls || []).map((row, index) => ({
        ownerAddress: "",
        providerAddress: summary.ownerAddress,
        serviceId: row.serviceId,
        amount: row.unitPrice,
        fee: row.protocolFee,
        routingTax: row.routingTax,
        txHash: row.requestId,
        blockNumber: row.createdAt || index,
        timestamp: row.createdAt,
      }));
      safeRows.sort((a, b) => b.blockNumber - a.blockNumber);
      setPaidEvents(safeRows);

      const now = Math.floor(Date.now() / 1000);
      const dayAgo = now - 24 * 60 * 60;

      const paidCount24h = safeRows.filter((row) => row.timestamp >= dayAgo).length;

      setProviderStats({
        totalApiCalls: summary.totalApiCalls,
        totalEarned: summary.totalEarned,
        totalFees: summary.totalProtocolFee,
        totalRoutingTax: summary.totalRoutingTax,
        netEarned: summary.providerNetEarned,
        receivable: summary.providerReceivable,
        paidCount24h,
        duplicateRowsDropped: summary.duplicateRowsDropped,
      });
    } catch (error) {
      console.error("Failed to fetch provider earnings summary:", error);
      setPaidEvents([]);
      setProviderStats({ totalApiCalls: 0, totalEarned: 0, totalFees: 0, totalRoutingTax: 0, netEarned: 0, receivable: 0, paidCount24h: 0, duplicateRowsDropped: 0 });
    }
  }, []);

  useEffect(() => {
    if (!userAddress) return;
    void loadDashboardServices();
    void fetchProviderStatsFromBackend(userAddress);
  }, [fetchProviderStatsFromBackend, loadDashboardServices, userAddress]);

  useEffect(() => {
    void fetchBalances(userAddress);
  }, [fetchBalances, userAddress]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadDashboardServices();
    await fetchBalances(userAddress);
    if (userAddress) {
      await fetchProviderStatsFromBackend(userAddress);
    }
    setTimeout(() => setIsRefreshing(false), 800);
  }, [fetchBalances, fetchProviderStatsFromBackend, loadDashboardServices, userAddress]);

  const handleLogout = useCallback(async () => {
    if (userAddress) {
      try {
        await fetch(`${getGatewayBaseUrl()}/api/client/logout`, {
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
