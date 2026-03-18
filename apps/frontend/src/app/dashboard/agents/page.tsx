"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { 
  Bot, 
  Plus, 
  Key, 
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

export default function AgentsPage() {
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  
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

  const fetchCredentials = useCallback(async () => {
    if (!userAddress || !isSessionAuthenticated) return;
    
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
      fetchCredentials();
    }
  }, [isConnected, userAddress, isSessionAuthenticated, fetchCredentials]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchCredentials();
  };

  const handleCreateCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAddress) return;

    try {
      setIsLoading(true);
      const result = await issueAgentCredential(userAddress, {
        name: agentName || "Unnamed Agent",
        creditLimit: parseFloat(dailyBudget),
        maxCalls: parseInt(maxCalls),
        resetInterval: "daily"
      });
      setNewCredential(result);
      setIsCreateModalOpen(false);
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

  return (
    <div className="p-8 space-y-10 max-w-[1400px] mx-auto">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="w-6 h-6 text-blue-400" />
            Agent Profiles
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage runtime identities, credentials, and budget policies for your agents.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-400 transition-colors shadow-lg shadow-blue-500/20"
          >
            <Plus className="w-4 h-4" />
            Create New Agent
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* AGENT CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading && credentials.length === 0 ? (
          [1, 2, 3].map(i => (
            <div key={i} className="h-64 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
          ))
        ) : credentials.length === 0 ? (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4 bg-white/[0.01] border border-dashed border-white/10 rounded-3xl">
            <div className="p-4 rounded-full bg-white/[0.03]">
              <Bot className="w-10 h-10 text-gray-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">No Agents Found</h3>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">Create your first agent profile to start using Synapse Network services.</p>
            </div>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="px-6 py-2 bg-white text-black rounded-full text-xs font-bold hover:bg-gray-200 transition-colors"
            >
              Get Started
            </button>
          </div>
        ) : (
          credentials.map((agent) => (
            <div key={agent.id} className="group p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-blue-500/30 transition-all relative overflow-hidden">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${agent.status === 'active' ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-gray-500/10 border border-gray-500/20'}`}>
                    <Bot className={`w-5 h-5 ${agent.status === 'active' ? 'text-blue-400' : 'text-gray-500'}`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{agent.name || "Unnamed Agent"}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'bg-gray-600'}`} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{agent.status}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => handleRevoke(agent.id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-gray-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Daily Budget</span>
                    <span className="text-sm font-mono text-emerald-400">${agent.creditLimit?.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Usage</span>
                    <span className="text-sm font-mono text-white">{((agent.callsUsed / agent.maxCalls) * 100).toFixed(1)}%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    <span>Call Quota</span>
                    <span className="text-gray-400">{agent.callsUsed} / {agent.maxCalls}</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-500" 
                      style={{ width: `${Math.min(100, (agent.callsUsed / agent.maxCalls) * 100)}%` }} 
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-gray-600" />
                    <span className="text-[10px] font-mono text-gray-500">Prefix: {agent.tokenPrefix}...</span>
                  </div>
                  <button 
                    onClick={() => copyToClipboard(agent.id, agent.id)}
                    className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest flex items-center gap-1"
                  >
                    {copiedId === agent.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    ID
                  </button>
                </div>
              </div>
              
              {/* Decorative background */}
              <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
            </div>
          ))
        )}
      </div>

      {/* CREATE MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                Create Agent Profile
              </h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-500 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCredential} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Agent Name</label>
                <input 
                  type="text" 
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. ResearchBot-01"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/50"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Daily Budget (USDC)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/50"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Max Calls</label>
                  <input 
                    type="number" 
                    value={maxCalls}
                    onChange={(e) => setMaxCalls(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/50"
                    required
                  />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-400 mt-0.5" />
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Creating an agent will issue a unique credential. You can revoke access or update budget policies at any time.
                </p>
              </div>
              <button 
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-blue-500 text-white rounded-xl font-bold text-sm hover:bg-blue-400 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isLoading ? "Creating..." : "Issue Credential"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SUCCESS MODAL (New Credential) */}
      {newCredential && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="w-full max-w-lg bg-[#0a0a0c] border border-emerald-500/20 rounded-3xl shadow-[0_0_50px_rgba(16,185,129,0.1)] overflow-hidden">
            <div className="p-8 text-center space-y-6">
              <div className="mx-auto p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 w-fit">
                <ShieldCheck className="w-10 h-10 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Agent Credential Issued</h2>
                <p className="text-sm text-gray-500 mt-2">Copy this token now. For security, it will not be shown again.</p>
              </div>
              
              <div className="relative group">
                <div className="p-4 rounded-2xl bg-black border border-white/10 font-mono text-sm text-emerald-400 break-all text-left pr-12">
                  {newCredential.token}
                </div>
                <button 
                  onClick={() => copyToClipboard(newCredential.token, 'new-token')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hov                  classNamolors"
                >
                  {copiedId === 'new-token' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Agent Name</span>
                  <span className="text-sm font-bold text-white">{newCredential.name}</span>
                </div>
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Daily Budget</span>
                  <span className="text-sm font-bold text-emerald-400">${newCredential.creditLimit?.toFixed(2)}</span>
                </div>
              </div>

              <button 
                onClick={() => setNewCredential(null)}
                className="w-full py-4 bg-white text-black rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
              >
                I&apos;ve Saved the Token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function XCircle({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
