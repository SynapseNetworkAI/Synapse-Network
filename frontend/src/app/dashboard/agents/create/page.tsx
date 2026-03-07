"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";
import { Shield, Bot, Key, ArrowRight, Loader2 } from "lucide-react";
import { agentStore } from "@/utils/agentStore";
import { useAccount } from "wagmi";

export default function CreateAgent() {
  const router = useRouter();
  const { address: userAddress } = useAccount();
  const [name, setName] = useState("");
  const [role, setRole] = useState("Buyer/General");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setIsGenerating(true);

    // Simulate generation delay for UX effect
    await new Promise(r => setTimeout(r, 800));

    // Pure frontend wallet generation
    const wallet = ethers.Wallet.createRandom();
    
    // Fallback if missing uuid
    const newId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    
    const newAgent = {
      id: newId,
      name,
      role,
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: Date.now(),
      ownerAddress: userAddress // Tie to the connected Web3 Cold Wallet EOA
    };

    // Register agent info in backend for Indexer and API RLS
    try {
      await fetch("http://127.0.0.1:8000/api/client/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer active",
          "X-User-Address": userAddress || ""
        },
        body: JSON.stringify({
          id: newAgent.id,
          name: newAgent.name,
          role: newAgent.role,
          agent_session_wallet: newAgent.address
        })
      });
    } catch (e) {
      console.error("Failed to register agent on backend", e);
    }

    agentStore.addAgent(newAgent);
    router.push(`/dashboard/agents/${newAgent.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto p-8 mt-10 border border-green-900/50 rounded-2xl bg-black/40 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/10 blur-[100px] pointer-events-none"></div>

      <div className="flex items-center mb-8">
        <div className="bg-green-500/20 p-3 rounded-xl border border-green-500/30 mr-4">
          <Shield className="w-8 h-8 text-green-400" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-white">Deploy New Agent</h1>
          <p className="text-gray-400 mt-1">Generate a cryptographic identity for your autonomous entity</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="space-y-6 relative z-10">
        <div>
          <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wide">
            Agent Name Designator
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Bot className="text-gray-500 w-5 h-5" />
            </div>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-all font-mono"
              placeholder="e.g. Trading_Bot_01, Data_Spider_X"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wide">
            Primary Role / Vector
          </label>
          <select 
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg py-3 px-4 focus:outline-none focus:border-green-500 font-mono appearance-none"
          >
            <option>Buyer / Purchaser </option>
            <option>Seller / Work Node</option>
            <option>Arbiter / Judge</option>
            <option>Oracle / Relayer</option>
          </select>
        </div>

        <div className="bg-green-900/10 border border-green-900/30 p-4 rounded-lg flex items-start">
          <Key className="w-6 h-6 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400">
            <strong>Security Notice:</strong> The private key will be generated locally in your browser via <code className="text-green-400 bg-black px-1 py-0.5 rounded">ethers.Wallet.createRandom()</code>. A2A-Pay never transmits or stores this key on any server.
          </p>
        </div>

        <button 
          type="submit" 
          disabled={isGenerating || !name}
          className="w-full bg-green-500 hover:bg-green-400 text-black font-black py-4 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          {isGenerating ? (
            <>
              <Loader2 className="animate-spin mr-2 w-5 h-5" />
              Synthesizing Cryptographic Identity...
            </>
          ) : (
            <>
              Generate EOA Wallet Identity
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}