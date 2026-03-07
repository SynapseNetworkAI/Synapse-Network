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
    <div className="relative max-w-2xl p-8 mx-auto mt-10 overflow-hidden border shadow-2xl border-green-900/50 rounded-2xl bg-black/40">
      <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/10 blur-[100px] pointer-events-none"></div>

      <div className="flex items-center mb-8">
        <div className="p-3 mr-4 border bg-green-500/20 rounded-xl border-green-500/30">
          <Shield className="w-8 h-8 text-green-400" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-white">Deploy New Agent</h1>
          <p className="mt-1 text-gray-400">Generate a cryptographic identity for your autonomous entity</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="relative z-10 space-y-6">
        <div>
          <label className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
            Agent Name Designator
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Bot className="w-5 h-5 text-gray-500" />
            </div>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full py-3 pl-10 pr-4 font-mono text-white transition-all bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
              placeholder="e.g. Trading_Bot_01, Data_Spider_X"
            />
          </div>
        </div>

        <div>
          <label className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
            Primary Role / Vector
          </label>
          <select 
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-3 font-mono text-white bg-gray-900 border border-gray-700 rounded-lg appearance-none focus:outline-none focus:border-green-500"
          >
            <option>Buyer / Purchaser </option>
            <option>Seller / Work Node</option>
            <option>Arbiter / Judge</option>
            <option>Oracle / Relayer</option>
          </select>
        </div>

        <div className="flex items-start p-4 border rounded-lg bg-green-900/10 border-green-900/30">
          <Key className="w-6 h-6 text-green-500 mr-3 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400">
            <strong>Security Notice:</strong> The private key will be generated locally in your browser via <code className="text-green-400 bg-black px-1 py-0.5 rounded">ethers.Wallet.createRandom()</code>. A2A-Pay never transmits or stores this key on any server.
          </p>
        </div>

        <button 
          type="submit" 
          disabled={isGenerating || !name}
          className="flex items-center justify-center w-full py-4 font-black text-black transition-all bg-green-500 hover:bg-green-400 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Synthesizing Cryptographic Identity...
            </>
          ) : (
            <>
              Generate EOA Wallet Identity
              <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}