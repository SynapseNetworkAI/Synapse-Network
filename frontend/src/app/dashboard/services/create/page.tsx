"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";
import { Shield, Bot, Key, ArrowRight, Loader2 } from "lucide-react";
import { agentStore } from "@/utils/agentStore";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { createServiceRegistry } from "@/utils/serviceApi";

export default function CreateService() {
  const router = useRouter();
  const { address: userAddress } = useAccount();
  const [name, setName] = useState("");
  const [pricing, setPricing] = useState("0.05");
  const [endpoint, setEndpoint] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [role, setRole] = useState("Provider / Seller");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !pricing || !endpoint) return;

    setIsGenerating(true);

    // Simulate generation delay for UX effect
    await new Promise(r => setTimeout(r, 800));

    // Pure frontend wallet generation
    const wallet = ethers.Wallet.createRandom();
    
    // Fallback if missing uuid
    const newId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    
    const newService = {
      id: newId,
      name,
      role,
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: Date.now(),
      ownerAddress: userAddress, // Tie to the connected Web3 Cold Wallet EOA
      serviceId: "",
      pricing,
      endpoint,
      isActive,
    };

    // Register service in backend registry API
    try {
      const created = await createServiceRegistry(
        {
          agentId: newService.id,
          serviceName: newService.name,
          role: newService.role,
          address: newService.address,
          pricing: newService.pricing,
          isActive: newService.isActive,
          invoke: {
            method: "POST",
            url: newService.endpoint,
            timeoutMs: 30000,
            request: {
              contentType: "application/json",
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string" },
                },
              },
            },
            response: {
              schema: {
                type: "object",
                properties: {
                  quote: { type: "string" },
                },
              },
            },
          },
        },
        userAddress || ""
      );
      newService.serviceId = created.serviceId;
    } catch (e) {
      console.error("Failed to register service on backend", e);
      setIsGenerating(false);
      toast.error("Backend service registration failed. Please check Seller API.");
      return;
    }

    agentStore.addAgent(newService);
    toast.success("Service registered in backend and local store.");
    router.push(`/dashboard/services/${newService.id}`);
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
          <h1 className="text-3xl font-black text-white">Create New Service</h1>
          <p className="mt-1 text-gray-400">Register your provider service wallet and identity</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="relative z-10 space-y-6">
        <div>
          <p className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
            Service Name
          </p>
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
              placeholder="e.g. IMAGE_GEN_V1, DATA_INDEXER_PRO"
            />
          </div>
        </div>

        <div>
          <p className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
            Service ID
          </p>
          <div className="w-full px-4 py-3 font-mono text-gray-400 bg-gray-900 border border-gray-700 rounded-lg">
            Auto generated by system after register
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
              Pricing (USDC)
            </p>
            <input
              type="number"
              min="0"
              step="0.0001"
              required
              value={pricing}
              onChange={(e) => setPricing(e.target.value)}
              className="w-full px-4 py-3 font-mono text-white transition-all bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <p className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
              Status
            </p>
            <button
              type="button"
              onClick={() => setIsActive((prev) => !prev)}
              className={`w-full px-4 py-3 font-mono font-bold border rounded-lg transition-colors ${
                isActive
                  ? "text-green-400 border-green-500/40 bg-green-500/10"
                  : "text-gray-400 border-gray-700 bg-gray-900"
              }`}
            >
              {isActive ? "ACTIVE" : "INACTIVE"}
            </button>
          </div>
        </div>

        <div>
          <p className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
            Endpoint API
          </p>
          <input
            type="url"
            required
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="w-full px-4 py-3 font-mono text-white transition-all bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            placeholder="https://api.my-agent.com/generate"
          />
        </div>

        <div>
          <p className="block mb-2 text-sm font-bold tracking-wide text-gray-400 uppercase">
            Service Role
          </p>
          <select 
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-3 font-mono text-white bg-gray-900 border border-gray-700 rounded-lg appearance-none focus:outline-none focus:border-green-500"
          >
            <option>Provider / Seller</option>
            <option>Data Service</option>
            <option>AI Inference</option>
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
          disabled={isGenerating || !name || !pricing || !endpoint}
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