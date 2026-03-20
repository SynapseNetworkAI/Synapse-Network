"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AlertCircle, Bot, Check, Copy, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import ActivationRunway from "@/components/dashboard/agents/ActivationRunway";
import ActivationStatusStrip from "@/components/dashboard/agents/ActivationStatusStrip";
import FirstInvocationPanel, { type FirstInvocationResult } from "@/components/dashboard/agents/FirstInvocationPanel";
import { useOwnerData } from "@/hooks/useOwnerData";
import {
  issueAgentCredential,
  listAgentCredentials,
  revokeAgentCredential,
  type AgentCredentialIssueResponse,
  type AgentCredentialRecord,
} from "@/utils/agentCredentialApi";
import { setCredentialForService } from "@/utils/agentCredentialStore";
import { invokePaidService } from "@/utils/invokePaidService";
import { payForServiceWithApproval } from "@/utils/payForService";
import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";

function scrollToSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resolvePrice(pricing: ServiceRegistryRecord["pricing"]): string {
  if (typeof pricing === "string") {
    return pricing;
  }

  return String(pricing?.amount ?? 0);
}

function extractRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const possibleKeys = ["request_id", "requestId", "trace_id", "traceId"] as const;
  for (const key of possibleKeys) {
    const value = (response as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

export default function AgentsPage() {
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  const { stats, logs, handleRefresh: handleOwnerRefresh } = useOwnerData();

  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isServicesLoading, setIsServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [sandboxCredential, setSandboxCredential] = useState("");
  const [isSandboxInvoking, setIsSandboxInvoking] = useState(false);
  const [sandboxInvokeError, setSandboxInvokeError] = useState<string | null>(null);
  const [sandboxInvokeResult, setSandboxInvokeResult] = useState<FirstInvocationResult | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCredential, setNewCredential] = useState<AgentCredentialIssueResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [agentName, setAgentName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10.00");
  const [maxCalls, setMaxCalls] = useState("1000");
  const ownerAddress = userAddress?.toLowerCase() ?? "";

  const fetchCredentials = useCallback(async () => {
    if (!userAddress || !isSessionAuthenticated) {
      setCredentials([]);
      setIsLoading(false);
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
    }
  }, [isSessionAuthenticated, userAddress]);

  const fetchServices = useCallback(async () => {
    try {
      setServiceError(null);
      setIsServicesLoading(true);
      const rows = await discoverServices("agent");
      const activeRows = rows.filter((service) => service.isActive && Boolean(service.endpoint));
      setServices(activeRows);
      setSelectedServiceId((current) => {
        if (current && activeRows.some((service) => service.serviceId === current)) {
          return current;
        }
        return activeRows[0]?.serviceId ?? "";
      });
    } catch (err) {
      console.error("Failed to discover services:", err);
      setServiceError("Failed to load discovery examples. The sandbox stays available after the gateway comes back.");
    } finally {
      setIsServicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isConnected && userAddress && isSessionAuthenticated) {
      setIsLoading(true);
      void fetchCredentials();
      return;
    }

    setCredentials([]);
    setIsLoading(false);
  }, [fetchCredentials, isConnected, isSessionAuthenticated, userAddress]);

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.allSettled([fetchCredentials(), handleOwnerRefresh(), fetchServices()]);
    setIsRefreshing(false);
  }, [fetchCredentials, fetchServices, handleOwnerRefresh]);

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
    if (!boundOwner) {
      return;
    }
    setIsCreateModalOpen(true);
  }, [ensureOwnerReady]);

  const handleCreateCredential = async (event: React.FormEvent) => {
    event.preventDefault();
    const boundOwner = await ensureOwnerReady();
    if (!boundOwner) {
      return;
    }

    try {
      setError(null);
      setIsLoading(true);
      const result = await issueAgentCredential(boundOwner, {
        name: agentName || "Unnamed Agent",
        ownerAddress: boundOwner,
        creditLimit: Number.parseFloat(dailyBudget),
        maxCalls: Number.parseInt(maxCalls, 10),
        resetInterval: "daily",
      });
      setNewCredential(result);
      setSandboxCredential(result.token);
      setIsCreateModalOpen(false);
      setAgentName("");
      setDailyBudget("10.00");
      setMaxCalls("1000");
      toast.success(`Agent created for owner ${boundOwner.slice(0, 6)}...${boundOwner.slice(-4)}`);
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to create credential:", err);
      setError("Failed to create agent. Please check your balance and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!userAddress || !confirm("Are you sure you want to revoke this agent's access? This action cannot be undone.")) {
      return;
    }

    try {
      await revokeAgentCredential(userAddress, id);
      await fetchCredentials();
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

  const activeAgentsCount = credentials.filter((credential) => credential.status === "active").length;
  const latestCredential = credentials[0] ?? null;
  const latestSuccessfulInvocation = logs
    .filter((log) => (log.status === "accepted" || log.status === "succeeded") && typeof log.created_at === "number")
    .sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0))[0];
  const hasSuccessfulInvocation = Boolean(latestSuccessfulInvocation);
  const selectedService = services.find((service) => service.serviceId === selectedServiceId) ?? services[0] ?? null;

  const handlePrimaryAction = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!isSessionAuthenticated) {
      const ok = await authorize();
      if (!ok) {
        setError("Please sign in with your wallet before continuing.");
      }
      return;
    }

    if (Number(stats.ownerBalance) <= 0) {
      scrollToSection("activation-runway");
      return;
    }

    if (activeAgentsCount === 0) {
      void handleOpenCreateModal();
      return;
    }

    if (!hasSuccessfulInvocation) {
      scrollToSection("first-invocation-panel");
      return;
    }

    await handleRefresh();
  }, [activeAgentsCount, authorize, handleOpenCreateModal, handleRefresh, hasSuccessfulInvocation, isConnected, isSessionAuthenticated, openConnectModal, stats.ownerBalance]);

  const handlePersistSandboxCredential = useCallback(() => {
    if (!selectedService || !sandboxCredential.trim()) {
      return;
    }
    setCredentialForService(selectedService.serviceId, sandboxCredential.trim());
    toast.success(`Saved credential for ${selectedService.name}.`);
  }, [sandboxCredential, selectedService]);

  const handleRunExample = useCallback(async (payloadText: string) => {
    if (!selectedService) {
      setSandboxInvokeError("Select a service before invoking the sandbox.");
      return;
    }

    const credential = sandboxCredential.trim();
    if (!credential) {
      setSandboxInvokeError("Paste the full agent credential token before running the paid example.");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setSandboxInvokeError("Payload must be valid JSON.");
      return;
    }

    try {
      setSandboxInvokeError(null);
      setSandboxInvokeResult(null);
      setIsSandboxInvoking(true);
      setCredentialForService(selectedService.serviceId, credential);

      const providerAddress = selectedService.ownerAddress || selectedService.address;
      if (!providerAddress) {
        throw new Error("Selected service is missing a provider address.");
      }

      const startedAt = performance.now();
      const result = await invokePaidService({
        endpoint: selectedService.endpoint,
        serviceId: selectedService.serviceId,
        payload,
        credential,
        payForService: async () => payForServiceWithApproval({
          provider: providerAddress as `0x${string}`,
          serviceId: selectedService.serviceId,
          priceUsdc: resolvePrice(selectedService.pricing),
        }),
      });
      const durationMs = Math.round(performance.now() - startedAt);

      setSandboxInvokeResult({
        txHash: result.txHash,
        attempts: result.attempts,
        durationMs,
        chargedUsdc: resolvePrice(selectedService.pricing),
        serviceName: selectedService.name,
        requestId: extractRequestId(result.response),
        response: result.response,
      });
      toast.success("Paid invocation completed.");
      await Promise.allSettled([handleOwnerRefresh(), fetchCredentials()]);
    } catch (err) {
      console.error("Sandbox invoke failed:", err);
      const message = err instanceof Error ? err.message : "Invocation failed";
      setSandboxInvokeError(message);
    } finally {
      setIsSandboxInvoking(false);
    }
  }, [fetchCredentials, handleOwnerRefresh, sandboxCredential, selectedService]);

  let primaryActionLabel = "Refresh Workspace";
  if (!isConnected) {
    primaryActionLabel = "Connect Wallet";
  } else if (!isSessionAuthenticated) {
    primaryActionLabel = "Sign In";
  } else if (Number(stats.ownerBalance) <= 0) {
    primaryActionLabel = "Add Funds";
  } else if (activeAgentsCount === 0) {
    primaryActionLabel = "Create Agent";
  } else if (!hasSuccessfulInvocation) {
    primaryActionLabel = "Run First Paid Invocation";
  }

  let credentialsContent: React.ReactNode;

  if (isLoading && credentials.length === 0) {
    credentialsContent = [1, 2, 3].map((index) => (
      <article key={index} aria-hidden="true" className="h-64 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
    ));
  } else if (credentials.length === 0) {
    credentialsContent = (
      <section className="col-span-full flex flex-col items-center justify-center space-y-4 rounded-3xl border border-dashed border-white/10 bg-white/[0.01] py-20 text-center">
        <span className="rounded-full bg-white/[0.03] p-4" aria-hidden="true">
          <Bot className="h-10 w-10 text-gray-600" />
        </span>
        <header>
          <h3 className="text-lg font-bold text-white">No Agents Found</h3>
          <p className="mx-auto mt-1 max-w-xs text-sm text-gray-500">Create your first runtime profile to start using Synapse Network services.</p>
        </header>
        <button
          type="button"
          onClick={() => {
            void handleOpenCreateModal();
          }}
          className="rounded-full bg-white px-6 py-2 text-xs font-bold text-black transition-colors hover:bg-gray-200"
        >
          Get Started
        </button>
      </section>
    );
  } else {
    credentialsContent = credentials.map((agent) => {
      const usagePercent = agent.maxCalls > 0 ? Math.min(100, Math.round((agent.callsUsed / agent.maxCalls) * 100)) : 0;

      return (
        <article key={agent.id} className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-6 transition-all hover:border-blue-500/30 hover:bg-white/[0.04]">
          <header className="mb-6 flex items-start justify-between">
            <section className="flex items-center gap-3">
              <span className={`rounded-xl border p-3 ${agent.status === "active" ? "border-blue-500/20 bg-blue-500/10" : "border-gray-500/20 bg-gray-500/10"}`} aria-hidden="true">
                <Bot className={`h-5 w-5 ${agent.status === "active" ? "text-blue-400" : "text-gray-500"}`} />
              </span>
              <section>
                <h3 className="font-bold text-white">{agent.name}</h3>
                <p className="font-mono text-xs text-gray-500">{agent.id.slice(0, 8)}...</p>
              </section>
            </section>
            <p className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${agent.status === "active" ? "bg-blue-500/10 text-blue-400" : "bg-gray-500/10 text-gray-500"}`}>
              {agent.status}
            </p>
          </header>

          <section className="space-y-4">
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <dt className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">Daily Budget</dt>
                <dd className="text-sm font-bold text-emerald-400">${(agent.creditLimit ?? 0).toFixed(2)}</dd>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <dt className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">Calls</dt>
                <dd className="text-sm font-bold text-white">{agent.callsUsed} / {agent.maxCalls}</dd>
              </div>
            </dl>

            <section>
              <header className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Usage</span>
                <span className="text-[10px] text-gray-500">{usagePercent}%</span>
              </header>
              <span className="block h-2 overflow-hidden rounded-full bg-white/[0.03]" aria-hidden="true">
                <span className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all" style={{ width: `${usagePercent}%` }} />
              </span>
            </section>

            <footer className="flex items-center justify-between border-t border-white/5 pt-4">
              <p>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Created</span>
                <span className="text-xs text-gray-400">{agent.createdAt ? new Date(agent.createdAt).toLocaleDateString() : "Pending"}</span>
              </p>
              <menu className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyToClipboard(agent.tokenPrefix ?? agent.id, agent.id)}
                  className="rounded-lg bg-white/5 p-2 transition-colors hover:bg-white/10"
                  title="Copy token prefix"
                >
                  {copiedId === agent.id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-gray-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevoke(agent.id)}
                  className="group/btn rounded-lg bg-red-500/5 p-2 transition-colors hover:bg-red-500/10"
                  title="Revoke agent"
                >
                  <Trash2 className="h-4 w-4 text-red-400 group-hover/btn:text-red-300" />
                </button>
              </menu>
            </footer>
          </section>
        </article>
      );
    });
  }

  const issuedCredential = newCredential;

  return (
    <main className="mx-auto max-w-[1400px] space-y-10 p-8">
      <ActivationStatusStrip
        isConnected={isConnected}
        isSessionAuthenticated={isSessionAuthenticated}
        ownerBalance={stats.ownerBalance}
        activeAgents={activeAgentsCount}
        lastInvocationAt={latestSuccessfulInvocation?.created_at}
        primaryActionLabel={primaryActionLabel}
        onPrimaryAction={() => {
          void handlePrimaryAction();
        }}
        isPrimaryActionDisabled={isRefreshing}
      />

      <ActivationRunway
        isConnected={isConnected}
        hasSession={isSessionAuthenticated}
        ownerBalance={stats.ownerBalance}
        hasActiveAgent={activeAgentsCount > 0}
        latestCredentialPrefix={latestCredential?.tokenPrefix}
        latestIssuedToken={issuedCredential?.token}
        hasSuccessfulInvocation={hasSuccessfulInvocation}
        onDepositComplete={() => {
          void fetchCredentials();
          handleOwnerRefresh();
        }}
        onAgentCreated={() => {
          void handleOpenCreateModal();
        }}
        onRunExample={() => {
          scrollToSection("first-invocation-panel");
        }}
        onCopyLatestCredential={() => {
          if (issuedCredential?.token) {
            setSandboxCredential(issuedCredential.token);
          }
        }}
      />

      <FirstInvocationPanel
        services={services}
        isLoading={isServicesLoading}
        error={serviceError}
        selectedServiceId={selectedServiceId}
        onSelectService={setSelectedServiceId}
        credential={sandboxCredential}
        onCredentialChange={setSandboxCredential}
        onPersistCredential={handlePersistSandboxCredential}
        onRunExample={(payloadText) => {
          void handleRunExample(payloadText);
        }}
        isInvoking={isSandboxInvoking}
        invokeError={sandboxInvokeError}
        result={sandboxInvokeResult}
      />

      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <section>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Bot className="h-6 w-6 text-blue-400" />
            Agent Workspace
          </h1>
          <p className="mt-1 text-sm text-gray-500">Manage runtime identities, credentials, budget policies, and the credential lifecycle after activation.</p>
        </section>

        <menu className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handleRefresh();
            }}
            disabled={isRefreshing}
            className="rounded-lg border border-white/10 bg-white/5 p-2 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-gray-400 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              void handleOpenCreateModal();
            }}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-400"
          >
            <Plus className="h-4 w-4" />
            Create New Agent
          </button>
        </menu>
      </header>

      {error && (
        <aside role="alert" className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle className="h-5 w-5" />
          {error}
        </aside>
      )}

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-label="Agent profiles list">
        {credentialsContent}
      </section>

      {isCreateModalOpen && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" aria-labelledby="create-agent-title">
          <section className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/5 p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <span id="create-agent-title" className="sr-only">Create Agent Profile</span>
                <Plus className="h-5 w-5 text-blue-400" />
                Create Agent Profile
              </h2>
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="text-gray-500 hover:text-white">
                <XCircle className="h-5 w-5" />
              </button>
            </header>
            <form onSubmit={handleCreateCredential} className="space-y-6 p-6">
              <label htmlFor="agent-name" className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Agent Name</span>
                <input
                  id="agent-name"
                  type="text"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  placeholder="e.g. ResearchBot-01"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                  required
                />
              </label>
              <label htmlFor="bound-owner" className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Bound Owner</span>
                <input
                  id="bound-owner"
                  type="text"
                  readOnly
                  value={ownerAddress || "Wallet session required"}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-mono text-blue-300"
                />
              </label>
              <section className="grid grid-cols-2 gap-4">
                <label htmlFor="daily-budget" className="block space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Daily Budget (USDC)</span>
                  <input
                    id="daily-budget"
                    type="number"
                    step="0.01"
                    value={dailyBudget}
                    onChange={(event) => setDailyBudget(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                    required
                  />
                </label>
                <label htmlFor="max-calls" className="block space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Max Calls</span>
                  <input
                    id="max-calls"
                    type="number"
                    value={maxCalls}
                    onChange={(event) => setMaxCalls(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                    required
                  />
                </label>
              </section>
              <aside className="flex items-start gap-3 rounded-xl border border-blue-500/10 bg-blue-500/5 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-400" />
                <p className="text-[11px] leading-relaxed text-gray-400">
                  Creating an agent will issue a unique credential bound to the active owner wallet session. You can revoke access or update budget policies at any time.
                </p>
              </aside>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-xl bg-blue-500 py-4 text-sm font-bold text-white transition-all hover:bg-blue-400 disabled:opacity-50"
              >
                {isLoading ? "Creating..." : "Issue Credential"}
              </button>
            </form>
          </section>
        </dialog>
      )}

      {issuedCredential && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md" aria-labelledby="issued-agent-title">
          <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-500/20 bg-[#0a0a0c] shadow-[0_0_50px_rgba(16,185,129,0.1)]">
            <section className="space-y-6 p-8 text-center">
              <span className="mx-auto block w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 p-4" aria-hidden="true">
                <ShieldCheck className="h-10 w-10 text-emerald-400" />
              </span>
              <header>
                <h2 id="issued-agent-title" className="text-2xl font-bold text-white">Agent Credential Issued</h2>
                <p className="mt-2 text-sm text-gray-500">Copy this token now. For security, it will not be shown again.</p>
              </header>

              <section className="group relative">
                <code className="block break-all rounded-2xl border border-white/10 bg-black p-4 pr-12 text-left font-mono text-sm text-emerald-400">
                  {issuedCredential.token}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(issuedCredential.token, "new-token")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg bg-white/5 p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {copiedId === "new-token" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </section>

              <dl className="grid grid-cols-2 gap-4 text-left">
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <dt className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Agent Name</dt>
                  <dd className="text-sm font-bold text-white">{issuedCredential.name}</dd>
                </div>
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <dt className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Daily Budget</dt>
                  <dd className="text-sm font-bold text-emerald-400">${(issuedCredential.creditLimit ?? 0).toFixed(2)}</dd>
                </div>
              </dl>

              <dl className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-left">
                <dt className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Bound Owner</dt>
                <dd className="break-all font-mono text-sm text-blue-300">{issuedCredential.ownerAddress}</dd>
              </dl>

              <button
                type="button"
                onClick={() => setNewCredential(null)}
                className="w-full rounded-xl bg-white py-4 text-sm font-bold text-black transition-all hover:bg-gray-200"
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
