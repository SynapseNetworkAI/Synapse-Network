"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import A2APaySyncRouterABI from "@/A2APaySyncRouterABI.json";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
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
  agentId: string;
  name: string;
  serviceId: string;
  pricing: string;
  endpoint: string;
  isActive: boolean;
  agentName: string;
  agentRole: string;
  sellerAddress: string;
};

export type AgentFlowStats = {
  income: number;
  expense: number;
};

export function useDashboardData() {
  const { address: userAddress } = useAccount();
  const [services, setServices] = useState<DashboardService[]>([]);
  const [ownerAgents, setOwnerAgents] = useState<AgentIdentity[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [masterBalance, setMasterBalance] = useState("0.00");
  const [serviceBalances, setServiceBalances] = useState<Record<string, string>>({});
  const [serviceWalletTotal, setServiceWalletTotal] = useState("0.00");
  const [agentUsdcBalances, setAgentUsdcBalances] = useState<Record<string, string>>({});
  const [agentEthBalances, setAgentEthBalances] = useState<Record<string, string>>({});
  const [agentFlowStats, setAgentFlowStats] = useState<Record<string, AgentFlowStats>>({});
  const [copiedAgentId, setCopiedAgentId] = useState<string | null>(null);
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
      setOwnerAgents([]);
      return [];
    }

    const currentOwnerAgents = agentStore.getAgentsByOwner(userAddress).sort((a, b) => b.createdAt - a.createdAt);
    setOwnerAgents(currentOwnerAgents);

    const byAgentId: Record<string, AgentIdentity> = {};
    currentOwnerAgents.forEach((agent) => {
      byAgentId[agent.id] = agent;
    });

    try {
      const rows = await listServiceRegistry(userAddress, userAddress);
      const mapped = rows
        .map((service) => {
          const agent = service.agentId
            ? byAgentId[service.agentId]
            : currentOwnerAgents.find((item) => item.address.toLowerCase() === service.address.toLowerCase());
          if (!agent) return null;
          return {
            id: service.id,
            agentId: service.agentId || agent.id,
            name: service.name,
            serviceId: service.serviceId,
            pricing: service.pricing,
            endpoint: service.endpoint,
            isActive: service.isActive,
            agentName: agent.name,
            agentRole: agent.role || "seller",
            sellerAddress: service.address || agent.address,
          } satisfies DashboardService;
        })
        .filter((row): row is DashboardService => row !== null);

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

  const fetchAgentBalances = useCallback(async (agents: AgentIdentity[]) => {
    if (agents.length === 0) {
      setAgentUsdcBalances({});
      setAgentEthBalances({});
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);

      const nextUsdc: Record<string, string> = {};
      const nextEth: Record<string, string> = {};

      for (const agent of agents) {
        try {
          const [usdcRaw, ethRaw] = await Promise.all([usdcContract.balanceOf(agent.address), provider.getBalance(agent.address)]);
          nextUsdc[agent.id] = Number.parseFloat(ethers.formatUnits(usdcRaw, 18)).toFixed(2);
          nextEth[agent.id] = Number.parseFloat(ethers.formatEther(ethRaw)).toFixed(4);
        } catch {
          nextUsdc[agent.id] = "0.00";
          nextEth[agent.id] = "0.0000";
        }
      }

      setAgentUsdcBalances(nextUsdc);
      setAgentEthBalances(nextEth);
    } catch {
      setAgentUsdcBalances({});
      setAgentEthBalances({});
    }
  }, []);

  const fetchAgentFlowStats = useCallback(async (agents: AgentIdentity[], ownerAddress: string | undefined) => {
    if (!ownerAddress || agents.length === 0) {
      setAgentFlowStats({});
      return;
    }

    const nextStats: Record<string, AgentFlowStats> = {};

    for (const agent of agents) {
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/client/tasks?agent=${agent.address}`, {
          headers: {
            ...buildAuthedHeaders(ownerAddress, false),
          },
        });

        if (!response.ok) {
          nextStats[agent.id] = { income: 0, expense: 0 };
          continue;
        }

        const tasks = (await response.json()) as Array<{ amount?: string; status?: string; seller?: string; buyer?: string }>;
        let income = 0;
        let expense = 0;

        for (const task of tasks) {
          const amount = Number.parseFloat(task.amount || "0");
          const status = (task.status || "").toUpperCase();
          if (status !== "RELEASED" && status !== "COMPLETED" && status !== "LOCKED") continue;
          if (task.seller?.toLowerCase() === agent.address.toLowerCase()) income += amount;
          if (task.buyer?.toLowerCase() === agent.address.toLowerCase()) expense += amount;
        }

        nextStats[agent.id] = { income, expense };
      } catch {
        nextStats[agent.id] = { income: 0, expense: 0 };
      }
    }

    setAgentFlowStats(nextStats);
  }, []);

  const fetchBalances = useCallback(async (currentServices: DashboardService[], masterAddr: string | undefined) => {
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

      const newBalances: Record<string, string> = {};
      let total = BigInt(0);

      for (const service of currentServices) {
        if (!service.sellerAddress) continue;
        try {
          const bal = await usdcContract.balanceOf(service.sellerAddress);
          total += bal;
          newBalances[service.id] = Number.parseFloat(ethers.formatUnits(bal, 18)).toFixed(2);
        } catch (error) {
          console.warn(`Could not fetch balance for ${service.sellerAddress}`, error);
          newBalances[service.id] = "0.00";
        }
      }

      setServiceBalances(newBalances);
      setServiceWalletTotal(Number.parseFloat(ethers.formatUnits(total, 18)).toFixed(2));
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
    void fetchBalances(services, userAddress);
  }, [fetchBalances, services, userAddress]);

  useEffect(() => {
    void fetchAgentBalances(ownerAgents);
  }, [fetchAgentBalances, ownerAgents]);

  useEffect(() => {
    void fetchAgentFlowStats(ownerAgents, userAddress);
  }, [fetchAgentFlowStats, ownerAgents, userAddress]);

  const copyAgentAddress = useCallback(async (agentId: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAgentId(agentId);
      setTimeout(() => setCopiedAgentId(null), 1200);
    } catch {
      toast.error("Failed to copy address");
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    const latestServices = await loadDashboardServices();
    await fetchBalances(latestServices, userAddress);
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
    ownerAgents,
    isRefreshing,
    masterBalance,
    serviceBalances,
    serviceWalletTotal,
    agentUsdcBalances,
    agentEthBalances,
    agentFlowStats,
    copiedAgentId,
    paidEvents,
    providerStats,
    platformFeeRatePercent,
    copyAgentAddress,
    handleRefresh,
    handleLogout,
  };
}
