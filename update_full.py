import sys

page_path = "/Users/cliff/workspace/A2A-pay/frontend/src/app/dashboard/agents/[id]/page.tsx"

content = """\"use client\";

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
    <div className="max-w-6xl mx-auto p-8">
      <Link href="/dashboard" className="text-gray-400 hover:text-white flex items-center mb-8 inline-flex transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" /> back to fleet
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Identity, Financials & Keys */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Header Card */}
          <div className="border border-green-900/50 bg-black p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center">
              <Cpu className="text-green-500 w-10 h-10 mr-4" />
              <div>
                <h1 className="text-3xl font-black text-white leading-none">{agent.name}</h1>
                <span className="text-sm text-green-400 font-mono tracking-wider">{agent.role}</span>
              </div>
            </div>
            <div className="flex gap-2 items-stretch">
              <div className="px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-right flex-1">
                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">On-Chain USDC</div>
                <div className="text-xl font-mono text-green-400 font-bold">${agentBalance}</div>
              </div>
              <button onClick={deleteAgent} className="text-red-500 hover:bg-red-500/10 p-3 border border-red-900/30 rounded-lg transition-colors flex items-center justify-center" title="Decommission Agent">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Financials Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black border border-gray-800 p-5 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400 font-medium">24h Revenue</span>
                <ArrowUpRight className="text-emerald-400 w-4 h-4" />
              </div>
              <div className="text-2xl font-bold text-emerald-400">{mockAgentRevenue}</div>
            </div>
            <div className="bg-black border border-gray-800 p-5 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400 font-medium">24h Expense & Gas</span>
                <ArrowDownRight className="text-red-400 w-4 h-4" />
              </div>
              <div className="text-2xl font-bold text-red-400">{mockAgentExpense}</div>
            </div>
          </div>

          {/* Keys & Address */}
          <div className="border border-gray-800 bg-black/60 p-6 rounded-2xl relative overflow-hidden">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center">
              <Wallet className="w-5 h-5 mr-2 text-gray-400" />
              Cryptographic Identity
            </h3>
            
            {/* Address */}
            <div className="mb-5">
              <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">Public Address</label>
              <div className="flex items-center group">
                <code className="flex-1 bg-gray-900/80 border border-gray-800 text-green-400 p-3 rounded-l-lg text-sm truncate">
                  {agent.address}
                </code>
                <button 
                  onClick={() => copyToClipboard(agent.address, 'addr')}
                  className="bg-gray-800 hover:bg-gray-700 border-y border-r border-gray-800 p-3 rounded-r-lg text-white transition-colors"
                >
                  {copiedAddr ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Private Key */}
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">
                Private Key (Python SDK Auth)
              </label>
              <div className="bg-red-950/20 border border-red-900/40 p-3 rounded-xl mb-3 flex items-start">
                <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                <p className="text-xs text-red-300">
                  CRITICAL: Do not share. Copy this to your python <code>.env</code> file.
                </p>
              </div>
              
              <div className="flex items-center h-12">
                <div className="flex-1 bg-gray-900/80 border border-gray-800 rounded-l-lg px-3 py-3 relative overflow-hidden h-full flex items-center">
                  <div className={`font-mono text-sm break-all ${showKey ? 'text-red-400' : 'text-gray-600 blur-sm select-none'}`}>
                    {agent.privateKey}
                  </div>
                  {!showKey && (
                     <div 
                        className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={() => setShowKey(true)}
                     >
                       <span className="bg-black/90 px-3 py-1 rounded text-xs font-bold border border-gray-700 text-gray-300">Click to reveal</span>
                     </div>
                  )}
                </div>
                <button 
                  onClick={() => copyToClipboard(agent.privateKey, 'key')}
                  className="bg-gray-800 hover:bg-gray-700 border-y border-r border-gray-800 px-4 text-white transition-colors h-full rounded-r-lg flex items-center justify-center"
                >
                  {copiedKey ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          
          {/* Transaction History */}
          <div className="border border-gray-800 bg-black/60 p-6 rounded-2xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center">
               <Activity className="w-5 h-5 mr-2 text-blue-400" />
               Recent Transaction History
            </h3>
            <div className="space-y-3">
              {mockTxHistory.map(tx => (
                <div key={tx.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-gray-900/40 border border-gray-800/50 rounded-lg hover:bg-gray-800/60 transition-colors gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${tx.type === 'Receive' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {tx.type === 'Receive' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-200">{tx.type === 'Receive' ? `From: ${tx.from}` : `To: ${tx.to}`}</div>
                      <div className="text-xs text-gray-500">{tx.time} &bull; <span className="font-mono">Tx: {tx.txHash}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                    <span className={`font-mono text-sm ${tx.type === 'Receive' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount}
                    </span>
                    <button className="text-gray-600 hover:text-blue-400 transition-colors">
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              <button className="w-full py-2 mt-2 text-sm text-gray-500 hover:text-white transition-colors">
                 View All on Block Explorer
              </button>
            </div>
          </div>

        </div>

        {/* Right Column: Funding */}
        <div className="space-y-6">
          <div className="border border-green-500/20 bg-green-500/5 p-6 rounded-2xl text-center flex flex-col items-center">
            <h3 className="font-bold text-white mb-2 uppercase tracking-widest text-sm">Fund Agent</h3>
            <p className="text-xs text-gray-400 mb-6">Scan to deposit USDC or Native ETH (Gas) to this Agent's execution wallet.</p>
            
            <div className="bg-white p-4 rounded-xl inline-block mb-6 shadow-[0_0_30px_rgba(34,197,94,0.15)]">
               <QRCodeSVG value={agent.address} size={160} level="H" />
            </div>
            
            <div className="w-full bg-black/40 border border-gray-800 rounded py-2 px-3 text-xs font-mono text-gray-400 break-all">
                {agent.address}
            </div>

            <div className="mt-6 w-full space-y-3">
               <button className="w-full py-3 bg-green-500 hover:bg-green-400 text-black font-bold rounded-lg transition-colors text-sm">
                 Deposit from Master Wallet
               </button>
               <button className="w-full py-3 bg-transparent border border-green-500/30 text-green-500 hover:bg-green-500/10 font-bold rounded-lg transition-colors text-sm">
                 Sweep Funds to Master
               </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
"""

with open(page_path, "w") as f:
    f.write(content)
