"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { 
  Bot, 
  Plus, 
  ShieldCheck, 
  Trash2, 
  RefreshCw, 
  Copy, 
  Check,
  AlertCircle
} from "lucide-react";
import { 
  listAgentCredentials, 
  issueAgentCredential, 
  revokeAgentCredential, 
  type AgentCredentialRecord,
  type AgentCredentialIssueResponse
} from "@/utils/agentCredentialApi";
import QuickStartGuide from "@/components/dashboard/agents/QuickStartGuide";

export default function AgentsPage() {
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  
  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCredential, setNewCredential] = useState<AgentCredentialIssueResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form states
  const [agentName, setAgentName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10.00");
  const [maxCalls, setMaxCalls] = useState("1000");
  const ownerAddress = userAddress?.toLowerCase() ?? "";

  const fetchCredentials = useCallback(async () => {
    if (!userAddress || !isSessionAuthenticated) {
      setCredentials([]);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    
    try {
      setError(null);
      const data = await listAgentCredentials(userAddress);
      setCredentials(data);
    } catch (err) {
      console.error("Failed to fetch credentials:", err);
      setError("Failed to load agent credentials. Please try again.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [userAddress, isSessionAuthenticated]);

  useEffect(() => {
    if (isConnected && userAddress && isSessionAuthenticated) {
      setIsLoading(true);
      fetchCredentials();
      return;
    }

    setCredentials([]);
    setIsLoading(false);
    setIsRefreshing(false);
  }, [isConnected, userAddress, isSessionAuthenticated, fetchCredentials]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchCredentials();
  };

  const ensureOwnerReady = useCallback(async (): Promise<string | null> => {
    if (!isConnected) {
      openConnectModal?.();
      setError("Please connect your wallet before creating an agent.");
      return null;
    }

    if (!userAddress) {
      setError("Wallet address unavailable. Please reconnect your wallet and try again.");
      return null;
    }

    if (!isSessionAuthenticated) {
      const ok = await authorize();
      if (!ok) {
        setError("Please sign in with your wallet before creating an agent.");
        return null;
      }
    }

    return userAddress.toLowerCase();
  }, [authorize, isConnected, isSessionAuthenticated, openConnectModal, userAddress]);

  const handleOpenCreateModal = useCallback(async () => {
    setError(null);
    const boundOwner = await ensureOwnerReady();
    if (!boundOwner) return;
    setIsCreateModalOpen(true);
  }, [ensureOwnerReady]);

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    const boundOwner = await ensureOwnerReady();
    if (!boundOwner) return;

    try {
      setError(null);
      setIsLoading(true);
      const result = await issueAgentCredential(boundOwner, {
        name: agentName || "Unnamed Agent",
        ownerAddress: boundOwner,
        creditLimit: Number.parseFloat(dailyBudget),
        maxCalls: Number.parseInt(maxCalls, 10),
        resetInterval: "daily"
      });
      setNewCredential(result);
      setIsCreateModalOpen(false);
      setAgentName("");
      setDailyBudget("10.00");
      setMaxCalls("1000");
      toast.success(`Agent created for owner ${boundOwner.slice(0, 6)}...${boundOwner.slice(-4)}`);
      fetchCredentials();
    } catch (err) {
      console.error("Failed to create credential:", err);
      setError("Failed to create agent. Please check your balance and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!userAddress || !confirm("Are you sure you want to revoke this agent's access? This action cannot be undone.")) return;

    try {
      await revokeAgentCredential(userAddress, id);
      fetchCredentials();
    } catch (err) {
      console.error("Failed to revoke credential:", err);
      alert("Failed to revoke credential.");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const shouldShowQuickStart = credentials.length === 0 && !isLoading;

  let credentialsContent: React.ReactNode;

  if (isLoading && credentials.length === 0) {
    credentialsContent = [1, 2, 3].map((i) => (
      <article key={i} aria-hidden="true" className="h-64 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
    ));
  } else if (credentials.length === 0) {
    credentialsContent = (
      <section className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4 bg-white/[0.01] border border-dashed border-white/10 rounded-3xl">
        <span className="p-4 rounded-full bg-white/[0.03]" aria-hidden="true">
          <Bot className="w-10 h-10 text-gray-600" />
        </span>
        <header>
          <h3 className="text-lg font-bold text-white">No Agents Found</h3>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">Create your first agent profile to start using Synapse Network services.</p>
        </header>
        <button 
          onClick={() => void handleOpenCreateModal()}
          className="px-6 py-2 bg-white text-black rounded-full text-xs font-bold hover:bg-gray-200 transition-colors"
        >
          Get Started
        </button>
      </section>
    );
  } else {
    credentialsContent = credentials.map((agent) => (
      <article key={agent.id} className="group p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-blue-500/30 transition-all relative overflow-hidden">
        <header className="flex items-start justify-between mb-6">
          <section className="flex items-center gap-3">
            <span className={`p-3 rounded-xl ${agent.status === 'active' ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-gray-500/10 border border-gray-500/20'}`} aria-hidden="true">
              <Bot className={`w-5 h-5 ${agent.status === 'active' ? 'text-blue-400' : 'text-gray-500'}`} />
            </span>
            <section>
              <h3 className="font-bold text-white">{agent.name}</h3>
              <p className="text-xs text-gray-500 font-mono">{agent.id.slice(0, 8)}...</p>
            </section>
          </section>
          <p className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${agent.status === 'active' ? 'bg-blue-500/10 text-blue-400' : 'bg-gray-500/10 text-gray-500'}`}>
            {agent.status}
          </p>
        </header>

        <section className="space-y-4">
          <dl className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
              <dt className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Daily Budget</dt>
              <dd className="text-sm font-bold text-emerald-400">${(agent.creditLimit ?? 0).toFixed(2)}</dd>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
              <dt className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Calls</dt>
              <dd className="text-sm font-bold text-white">{agent.callsUsed} / {agent.maxCalls}</dd>
            </div>
          </dl>

          <section>
            <header className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Usage</span>
              <span className="text-[10px] text-gray-500">{Math.round((agent.callsUsed / agent.maxCalls) * 100)}%</span>
            </header>
            <span className="block h-2 bg-white/[0.03] rounded-full overflow-hidden" aria-hidden="true">
              <span 
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all"
                style={{ width: `${(agent.callsUsed / agent.maxCalls) * 100}%` }}
              />
            </span>
          </section>

          <footer className="pt-4 border-t border-white/5 flex items-center justify-between">
            <p>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1 block">Created</span>
              <span className="text-xs text-gray-400">{agent.createdAt ? new Date(agent.createdAt).toLocaleDateString() : "Pending"}</span>
            </p>
            <menu className="flex items-center gap-2">
              <button 
                onClick={() => copyToClipboard(agent.tokenPrefix ?? agent.id, agent.id)}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                title="Copy token prefix"
              >
                {copiedId === agent.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
              </button>
              <button 
                onClick={() => handleRevoke(agent.id)}
                className="p-2 rounded-lg bg-red-500/5 hover:bg-red-500/10 transition-colors group/btn"
                title="Revoke agent"
              >
                <Trash2 className="w-4 h-4 text-red-400 group-hover/btn:text-red-300" />
              </button>
            </menu>
          </footer>
        </section>
      </article>
    ));
  }

  const issuedCredential = newCredential;

  return (
    <main className="p-8 space-y-10 max-w-[1400px] mx-auto">
      {/* QUICK START GUIDE */}
      {shouldShowQuickStart && (
        <section className="mb-10" aria-label="Quick start guide">
          <QuickStartGuide 
            onDepositComplete={() => {
              fetchCredentials();
            }}
            onAgentCreated={() => {
              void handleOpenCreateModal();
            }}
          />
        </section>
      )}
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <section>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="w-6 h-6 text-blue-400" />
            Agent Profiles
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage runtime identities, credentials, and budget policies for your agents.</p>
        </section>
        
        <menu className="flex items-center gap-3">
          <button 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <button 
            onClick={() => void handleOpenCreateModal()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-400 transition-colors shadow-lg shadow-blue-500/20"
          >
            <Plus className="w-4 h-4" />
            Create New Agent
          </button>
        </menu>
      </header>

      {error && (
        <aside role="alert" className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5" />
          {error}
        </aside>
      )}

      {/* AGENT CARDS */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-label="Agent profiles list">
        {credentialsContent}
      </section>

      {/* CREATE MODAL */}
      {isCreateModalOpen && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" aria-labelledby="create-agent-title">
          <section className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
            <header className="p-6 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span id="create-agent-title" className="sr-only">Create Agent Profile</span>
                <Plus className="w-5 h-5 text-blue-400" />
                Create Agent Profile
              </h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-500 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </header>
            <form onSubmit={handleCreateCredential} className="p-6 space-y-6">
              <p className="space-y-2 block">
                <label htmlFor="agent-name" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Agent Name</label>
                <input
                  id="agent-name"
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. ResearchBot-01"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/50"
                  required
                />
              </p>
              <p className="space-y-2 block">
                <label htmlFor="bound-owner" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Bound Owner</label>
                <input
                  id="bound-owner"
                  type="text"
                  readOnly
                  value={ownerAddress || "Wallet session required"}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-mono text-blue-300 break-all"
                />
              </p>
              <section className="grid grid-cols-2 gap-4">
                <p className="space-y-2 block">
                  <label htmlFor="daily-budget" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Daily Budget (USDC)</label>
                  <input
                    id="daily-budget"
                    type="number"
                    step="0.01"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/50"
                    required
                  />
                </p>
                <p className="space-y-2 block">
                  <label htmlFor="max-calls" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Max Calls</label>
                  <input
                    id="max-calls"
                    type="number"
                    value={maxCalls}
                    onChange={(e) => setMaxCalls(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/50"
                    required
                  />
                </p>
              </section>
              <aside className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-400 mt-0.5" />
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Creating an agent will issue a unique credential bound to the active owner wallet session. You can revoke access or update budget policies at any time.
                </p>
              </aside>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-400 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isLoading ? "Creating..." : "Issue Credential"}
              </button>
            </form>
          </section>
        </dialog>
      )}

      {/* SUCCESS MODAL (New Credential) */}
      {issuedCredential && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" aria-labelledby="issued-agent-title">
          <section className="w-full max-w-lg bg-[#0a0a0c] border border-emerald-500/20 rounded-3xl shadow-[0_0_50px_rgba(16,185,129,0.1)] overflow-hidden">
            <section className="p-8 text-center space-y-6">
              <span className="mx-auto p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 w-fit block" aria-hidden="true">
                <ShieldCheck className="w-10 h-10 text-emerald-400" />
              </span>
              <header>
                <h2 id="issued-agent-title" className="text-2xl font-bold text-white">Agent Credential Issued</h2>
                <p className="text-sm text-gray-500 mt-2">Copy this token now. For security, it will not be shown again.</p>
              </header>
              
              <section className="relative group">
                <code className="block p-4 rounded-2xl bg-black border border-white/10 font-mono text-sm text-emerald-400 break-all text-left pr-12">
                  {issuedCredential.token}
                </code>
                <button 
                  onClick={() => copyToClipboard(issuedCredential.token, 'new-token')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  {copiedId === 'new-token' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </section>

              <dl className="grid grid-cols-2 gap-4 text-left">
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <dt className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Agent Name</dt>
                  <dd className="text-sm font-bold text-white">{issuedCredential.name}</dd>
                </div>
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <dt className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Daily Budget</dt>
                  <dd className="text-sm font-bold text-emerald-400">${(issuedCredential.creditLimit ?? 0).toFixed(2)}</dd>
                </div>
              </dl>

              <dl className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-left">
                <dt className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Bound Owner</dt>
                <dd className="text-sm font-mono text-blue-300 break-all">{issuedCredential.ownerAddress}</dd>
              </dl>

              <button 
                onClick={() => setNewCredential(null)}
                className="w-full py-4 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
              >
                I&apos;ve Saved the Token
              </button>
            </section>
          </section>
        </dialog>
      )}
    </main>
  );
}

function XCircle({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
