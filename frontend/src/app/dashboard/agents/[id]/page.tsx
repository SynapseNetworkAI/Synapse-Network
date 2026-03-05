"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { 
  ArrowLeft, Copy, Check, ShieldAlert, Cpu, Wallet, Trash2, 
  ArrowUpRight, ArrowDownRight, Activity, ExternalLink 
} from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import Link from "next/link";
import { ethers } from "ethers";
import contractConfig from "@/contract-config.json";
import MockUSDCABI from "@/MockUSDCABI.json";

export default function AgentDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  
  const [agent, setAgent] = useState<AgentIdentity | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  // Real Balance state
  const [agentBalance, setAgentBalance] = useState("0.00");

  useEffect(() => {
    const data = agentStore.getAgent(id);
    if (!data) {
      router.push("/dashboard");
    } else {
      setAgent(data);
      fetchRealBalance(data.address);
    }
  }, [id, router]);

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

  const deleteAgent = () => {
    if (confirm("Are you sure you want to delete this agent? The private key will be lost forever if not backed up.")) {
      agentStore.removeAgent(id);
      router.push("/dashboard");
    }
  };

  if (!agent) return <div className="p-8 text-center text-gray-500">Loading Agent Matrix...</div>;

  // Mock financials
  const mockAgentRevenue = "+$12.00";
  const mockAgentExpense = "-$0.05";
  
  const mockTxHistory = [
    { id: 1, type: 'Receive', amount: '+10.00 USDC', from: '0xMaster...', time: '2h ago', txHash: '0x1ab...23c' },
    { id: 2, type: 'Pay', amount: '-2.50 USDC', from: 'Self', to: '0xDataNode...', time: '5h ago', txHash: '0x4f4...89a' },
    { id: 3, type: 'Receive', amount: '+4.50 USDC', from: '0xClient...', time: '1d ago', txHash: '0x9b2...11d' }
  ];

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
                <span className="text-sm font-medium text-gray-400">24h Revenue</span>
                <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-400">{mockAgentRevenue}</div>
            </div>
            <div className="p-5 bg-black border border-gray-800 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-400">24h Expense & Gas</span>
                <ArrowDownRight className="w-4 h-4 text-red-400" />
              </div>
              <div className="text-2xl font-bold text-red-400">{mockAgentExpense}</div>
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
          
          {/* Transaction History */}
          <div className="p-6 border border-gray-800 bg-black/60 rounded-2xl">
            <h3 className="flex items-center mb-4 text-lg font-bold text-white">
               <Activity className="w-5 h-5 mr-2 text-blue-400" />
               Recent Transaction History
            </h3>
            <div className="space-y-3">
              {mockTxHistory.map(tx => (
                <div key={tx.id} className="flex flex-col justify-between gap-3 p-3 transition-colors border rounded-lg sm:flex-row sm:items-center bg-gray-900/40 border-gray-800/50 hover:bg-gray-800/60">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${tx.type === 'Receive' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {tx.type === 'Receive' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-200">{tx.type === 'Receive' ? `From: ${tx.from}` : `To: ${tx.to}`}</div>
                      <div className="text-xs text-gray-500">{tx.time} &bull; <span className="font-mono">Tx: {tx.txHash}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between w-full gap-4 sm:justify-end sm:w-auto">
                    <span className={`font-mono text-sm ${tx.type === 'Receive' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount}
                    </span>
                    <button className="text-gray-600 transition-colors hover:text-blue-400">
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              <button className="w-full py-2 mt-2 text-sm text-gray-500 transition-colors hover:text-white">
                 View All on Block Explorer
              </button>
            </div>
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
