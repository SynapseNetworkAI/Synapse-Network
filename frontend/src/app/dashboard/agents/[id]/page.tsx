"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { 
  ArrowLeft, Copy, Check, ShieldAlert, Cpu, Wallet, Trash2, 
  ArrowUpRight, ArrowDownRight, Activity
} from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import Link from "next/link";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";

export default function AgentDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { address: userAddress } = useAccount();
  
  const [agent, setAgent] = useState<AgentIdentity | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  // Real Balance state
  const [agentBalance, setAgentBalance] = useState("0.00");
  const [currentPage, setCurrentPage] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [txHistory, setTxHistory] = useState<any[]>([]);
  const [agentStats, setAgentStats] = useState({ revenue: 0, expense: 0 });

  useEffect(() => {
    const data = agentStore.getAgent(id);
    if (!data) {
      router.push("/dashboard");
    } else {
      setAgent(data);
      fetchRealBalance(data.address);
      if (userAddress) {
        fetchTransactions(data.address, userAddress);
      }
    }
  }, [id, router, userAddress]);

  const fetchTransactions = async (address: string, owner: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/client/tasks?agent=${address}`, {
        headers: {
          "Authorization": "Bearer active",
          "X-User-Address": owner
        }
      });
      if (res.ok) {
        const data = await res.json();
        setTxHistory(data);
        
        // Compute stats for 24h mock replacement
        let rev = 0;
        let exp = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.forEach((t: any) => {
          const amt = parseFloat(t.amount || "0");
          if (t.status === "RELEASED" || t.status === "COMPLETED" || t.status === "LOCKED") {
            if (t.seller && t.seller.toLowerCase() === address.toLowerCase()) rev += amt;
            if (t.buyer && t.buyer.toLowerCase() === address.toLowerCase()) exp += amt;
          }
        });
        setAgentStats({ revenue: rev, expense: exp });
      } else {
        console.error("Backend validation failed", await res.text());
        setTxHistory([]);
      }
    } catch (e) {
      console.error("Failed to fetch transactions", e);
    }
  };

  const fetchRealBalance = async (address: string) => {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const usdcContract = new ethers.Contract(contractConfig.MockUSDC, MockUSDCABI, provider);
      
      const bal = await usdcContract.balanceOf(address);
      setAgentBalance(parseFloat(ethers.formatUnits(bal, 18)).toFixed(2));
    } catch(err) {
      console.error("Failed to fetch real on-chain agent balance", err);
    }
  };

  const copyToClipboard = (text: string, type: 'key' | 'addr') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 2000);
    }
  };

  const deleteAgent = () => { toast((t) => ( <div className="bg-gray-900 border-2 border-red-500/50 p-6 rounded-lg w-80 max-w-full font-mono text-left"> <h3 className="text-xl text-red-400 mb-2 mt-0 font-bold uppercase tracking-wider">WARNING</h3> <p className="text-sm text-gray-300 mb-6 leading-relaxed"> Are you sure you want to delete this agent? The private key will be lost forever if not backed up. </p> <div className="flex gap-3"> <button onClick={() => {toast.dismiss(t.id); agentStore.removeAgent(id); router.push("/dashboard");}} className="flex-1 bg-red-900/40 hover:bg-red-900/80 text-red-300 border border-red-500/30 py-2 rounded transition-colors text-sm uppercase tracking-wide cursor-pointer">DELETE</button> <button onClick={() => toast.dismiss(t.id)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-600 py-2 rounded transition-colors text-sm uppercase tracking-wide cursor-pointer">CANCEL</button> </div> </div> ), { duration: Infinity, style: { background: "transparent", boxShadow: "none", padding: 0 } }); };

  if (!agent) return <div className="p-8 text-center text-gray-500">Loading Agent Matrix...</div>;

  return (
    <div className="max-w-6xl p-8 mx-auto">
      <Link href="/dashboard" className="flex inline-flex items-center mb-8 text-gray-400 transition-colors hover:text-white">
        <ArrowLeft className="w-4 h-4 mr-2" /> back to fleet
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        
        {/* Left Column: Identity, Financials & Keys */}
        <div className="space-y-6 lg:col-span-2">
          
          {/* Header Card */}
          <div className="flex flex-col justify-between gap-4 p-6 bg-black border border-green-900/50 rounded-2xl md:flex-row md:items-center">
            <div className="flex items-center">
              <Cpu className="w-10 h-10 mr-4 text-green-500" />
              <div>
                <h1 className="text-3xl font-black leading-none text-white">{agent.name}</h1>
                <span className="font-mono text-sm tracking-wider text-green-400">{agent.role}</span>
              </div>
            </div>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 px-4 py-2 text-right bg-gray-900 border border-gray-800 rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">On-Chain USDC</div>
                <div className="font-mono text-xl font-bold text-green-400">${agentBalance}</div>
              </div>
              <button onClick={deleteAgent} className="flex items-center justify-center p-3 text-red-500 transition-colors border rounded-lg hover:bg-red-500/10 border-red-900/30" title="Decommission Agent">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Financials Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 bg-black border border-gray-800 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-400">Total Revenue</span>
                <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-400">{`+$${agentStats.revenue.toFixed(2)}`}</div>
            </div>
            <div className="p-5 bg-black border border-gray-800 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-400">Total Expense & Gas</span>
                <ArrowDownRight className="w-4 h-4 text-red-400" />
              </div>
              <div className="text-2xl font-bold text-red-400">{`-$${agentStats.expense.toFixed(2)}`}</div>
            </div>
          </div>

          {/* Keys & Address */}
          <div className="relative p-6 overflow-hidden border border-gray-800 bg-black/60 rounded-2xl">
            <h3 className="flex items-center mb-4 text-lg font-bold text-white">
              <Wallet className="w-5 h-5 mr-2 text-gray-400" />
              Cryptographic Identity
            </h3>
            
            {/* Address */}
            <div className="mb-5">
              <label className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">Public Address</label>
              <div className="flex items-center group">
                <code className="flex-1 p-3 text-sm text-green-400 truncate border border-gray-800 rounded-l-lg bg-gray-900/80">
                  {agent.address}
                </code>
                <button 
                  onClick={() => copyToClipboard(agent.address, 'addr')}
                  className="p-3 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
                >
                  {copiedAddr ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Private Key */}
            <div>
              <label className="block mb-2 text-xs font-bold tracking-wide text-gray-500 uppercase">
                Private Key (Python SDK Auth)
              </label>
              <div className="flex items-start p-3 mb-3 border bg-red-950/20 border-red-900/40 rounded-xl">
                <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                <p className="text-xs text-red-300">
                  CRITICAL: Do not share. Copy this to your python <code>.env</code> file.
                </p>
              </div>
              
              <div className="flex items-center h-12">
                <div className="relative flex items-center flex-1 h-full px-3 py-3 overflow-hidden border border-gray-800 rounded-l-lg bg-gray-900/80">
                  <div className={`font-mono text-sm break-all ${showKey ? 'text-red-400' : 'text-gray-600 blur-sm select-none'}`}>
                    {agent.privateKey}
                  </div>
                  {!showKey && (
                     <div 
                        className="absolute inset-0 z-10 flex items-center justify-center transition-colors cursor-pointer hover:bg-white/5"
                        onClick={() => setShowKey(true)}
                     >
                       <span className="px-3 py-1 text-xs font-bold text-gray-300 border border-gray-700 rounded bg-black/90">Click to reveal</span>
                     </div>
                  )}
                </div>
                <button 
                  onClick={() => copyToClipboard(agent.privateKey, 'key')}
                  className="flex items-center justify-center h-full px-4 text-white transition-colors bg-gray-800 border-r border-gray-800 rounded-r-lg hover:bg-gray-700 border-y"
                >
                  {copiedKey ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          
          {/* Task Ledger (Micro Ledger) - Terminal Style */}
          <div className="flex flex-col border border-[#00FFA3]/30 bg-[#060606] shadow-[0_0_20px_rgba(0,255,163,0.05)] rounded-xl overflow-hidden mt-6">
            <div className="flex items-center justify-between px-4 py-3 bg-[#0a2010] border-b border-[#00FFA3]/30">
              <h3 className="flex items-center text-sm font-bold tracking-wider text-[#00FFA3] uppercase font-mono">
                <Activity className="w-4 h-4 mr-2" />
                Agent Task Ledger
              </h3>
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
              </div>
            </div>
            
            <div className="p-4 font-mono text-xs md:text-sm overflow-x-auto whitespace-nowrap min-h-[400px]">
              <div className="grid grid-cols-[100px_minmax(140px,1fr)_120px_180px_100px] gap-4 pb-2 mb-2 text-[#00FFA3]/60 border-b border-[#00FFA3]/30 font-semibold tracking-wider">
                <div>TYPE</div>
                <div>COUNTERPARTY</div>
                <div>AMOUNT</div>
                <div>TASK DETAILS</div>
                <div>STATUS</div>
              </div>
              
              <div className="space-y-1">
                {txHistory.length > 0 ? txHistory.slice((currentPage - 1) * 8, currentPage * 8).map(tx => {
                  const isReceive = tx.seller.toLowerCase() === agent?.address.toLowerCase();
                  const typeLabel = isReceive ? "INCOME " : "EXPENSE";
                  const typeColor = isReceive ? "text-[#00FFA3]" : "text-red-400";
                  const counterparty = isReceive ? tx.buyer : tx.seller;
                  const shortCp = `${counterparty.substring(0,6)}...${counterparty.substring(38)}`;
                  const prefix = isReceive ? "+" : "-";
                  const mockTaskType = isReceive ? "Data Service Provided" : "Compute API Call";
                  
                  return (
                    <div key={tx.taskId} className="grid grid-cols-[100px_minmax(140px,1fr)_120px_180px_100px] gap-4 py-2 hover:bg-[#00FFA3]/10 transition-colors rounded items-center">
                      <div className={`${typeColor} font-bold`}>[{typeLabel}]</div>
                      <div className="text-gray-400"><span className="text-gray-600 mr-1">{isReceive ? "FR:" : "TO:"}</span>{shortCp}</div>
                      <div className={`${typeColor}`}>{prefix}{tx.amount} USDC</div>
                      <div className="text-blue-400/80 truncate text-xs" title={mockTaskType}>{mockTaskType}</div>
                      <div className="text-gray-500 flex items-center text-xs">
                        {tx.status === "COMPLETED" ? <span className="text-[#00FFA3] mr-1">■</span> : <span className="text-yellow-500 mr-1">■</span>}
                        {tx.status}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-20 text-center text-[#00FFA3]/30">
                    <span className="animate-pulse">&gt;_ DATABASE_EMPTY</span>
                  </div>
                )}
              </div>
            </div>

            {/* Pagination */}
            {txHistory.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#00FFA3]/30 bg-black">
                <span className="font-mono text-xs text-[#00FFA3]/50">
                  {txHistory.length} query match(es)
                </span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 font-mono text-xs text-[#00FFA3] border border-[#00FFA3]/50 rounded hover:bg-[#00FFA3]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    &lt; PREV
                  </button>
                  <span className="px-3 py-1 font-mono text-xs text-[#00FFA3]">
                    PG {currentPage} / {Math.max(1, Math.ceil(txHistory.length / 8))}
                  </span>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(txHistory.length / 8), p + 1))}
                    disabled={currentPage === Math.ceil(txHistory.length / 8)}
                    className="px-3 py-1 font-mono text-xs text-[#00FFA3] border border-[#00FFA3]/50 rounded hover:bg-[#00FFA3]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    NEXT &gt;
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Funding */}
        <div className="space-y-6">
          <div className="flex flex-col items-center p-6 text-center border border-green-500/20 bg-green-500/5 rounded-2xl">
            <h3 className="mb-2 text-sm font-bold tracking-widest text-white uppercase">Fund Agent</h3>
            <p className="mb-6 text-xs text-gray-400">Scan to deposit USDC or Native ETH (Gas) to this Agent&apos;s execution wallet.</p>
            
            <div className="bg-white p-4 rounded-xl inline-block mb-6 shadow-[0_0_30px_rgba(34,197,94,0.15)]">
               <QRCodeSVG value={agent.address} size={160} level="H" />
            </div>
            
            <div className="w-full px-3 py-2 font-mono text-xs text-gray-400 break-all border border-gray-800 rounded bg-black/40">
                {agent.address}
            </div>

            <div className="w-full mt-6 space-y-3">
               <button className="w-full py-3 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400">
                 Deposit from Master Wallet
               </button>
               <button className="w-full py-3 text-sm font-bold text-green-500 transition-colors bg-transparent border rounded-lg border-green-500/30 hover:bg-green-500/10">
                 Sweep Funds to Master
               </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
