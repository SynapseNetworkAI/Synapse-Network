"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Activity, Wallet, ArrowUpRight, ActivitySquare, RefreshCw, HandCoins, LogOut, Copy, Check } from "lucide-react";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import A2APaySyncRouterABI from "@/A2APaySyncRouterABI.json";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import { listServiceRegistry } from "@/utils/serviceApi";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import PaidInvokePanel from "@/components/PaidInvokePanel";
import { buildAuthedHeaders, clearAuthSession } from "@/utils/authSession";

type ServicePaidRow = {
  buyer: string;
  seller: string;
  serviceId: string;
  amount: number;
  fee: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
};

type DashboardService = {
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

type AgentFlowStats = {
  income: number;
  expense: number;
};

export default function Dashboard() {
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

    const ownerAgents = agentStore.getAgentsByOwner(userAddress).sort((a, b) => b.createdAt - a.createdAt);
    setOwnerAgents(ownerAgents);

    const byAgentId: Record<string, AgentIdentity> = {};
    ownerAgents.forEach((agent) => {
      byAgentId[agent.id] = agent;
    });

    const rows = await listServiceRegistry(userAddress, userAddress);
    const mapped = rows
      .map((service) => {
        const agent = service.agentId
          ? byAgentId[service.agentId]
          : ownerAgents.find((item) => item.address.toLowerCase() === service.address.toLowerCase());
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
          const [usdcRaw, ethRaw] = await Promise.all([
            usdcContract.balanceOf(agent.address),
            provider.getBalance(agent.address),
          ]);

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
          if (status !== "RELEASED" && status !== "COMPLETED" && status !== "LOCKED") {
            continue;
          }

          if (task.seller?.toLowerCase() === agent.address.toLowerCase()) {
            income += amount;
          }
          if (task.buyer?.toLowerCase() === agent.address.toLowerCase()) {
            expense += amount;
          }
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
        } catch (e) {
          console.warn("Could not fetch master balance", e);
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
        } catch (e) {
          console.warn(`Could not fetch balance for ${service.sellerAddress}`, e);
          newBalances[service.id] = "0.00";
        }
      }

      setServiceBalances(newBalances);
      setServiceWalletTotal(Number.parseFloat(ethers.formatUnits(total, 18)).toFixed(2));
    } catch (err) {
      console.error("Failed to fetch real on-chain balances:", err);
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
    } catch (err) {
      console.error("Failed to fetch ServicePaid logs:", err);
      setPaidEvents([]);
      setProviderStats({ totalEarned: 0, totalFees: 0, netEarned: 0, paidCount24h: 0 });
    }
  }, []);

  useEffect(() => {
    if (!userAddress) return;
    void loadDashboardServices();
    fetchServicePaidEvents(userAddress);
  }, [fetchServicePaidEvents, loadDashboardServices, userAddress]);

  useEffect(() => {
    fetchBalances(services, userAddress);
  }, [fetchBalances, services, userAddress]);

  useEffect(() => {
    fetchAgentBalances(ownerAgents);
  }, [fetchAgentBalances, ownerAgents]);

  useEffect(() => {
    fetchAgentFlowStats(ownerAgents, userAddress);
  }, [fetchAgentFlowStats, ownerAgents, userAddress]);

  const copyAgentAddress = async (agentId: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAgentId(agentId);
      setTimeout(() => setCopiedAgentId(null), 1200);
    } catch {
      toast.error("Failed to copy address");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const latestServices = await loadDashboardServices();
    await fetchBalances(latestServices, userAddress);
    if (userAddress) {
      await fetchServicePaidEvents(userAddress);
    }
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleLogout = async () => {
    if (userAddress) {
      try {
        await fetch("http://127.0.0.1:8000/api/client/logout", {
          method: "POST",
          headers: {
            ...buildAuthedHeaders(userAddress, false),
          },
        });
      } catch (e) {
        console.warn("Backend logout warning:", e);
      }
    }
    clearAuthSession();
    globalThis.location.href = "/";
  };

  const servicesCountLabel = useMemo(() => `${services.length} registered services`, [services.length]);

  return (
    <div className="p-8 mx-auto space-y-8 max-w-7xl">
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <Bot className="mr-3 text-green-400" />
            Provider Revenue Console
          </h1>
          <p className="mt-2 text-gray-400">Track ServicePaid logs and monitor your on-chain provider earnings.</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleRefresh}
            className="p-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800"
            title="Refresh Provider Metrics"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin text-green-400" : ""}`} />
          </button>
          <Link href="/dashboard/services" className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600">
            Server Management
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center px-4 py-2 font-bold text-red-400 transition-colors border rounded-lg border-red-500/50 hover:bg-red-500/10"
            title="Disconnect Terminal"
          >
            <LogOut className="w-5 h-5 mr-2" />
            Logout
          </button>
        </div>
      </div>

      <div className="mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-yellow-500">Tier 1: Provider Treasury (Master Wallet)</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-400">Master USDC Balance</h3>
            <Wallet className="w-5 h-5 text-yellow-500" />
          </div>
          <div className="mb-2 text-4xl font-bold text-white">
            <span className="text-yellow-500">$</span>
            {masterBalance}
          </div>
          <p className="font-mono text-xs text-gray-500 truncate">{userAddress || "Not Connected"}</p>
        </div>

        <div className="relative flex flex-col justify-center p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <h3 className="mb-2 text-sm font-medium text-gray-400">Fund Router & Auto-Top-Up</h3>
          <p className="mb-4 text-xs text-gray-500">Manage smart contract daily limits and relayer settings for your service wallets.</p>
          <Link href="/dashboard/router" className="flex items-center justify-center w-full px-4 py-3 text-sm font-bold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-600">
            <ActivitySquare className="w-5 h-5 mr-2" />
            Configure Smart Contract Limits
          </Link>
        </div>
      </div>

      <div className="mt-12 mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-green-500">Tier 2: Service Analytics</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-4">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Service Wallets Total</h3>
            <Wallet className="w-5 h-5 text-green-500" />
          </div>
          <div className="mb-1 text-3xl font-bold text-white">
            <span className="text-green-500">$</span>
            {services.length > 0 ? serviceWalletTotal : "0.00"}
          </div>
          <p className="text-xs text-gray-500">Across {servicesCountLabel}</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Total Earned</h3>
            <ArrowUpRight className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-emerald-400">+${providerStats.totalEarned.toFixed(2)}</div>
          <p className="text-xs text-gray-500">From ServicePaid logs</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Total Platform Fee</h3>
            <Activity className="w-5 h-5 text-red-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-red-400">-${providerStats.totalFees.toFixed(2)}</div>
          <p className="text-xs text-gray-500">Protocol fee from paid logs</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Paid Calls (24h)</h3>
            <ActivitySquare className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-blue-400">{providerStats.paidCount24h}</div>
          <p className="text-xs text-gray-500">Seller = connected wallet</p>
        </div>
      </div>

      {services.length === 0 ? (
        <div className="border border-gray-800 rounded-xl bg-gray-900/20">
          <div className="px-6 py-4 border-b border-gray-800 bg-black/40">
            <h3 className="text-lg font-semibold text-white">Agents Under This Wallet</h3>
            <p className="mt-1 text-xs text-gray-500">Showing agent address and on-chain balances (USDC / ETH).</p>
          </div>

          {ownerAgents.length === 0 ? (
            <div className="py-20 text-center border border-gray-800 border-dashed rounded-b-xl bg-gray-900/20">
              <Bot className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <h3 className="text-xl font-medium text-gray-300">No Agents Found</h3>
              <p className="mt-2 text-gray-500">Create your first agent in Agent Management.</p>
              <Link href="/dashboard/agents" className="inline-flex items-center px-4 py-2 mt-4 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600">
                Go to Agent Management
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="px-6 py-3">Agent</th>
                    <th className="px-6 py-3">Address</th>
                    <th className="px-6 py-3 text-right">Income / Expense</th>
                    <th className="px-6 py-3 text-right">USDC Balance</th>
                    <th className="px-6 py-3 text-right">ETH Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/80">
                  {ownerAgents.map((agent) => (
                    <tr key={agent.id} className="transition-colors hover:bg-gray-900/40">
                      <td className="px-6 py-4 text-white">
                        <div className="font-semibold">{agent.name}</div>
                        <div className="text-xs text-gray-500">{agent.role || "seller"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="inline-flex items-center gap-2 px-3 py-2 font-mono text-xs text-gray-300 border rounded-lg bg-gray-900/50 border-gray-800/50 max-w-[420px]">
                          <span className="truncate">{agent.address}</span>
                          <button
                            onClick={() => copyAgentAddress(agent.id, agent.address)}
                            className="text-gray-300 transition-colors hover:text-white"
                            aria-label="Copy agent address"
                          >
                            {copiedAgentId === agent.id ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-right">
                        <div className="text-green-400">+{(agentFlowStats[agent.id]?.income || 0).toFixed(2)}</div>
                        <div className="text-red-400">-{(agentFlowStats[agent.id]?.expense || 0).toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-right text-green-400">{agentUsdcBalances[agent.id] || "0.00"}</td>
                      <td className="px-6 py-4 font-mono text-right text-blue-400">{agentEthBalances[agent.id] || "0.0000"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <div key={service.id} className="relative p-6 overflow-hidden transition-all bg-black border border-gray-800 rounded-xl group hover:border-green-900/50">
              <div className="absolute top-0 left-0 w-full h-1 transition-all bg-gradient-to-r from-gray-800 to-gray-700 group-hover:from-green-500 group-hover:to-emerald-800"></div>

              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
                    <Bot className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold leading-tight text-green-400">{service.name}</h3>
                    <span className="font-mono text-xs tracking-wide text-gray-500">{service.agentName} / {service.agentRole}</span>
                  </div>
                </div>
                <div className={`flex items-center px-2 py-1 text-xs border rounded-full ${service.isActive ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-gray-400 bg-gray-700/20 border-gray-600/50"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${service.isActive ? "bg-green-400 animate-pulse" : "bg-gray-500"}`}></span>
                  {service.isActive ? "Active" : "Inactive"}
                </div>
              </div>

              <div className="mb-4 space-y-2">
                <div className="text-[11px] font-mono text-gray-500">
                  Service ID: <span className="text-blue-300">{service.serviceId || "UNSET"}</span>
                </div>
                <div className="text-[11px] font-mono text-gray-500">
                  Pricing: <span className="text-green-300">{service.pricing || "0.00"} USDC</span>
                </div>
                <div className="text-[11px] font-mono text-gray-500 truncate">
                  Endpoint: <span className="text-gray-300">{service.endpoint || "Not configured"}</span>
                </div>
              </div>

              <div className="mb-6 space-y-4">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Seller Wallet Address</span>
                  <div className="px-3 py-2 mt-1 font-mono text-sm text-gray-300 truncate border rounded select-all bg-gray-900/50 border-gray-800/50">
                    {service.sellerAddress}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-900/40 border-gray-800/50">
                  <span className="text-sm text-gray-400">Balance</span>
                  <div className="flex items-center gap-1 font-mono">
                    <span className="text-green-500">$</span>
                    <span className="text-gray-200">{serviceBalances[service.id] || "0.00"}</span>
                    <span className="ml-1 text-xs text-gray-500">USDC</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => toast.success("Mock: Funding seller wallet from provider wallet...")}
                  className="flex items-center justify-center flex-1 py-2 text-sm font-medium text-green-400 transition-colors bg-gray-900 border rounded-lg hover:bg-gray-800 border-green-900/30 hover:border-green-500/50"
                >
                  <HandCoins className="w-4 h-4 mr-1.5" />
                  Fund
                </button>

                <button
                  onClick={() => toast.success(`Mock: Sweeping USDC from ${service.name} to provider wallet.`)}
                  className="flex items-center justify-center flex-1 py-2 text-sm font-medium text-blue-400 transition-colors bg-gray-900 border rounded-lg hover:bg-gray-800 border-blue-900/30 hover:border-blue-500/50"
                >
                  <ArrowUpRight className="w-4 h-4 mr-1.5" />
                  Sweep
                </button>

                <Link href={`/dashboard/services/${service.agentId}`} className="flex items-center justify-center flex-1 w-full h-full p-2 text-sm font-medium text-white transition-colors bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700" title="Agent Details">
                  <Activity className="w-4 h-4" />
                </Link>
              </div>

              <div className="mt-4">
                <PaidInvokePanel
                  sellerAddress={service.sellerAddress}
                  endpoint={service.endpoint}
                  serviceId={service.serviceId}
                  pricing={service.pricing}
                  isActive={service.isActive}
                  title="Quick Pay & Invoke"
                  compact
                  defaultCollapsed
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-12 mb-6">
        <h2 className="flex items-center gap-2 pl-3 text-xl font-bold text-white border-l-4 border-blue-500">
          <Activity className="w-5 h-5 text-blue-500" /> ServicePaid Event Stream
        </h2>
      </div>
      <div className="overflow-hidden bg-black border border-gray-800 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-6 py-4 font-medium tracking-wider">Service ID</th>
                <th className="px-6 py-4 font-medium tracking-wider">Buyer</th>
                <th className="px-6 py-4 font-medium tracking-wider text-right">Amount (USDC)</th>
                <th className="px-6 py-4 font-medium tracking-wider text-right">Fee (USDC)</th>
                <th className="px-6 py-4 font-medium tracking-wider">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80">
              {paidEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 bg-gray-900/10">No ServicePaid events found for current seller address.</td>
                </tr>
              ) : (
                paidEvents.slice(0, 20).map((event) => (
                  <tr key={`${event.txHash}-${event.blockNumber}`} className="transition-colors hover:bg-gray-900/50">
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-1 text-xs text-blue-300 border rounded bg-blue-500/10 border-blue-500/30">
                        {event.serviceId}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block w-40 font-mono text-xs text-gray-500 truncate">{event.buyer}</span>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-right text-green-400">+{event.amount.toFixed(4)}</td>
                    <td className="px-6 py-4 font-mono font-bold text-right text-red-400">-{event.fee.toFixed(4)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-mono text-xs text-blue-500">
                        {`${event.txHash.substring(0, 8)}...${event.txHash.substring(event.txHash.length - 6)}`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
