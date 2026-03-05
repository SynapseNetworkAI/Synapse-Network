"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Copy, Check, ShieldAlert, Cpu, Wallet, Trash2 } from "lucide-react";
import { agentStore, AgentIdentity } from "@/utils/agentStore";
import Link from "next/link";

export default function AgentDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  
  const [agent, setAgent] = useState<AgentIdentity | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const data = agentStore.getAgent(id);
    if (!data) {
      router.push("/dashboard");
    } else {
      setAgent(data);
    }
  }, [id, router]);

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

  return (
    <div className="max-w-6xl mx-auto p-8">
      <Link href="/dashboard" className="text-gray-400 hover:text-white flex items-center mb-8 inline-flex transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" /> back to fleet
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Identity & Keys */}
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-green-900/50 bg-black p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Cpu className="text-green-500 w-8 h-8 mr-3" />
                <div>
                  <h1 className="text-3xl font-black text-white leading-none">{agent.name}</h1>
                  <span className="text-sm text-green-400 font-mono tracking-wider">{agent.role}</span>
                </div>
              </div>
              <button onClick={deleteAgent} className="text-red-500 hover:bg-red-500/10 p-2 rounded-lg transition-colors">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            {/* Address */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wide">Public Address</label>
              <div className="flex items-center group">
                <code className="flex-1 bg-gray-900 border border-gray-800 text-green-400 p-3 rounded-l-lg text-sm truncate">
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
            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wide">
                Private Key (Python SDK Auth)
              </label>
              <div className="bg-red-950/20 border border-red-900/40 p-4 rounded-xl mb-3 flex items-start">
                <ShieldAlert className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
                <p className="text-xs text-red-300">
                  CRITICAL: Copy this to your python <code>.env</code> file: <code>AGENT_PRIVATE_KEY={agent.privateKey.substring(0,6)}...</code> <br/>
                  Never share this. If lost, the funds in this agent&apos;s wallet are unrecoverable.
                </p>
              </div>
              
              <div className="flex items-center">
                <div className="flex-1 bg-gray-900 border border-gray-800 rounded-l-lg p-3 relative overflow-hidden">
                  <div className={`font-mono text-sm break-all ${showKey ? 'text-red-400' : 'text-gray-600 blur-sm select-none'}`}>
                    {agent.privateKey}
                  </div>
                  {!showKey && (
                     <div 
                        className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={() => setShowKey(true)}
                     >
                       <span className="bg-black/80 px-3 py-1 rounded text-xs font-bold border border-gray-700">Click to reveal</span>
                     </div>
                  )}
                </div>
                <button 
                  onClick={() => copyToClipboard(agent.privateKey, 'key')}
                  className="bg-gray-800 hover:bg-gray-700 border-y border-r border-gray-800 p-3 rounded-r-lg text-white transition-colors h-full"
                >
                  {copiedKey ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
          
          {/* Sandbox Area Placeholder */}
          <div className="border border-blue-900/30 bg-black/60 p-6 rounded-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[80px] pointer-events-none"></div>
             <h3 className="text-xl font-bold text-white mb-2 flex items-center">
                <Wallet className="w-5 h-5 mr-2 text-blue-400" />
                Transaction Sandbox
             </h3>
             <p className="text-sm text-gray-500 mb-4">
                Simulate Escrow actions on behalf of this Agent without running the Python SDK. (Coming Soon)
             </p>
             <button disabled className="bg-blue-900/40 text-blue-400 border border-blue-800/50 py-2 px-4 rounded font-mono text-sm cursor-not-allowed opacity-50">
                &gt; Initialize Mock Transaction()
             </button>
          </div>
        </div>

        {/* Right Column: Funding */}
        <div className="space-y-6">
          <div className="border border-green-500/20 bg-green-500/5 p-6 rounded-2xl text-center flex flex-col items-center">
            <h3 className="font-bold text-white mb-2 uppercase tracking-widest text-sm">Fund Agent</h3>
            <p className="text-xs text-gray-400 mb-6">Scan to deposit USDC or Native ETH (Gas) to this Agentthis Agent&apos;s executionapos;s execution wallet.</p>
            
            <div className="bg-white p-4 rounded-xl inline-block mb-6 shadow-[0_0_30px_rgba(34,197,94,0.15)]">
               <QRCodeSVG value={agent.address} size={180} level="H" />
            </div>
            
            <div className="w-full bg-black/40 border border-gray-800 rounded py-2 px-3 text-xs font-mono text-gray-400 break-all">
                {agent.address}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}