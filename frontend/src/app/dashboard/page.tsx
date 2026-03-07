"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Bot, Activity, Wallet, ArrowUpRight, ArrowDownRight, ActivitySquare, RefreshCw, HandCoins, LogOut } from "lucide-react";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";

export default function Dashboard() {
  const { address: userAddress } = useAccount();
  const [agents, setAgents] = useState<AgentIdentity[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [masterBalance, setMasterBalance] = useState("0.00");
  const [agentBalances, setAgentBalances] = useState<Record<string, string>>({});
  const [totalBalance, setTotalBalance] = useState("0.00");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tasks, setTasks] = useState<any[]>([]);
  const [fleetStats, setFleetStats] = useState({ revenue: 0, expense: 0, profit: 0 });

  const fetchBalances = async (currentAgents: AgentIdentity[], masterAddr: string | undefined) => {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);                                                                       
      
      if (masterAddr) {
        try {
          const mBal = await usdcContract.balanceOf(masterAddr);
          setMasterBalance(parseFloat(ethers.formatUnits(mBal, 18)).toFixed(2));
        } catch (e) { console.warn("Could not fetch master balance", e); }
      }

      const newBalances: Record<string, string> = {};
let total = BigInt(0);

      for (const agent of currentAgents) {
        if (!agent.address) continue;
        try {
          const bal = await usdcContract.balanceOf(agent.address);
          total += bal;
          newBalances[agent.id] = parseFloat(ethers.formatUnits(bal, 18)).toFixed(2);
        } catch (e) {
          console.warn(`Could not fetch balance for ${agent.address}`, e);
          newBalances[agent.id] = "0.00";
        }
      }
      
      setAgentBalances(newBalances);
      setTotalBalance(parseFloat(ethers.formatUnits(total, 18)).toFixed(2));
    } catch (err) {
      console.error("Failed to fetch real on-chain balances:", err);
    }
  };

  useEffect(() => {
    if (!userAddress) return;
    const loadedAgents = agentStore.getAgentsByOwner(userAddress);
    setAgents(loadedAgents);
    fetchBalances(loadedAgents, userAddress);
    fetchTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress]);

  const fetchTasks = async () => {
    if (!userAddress) return;
    try {
      const res = await fetch("http://127.0.0.1:8000/api/client/fleet/tasks", {
        headers: {
          "Authorization": "Bearer active",
          "X-User-Address": userAddress
        }
      });
      if(res.ok) {
        const data = await res.json();
        const tasksData = data.data || data;
        setTasks(tasksData);
        
        let rev = 0;
        let exp = 0;
        const fleetAddresses = agentStore.getAgentsByOwner(userAddress).map(a => a.address?.toLowerCase());

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tasksData.forEach((t: any) => {
          const amt = parseFloat(t.amount || "0");
          if (t.status === "RELEASED" || t.status === "COMPLETED" || t.status === "LOCKED") {
             if (t.seller && fleetAddresses.includes(t.seller.toLowerCase())) rev += amt;
             if (t.buyer && fleetAddresses.includes(t.buyer.toLowerCase())) exp += amt;
          }
        });
        setFleetStats({ revenue: rev, expense: exp, profit: rev - exp });
      }
    } catch(e) {
      console.warn("Could not fetch fleet tasks", e);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchBalances(agents, userAddress);
    await fetchTasks();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleLogout = async () => {
    try {
      await fetch("http://127.0.0.1:8000/api/client/logout", {
        method: "POST",
        headers: {
          "Authorization": "Bearer active",
          "X-User-Address": userAddress || ""
        }
      });
    } catch (e) {
      console.warn("Backend logout warning:", e);
    }
    localStorage.removeItem("developer_session");
    window.location.href = "/";
  };

  // Real dynamic stats derived from Indexer FastAPI (Phase 12)
  return (
    <div className="p-8 mx-auto space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-800">
        <div>
          <h1 className="flex items-center text-3xl font-bold text-white">
            <Bot className="mr-3 text-green-400" />
            Master Fleet Control
          </h1>
          <p className="mt-2 text-gray-400">Manage your autonomous AI entities and aggregate financial flows</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={handleRefresh}
            className="p-2 text-gray-300 transition-colors bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800"
            title="Refresh Fleet Status"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-green-400' : ''}`} />
          </button>
          <Link href="/dashboard/agents/create" className="flex items-center px-6 py-2 font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-600">
              <Plus className="w-5 h-5 mr-2" />
              Deploy Agent
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

      
      {/* Tier 1: User / Global Treasury (Macro Ledger) */}
      <div className="mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-yellow-500">
          Tier 1: Global Treasury (Master Wallet)
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-2">
             <h3 className="text-sm font-medium text-gray-400">Master USDC Balance</h3>
             <Wallet className="w-5 h-5 text-yellow-500" />
          </div>
          <div className="mb-2 text-4xl font-bold text-white">
             <span className="text-yellow-500">$</span>{masterBalance}
          </div>
          <p className="font-mono text-xs text-gray-500 truncate">{userAddress || "Not Connected"}</p>
        </div>
        
        <div className="relative flex flex-col justify-center p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
            <h3 className="mb-2 text-sm font-medium text-gray-400">Fund Router & Auto-Top-Up</h3>
            <p className="mb-4 text-xs text-gray-500">Manage smart contract daily limits and relayer settings for your agent sub-wallets.</p>
            <Link href="/dashboard/router" className="flex items-center justify-center w-full px-4 py-3 text-sm font-bold text-black transition-colors bg-yellow-500 rounded-lg hover:bg-yellow-600">
                 <ActivitySquare className="w-5 h-5 mr-2" />
                 Configure Smart Contract Limits
            </Link>
        </div>
      </div>

      <div className="mt-12 mb-4">
        <h2 className="pl-3 text-xl font-bold text-white border-l-4 border-green-500">
          Tier 2: Agent Fleet & Micro Ledgers
        </h2>
      </div>

      {/* Global Overview Module */}

      <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-4">
        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Aggregated Balance</h3>
            <Wallet className="w-5 h-5 text-green-500" />
          </div>
          <div className="mb-1 text-3xl font-bold text-white"><span className="text-green-500">$</span>{agents.length > 0 ? totalBalance : "0.00"}</div>
          <p className="text-xs text-gray-500">Master + {agents.length} Sub-Wallets</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">24h Revenue</h3>
            <ArrowUpRight className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-emerald-400">{agents.length > 0 ? `+$${fleetStats.revenue.toFixed(2)}` : "$0.00"}</div>
          <p className="text-xs text-gray-500">From AI services</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">24h Expense / Gas</h3>
            <ArrowDownRight className="w-5 h-5 text-red-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-red-400">{agents.length > 0 ? `-$${fleetStats.expense.toFixed(2)}` : "$0.00"}</div>
          <p className="text-xs text-gray-500">On-chain transaction costs</p>
        </div>

        <div className="relative p-6 overflow-hidden bg-black border border-gray-800 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400">Net Profit (24h)</h3>
            <ActivitySquare className="w-5 h-5 text-blue-400" />
          </div>
          <div className="mb-1 text-2xl font-bold text-blue-400">{agents.length > 0 ? `${fleetStats.profit >= 0 ? '+' : '-'}$${Math.abs(fleetStats.profit).toFixed(2)}` : "$0.00"}</div>
          <p className="text-xs text-gray-500">Auto-calculated</p>
        </div>
      </div>



      {/* Fleet Table / Cards Module */}
      {agents.length === 0 ? (
        <div className="py-20 text-center border border-gray-800 border-dashed rounded-xl bg-gray-900/20">
          <Bot className="w-12 h-12 mx-auto mb-4 text-gray-600" />
          <h3 className="text-xl font-medium text-gray-300">No Agents Deployed</h3>
          <p className="mt-2 text-gray-500">Create your first AI agent to start processing autonomous transactions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents.map(agent => (
            <div key={agent.id} className="relative p-6 overflow-hidden transition-all bg-black border border-gray-800 rounded-xl group hover:border-green-900/50">
              <div className="absolute top-0 left-0 w-full h-1 transition-all bg-gradient-to-r from-gray-800 to-gray-700 group-hover:from-green-500 group-hover:to-emerald-800"></div>
              
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
                    <Bot className="w-6 h-6 text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold leading-tight text-green-400">{agent.name}</h3>
                    <span className="font-mono text-xs tracking-wide text-gray-500">{agent.role}</span>
                  </div>
                </div>
                <div className="flex items-center px-2 py-1 text-xs text-green-400 border rounded-full bg-green-500/10 border-green-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 animate-pulse"></span>
                  Active
                </div>
              </div>
              
              <div className="mb-6 space-y-4">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Sub-Wallet Address</label>
                  <div className="px-3 py-2 mt-1 font-mono text-sm text-gray-300 truncate border rounded select-all bg-gray-900/50 border-gray-800/50">
                    {agent.address}
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 border rounded-lg bg-gray-900/40 border-gray-800/50">
                  <span className="text-sm text-gray-400">Balance</span>
                  <div className="flex items-center gap-1 font-mono">
                    <span className="text-green-500">$</span>
                    <span className="text-gray-200">{agentBalances[agent.id] || "0.00"}</span>
                    <span className="ml-1 text-xs text-gray-500">USDC</span>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button 
                  onClick={() => toast.success(`Mock: Funding agent with 10 USDC from Master Wallet...`)}
                  className="flex items-center justify-center flex-1 py-2 text-sm font-medium text-green-400 transition-colors bg-gray-900 border rounded-lg hover:bg-gray-800 border-green-900/30 hover:border-green-500/50">
                  <HandCoins className="w-4 h-4 mr-1.5" />
                  Fund
                </button>
                
                <button 
                  onClick={() => toast.success(`Mock: Sweeping all USDC from ${agent.name} back to Master.`)}
                  className="flex items-center justify-center flex-1 py-2 text-sm font-medium text-blue-400 transition-colors bg-gray-900 border rounded-lg hover:bg-gray-800 border-blue-900/30 hover:border-blue-500/50">
                  <ArrowUpRight className="w-4 h-4 mr-1.5" />
                  Sweep
                </button>

                <Link href={`/dashboard/agents/${agent.id}`} className="flex items-center justify-center flex-1 w-full h-full p-2 text-sm font-medium text-white transition-colors bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700" title="Agent Analytics & Details">
                  <Activity className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Global Event Stream (Phase 12) */}
      <div className="mt-12 mb-6">
        <h2 className="flex items-center gap-2 pl-3 text-xl font-bold text-white border-l-4 border-blue-500">
          <Activity className="w-5 h-5 text-blue-500" /> System Event Stream (Real-time PnL)
        </h2>
      </div>
      <div className="overflow-hidden bg-black border border-gray-800 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="text-xs text-gray-400 uppercase bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-6 py-4 font-medium tracking-wider">Action / Status</th>
                <th className="px-6 py-4 font-medium tracking-wider">My Agent</th>
                <th className="px-6 py-4 font-medium tracking-wider">Tx Opponent</th>
                <th className="px-6 py-4 font-medium tracking-wider text-right">Volume (USDC)</th>
                <th className="px-6 py-4 font-medium tracking-wider">Tx Node</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/80">
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500 bg-gray-900/10">No recent transactions tracked.</td>
                </tr>
              ) : (
                (() => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const fleetEvents: any[] = [];
                  tasks.forEach(t => {
                    const isBuyer = agents.some(a => a.address?.toLowerCase() === t.buyer.toLowerCase());
                    const isSeller = t.seller && agents.some(a => a.address?.toLowerCase() === t.seller.toLowerCase());
                    if (isBuyer) {
                      fleetEvents.push({ ...t, viewRole: 'buyer', me: t.buyer, op: t.seller || 'Pending Match' });
                    }
                    if (isSeller) {
                      fleetEvents.push({ ...t, viewRole: 'seller', me: t.seller, op: t.buyer });
                    }
                  });
                  return fleetEvents.slice(0, 15).map((ev, idx) => {
                    const myAgent = agents.find(a => a.address?.toLowerCase() === ev.me.toLowerCase());
                    return (
                      <tr key={`${ev.taskId}-${ev.viewRole}-${idx}`} className="transition-colors hover:bg-gray-900/50">
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2 py-1 text-xs rounded border ${
                            ev.status === 'LOCKED' ? 'border-yellow-500/30 text-yellow-500 bg-yellow-500/10' :
                            (ev.status === 'COMPLETED' || ev.status === 'RELEASED') ? 'border-green-500/30 text-green-500 bg-green-500/10' :
                            (ev.status === 'DELIVERED') ? 'border-blue-500/30 text-blue-400 bg-blue-500/10' :
                            'border-gray-500/30 text-gray-400 bg-gray-500/10'
                          }`}>
                            {ev.viewRole === 'seller' && ev.status === 'DELIVERED' ? 'DELIVERED (AWAITING PAY)' : ev.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-300">{myAgent?.name || "Unknown Agent"}</span>
                            <span className="w-32 font-mono text-xs text-gray-600 truncate">{ev.me}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                           <span className="inline-block w-32 font-mono text-xs text-gray-600 truncate">{ev.op}</span>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-right">
                          <span className={ev.viewRole === 'buyer' ? "text-red-400" : "text-green-400"}>
                            {ev.viewRole === 'buyer' ? "-" : "+"}{ev.amount}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                           <span className="font-mono text-xs text-blue-500">
                             {ev.txHash ? `${ev.txHash.substring(0, 8)}...${ev.txHash.substring(ev.txHash.length - 6)}` : 'N/A'}
                           </span>
                        </td>
                      </tr>
                    );
                  });
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
