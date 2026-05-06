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
import { getRpcUrl } from "@/utils/runtimeEnv";

const WALLET_SESSION_MISSING_MESSAGE =
  "Wallet auth session missing. Please sign in with wallet.";

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

const EMPTY_PROVIDER_STATS = {
  totalApiCalls: 0,
  totalEarned: 0,
  totalFees: 0,
  totalRoutingTax: 0,
  netEarned: 0,
  receivable: 0,
  matureReceivable: 0,
  withdrawMaturityEnforced: true,
  paidCount24h: 0,
  duplicateRowsDropped: 0,
};

function mapDashboardService(
  service: Awaited<ReturnType<typeof listServiceRegistry>>[number]
) {
  return {
    id: service.id,
    name: service.name,
    serviceId: service.serviceId,
    pricing: extractPricingAmount(service.pricing, "0.00"),
    endpoint: service.endpoint,
    isActive: service.isActive,
  };
}

function countRecentPaidRows(rows: ServicePaidRow[]) {
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60;
  return rows.filter((row) => row.timestamp >= dayAgo).length;
}

function useDashboardServices(userAddress: string | undefined) {
  const [services, setServices] = useState<DashboardService[]>([]);

  const loadDashboardServices = useCallback(async (): Promise<
    DashboardService[]
  > => {
    if (!userAddress) {
      setServices([]);
      return [];
    }

    try {
      const rows = await listServiceRegistry(userAddress, userAddress);
      const mapped = rows.map(mapDashboardService);

      setServices(mapped);
      return mapped;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load services";
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
        setServices([]);
        return [];
      }
      throw error;
    }
  }, [userAddress]);

  return { services, loadDashboardServices };
}

function useMasterBalance() {
  const [masterBalance, setMasterBalance] = useState("0.00");

  const fetchBalances = useCallback(async (masterAddr: string | undefined) => {
    if (!masterAddr) return;

    try {
      const provider = new ethers.JsonRpcProvider(getRpcUrl());
      const usdcContract = new ethers.Contract(
        contractConfig.MockUSDC,
        MockUSDCABI,
        provider
      );
      const mBal = await usdcContract.balanceOf(masterAddr);
      setMasterBalance(
        Number.parseFloat(ethers.formatUnits(mBal, 18)).toFixed(2)
      );
    } catch (error) {
      console.warn("Could not fetch master balance", error);
    }
  }, []);

  return { masterBalance, fetchBalances };
}

function useProviderStatsData() {
  const [paidEvents, setPaidEvents] = useState<ServicePaidRow[]>([]);
  const [providerStats, setProviderStats] = useState(EMPTY_PROVIDER_STATS);

  const fetchProviderStatsFromBackend = useCallback(
    async (providerAddress: string) => {
      try {
        const summary = await getProviderEarningsSummary(providerAddress, 500);
        const safeRows: ServicePaidRow[] = (summary.recentCalls || []).map(
          (row, index) => ({
            ownerAddress: "",
            providerAddress: summary.ownerAddress,
            serviceId: row.serviceId,
            amount: row.unitPrice,
            fee: row.protocolFee,
            routingTax: row.routingTax,
            txHash: row.requestId,
            blockNumber: row.createdAt || index,
            timestamp: row.createdAt,
          })
        );
        safeRows.sort((a, b) => b.blockNumber - a.blockNumber);
        setPaidEvents(safeRows);

        setProviderStats({
          totalApiCalls: summary.totalApiCalls,
          totalEarned: summary.totalEarned,
          totalFees: summary.totalProtocolFee,
          totalRoutingTax: summary.totalRoutingTax,
          netEarned: summary.providerNetEarned,
          receivable: summary.providerReceivable,
          matureReceivable:
            summary.providerMatureReceivable ?? summary.providerReceivable,
          withdrawMaturityEnforced:
            summary.providerWithdrawMaturityEnforced !== false,
          paidCount24h: countRecentPaidRows(safeRows),
          duplicateRowsDropped: summary.duplicateRowsDropped,
        });
      } catch (error) {
        console.error("Failed to fetch provider earnings summary:", error);
        setPaidEvents([]);
        setProviderStats(EMPTY_PROVIDER_STATS);
      }
    },
    []
  );

  return { paidEvents, providerStats, fetchProviderStatsFromBackend };
}

export function useDashboardData() {
  const { address: userAddress } = useAccount();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const { services, loadDashboardServices } = useDashboardServices(userAddress);
  const { masterBalance, fetchBalances } = useMasterBalance();
  const { paidEvents, providerStats, fetchProviderStatsFromBackend } =
    useProviderStatsData();

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
    await (userAddress
      ? fetchProviderStatsFromBackend(userAddress)
      : Promise.resolve());
    setTimeout(() => setIsRefreshing(false), 800);
  }, [
    fetchBalances,
    fetchProviderStatsFromBackend,
    loadDashboardServices,
    userAddress,
  ]);

  const handleLogout = useCallback(async () => {
    if (!userAddress) {
      clearAuthSession();
      globalThis.location.href = "/";
      return;
    }

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
