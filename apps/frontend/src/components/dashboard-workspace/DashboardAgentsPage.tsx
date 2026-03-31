"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AlertCircle, Bot, Check, Copy, PencilLine, Plus, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import ActivationRunway from "@/components/dashboard/agents/ActivationRunway";
import ActivationStatusStrip from "@/components/dashboard/agents/ActivationStatusStrip";
import FirstInvocationPanel, { type FirstInvocationResult } from "@/components/dashboard/agents/FirstInvocationPanel";
import { formatAgentBudget, getAgentUsagePercent } from "@/components/dashboard/agents/agentWorkspacePresenters";
import { useOwnerData } from "@/hooks/useOwnerData";
import {
  issueAgentCredential,
  listAgentCredentials,
  revokeAgentCredential,
  updateAgentCredentialQuota,
  type AgentCredentialIssueResponse,
  type AgentCredentialRecord,
} from "@/utils/agentCredentialApi";
import { setCredentialForService } from "@/utils/agentCredentialStore";
import { clearAuthSession, WALLET_SESSION_MISSING_MESSAGE } from "@/utils/authSession";
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

type DashboardAgentsPageProps = {
  mode?: "guide" | "workspace";
};

export default function DashboardAgentsPage({ mode = "guide" }: Readonly<DashboardAgentsPageProps>) {
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { t } = useLanguage();
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
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [quotaMaxCalls, setQuotaMaxCalls] = useState("1000");
  const [quotaRpm, setQuotaRpm] = useState("600");
  const [quotaDailyBudget, setQuotaDailyBudget] = useState("10.00");
  const [quotaExpiresAtLocal, setQuotaExpiresAtLocal] = useState("");
  const [isRegeneratingCredential, setIsRegeneratingCredential] = useState(false);

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
      const message = err instanceof Error ? err.message : t("agentsPage.loadCredentialsFailed");
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isSessionAuthenticated, t, userAddress]);

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
      setServiceError(t("agentsPage.loadDiscoveryFailed"));
    } finally {
      setIsServicesLoading(false);
    }
  }, [t]);

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
      setError(t("agentsPage.connectWalletBeforeCreate"));
      return null;
    }

    if (!userAddress) {
      setError(t("agentsPage.walletUnavailable"));
      return null;
    }

    if (!isSessionAuthenticated) {
      const ok = await authorize();
      if (!ok) {
        setError(t("agentsPage.signInBeforeCreate"));
        return null;
      }
    }

    return userAddress.toLowerCase();
  }, [authorize, isConnected, isSessionAuthenticated, openConnectModal, t, userAddress]);

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
        name: agentName || t("agentsPage.unnamedAgent"),
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
      toast.success(t("agentsPage.agentCreatedToast", { owner: `${boundOwner.slice(0, 6)}...${boundOwner.slice(-4)}` }));
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to create credential:", err);
      setError(t("agentsPage.createAgentFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!userAddress || !confirm(t("agentsPage.confirmRevoke"))) {
      return;
    }

    try {
      await revokeAgentCredential(userAddress, id);
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to revoke credential:", err);
      alert(t("agentsPage.revokeFailed"));
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openEditModal = (agent: AgentCredentialRecord) => {
    setSelectedCredentialId(agent.id);
    setQuotaMaxCalls(String(agent.maxCalls || 0));
    setQuotaRpm(String(agent.rpm || 0));
    setQuotaDailyBudget(String(agent.creditLimit ?? 0));
    if (agent.expiresAt) {
      setQuotaExpiresAtLocal(new Date(agent.expiresAt * 1000).toISOString().slice(0, 16));
    } else {
      setQuotaExpiresAtLocal("");
    }
    setIsEditModalOpen(true);
  };

  const handleUpdateQuota = async () => {
    if (!userAddress || !selectedCredentialId) {
      return;
    }

    try {
      const parsedMaxCalls = Number.parseInt(quotaMaxCalls, 10) || 0;
      const parsedRpm = Number.parseInt(quotaRpm, 10) || 0;
      const parsedCreditLimit = Number.parseFloat(quotaDailyBudget);
      const parsedExpiresAt = quotaExpiresAtLocal
        ? Math.floor(new Date(quotaExpiresAtLocal).getTime() / 1000)
        : 0;

      await updateAgentCredentialQuota(userAddress, selectedCredentialId, {
        maxCalls: parsedMaxCalls,
        rpm: parsedRpm,
        creditLimit: Number.isFinite(parsedCreditLimit) && parsedCreditLimit > 0 ? parsedCreditLimit : undefined,
        expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : 0,
      });
      toast.success(t("agentsPage.agentLimitsUpdated"));
      setIsEditModalOpen(false);
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to update agent quota:", err);
      toast.error(err instanceof Error ? err.message : t("agentsPage.updateAgentLimitsFailed"));
    }
  };

  const activeAgentsCount = credentials.filter((credential) => credential.status === "active").length;
  const visibleCredentials = useMemo(() => credentials, [credentials]);
  const latestCredential = credentials[0] ?? null;
  const selectedAgent = useMemo(() => {
    if (visibleCredentials.length === 0) {
      return null;
    }
    return visibleCredentials.find((agent) => agent.id === selectedAgentId) ?? visibleCredentials[0];
  }, [selectedAgentId, visibleCredentials]);

  useEffect(() => {
    if (visibleCredentials.length === 0) {
      if (selectedAgentId !== null) {
        setSelectedAgentId(null);
      }
      return;
    }

    if (!selectedAgentId || !visibleCredentials.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(visibleCredentials[0].id);
    }
  }, [selectedAgentId, visibleCredentials]);

  const handleRegenerateCredential = useCallback(async (agent: AgentCredentialRecord) => {
    const boundOwner = await ensureOwnerReady();
    if (!boundOwner) {
      return;
    }

    try {
      setIsRegeneratingCredential(true);
      setError(null);

      const result = await issueAgentCredential(boundOwner, {
        name: agent.name || t("agentsPage.unnamedAgent"),
        ownerAddress: boundOwner,
        creditLimit: agent.creditLimit ?? undefined,
        maxCalls: agent.maxCalls || undefined,
        rpm: agent.rpm || undefined,
        resetInterval: agent.resetInterval,
        expiration: agent.expiration ?? undefined,
      });

      if (agent.status === "active") {
        await revokeAgentCredential(boundOwner, agent.id);
      }

      setNewCredential(result);
      setSandboxCredential(result.token);
      setSelectedAgentId(result.id);
      toast.success(t("agentsPage.workspaceCredentialRegeneratedToast"));
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to regenerate credential:", err);
      toast.error(err instanceof Error ? err.message : t("agentsPage.workspaceCredentialRegeneratedFailed"));
    } finally {
      setIsRegeneratingCredential(false);
    }
  }, [ensureOwnerReady, fetchCredentials, t]);

  const selectedAgentUsagePercent = selectedAgent ? getAgentUsagePercent(selectedAgent) : 0;
  const selectedAgentRemainingCalls = selectedAgent
    ? Math.max(0, (selectedAgent.maxCalls || 0) - selectedAgent.callsUsed)
    : 0;
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
        setError(t("agentsPage.signInBeforeContinuing"));
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
  }, [activeAgentsCount, authorize, handleOpenCreateModal, handleRefresh, hasSuccessfulInvocation, isConnected, isSessionAuthenticated, openConnectModal, stats.ownerBalance, t]);

  const handlePersistSandboxCredential = useCallback(() => {
    if (!selectedService || !sandboxCredential.trim()) {
      return;
    }
    setCredentialForService(selectedService.serviceId, sandboxCredential.trim());
    toast.success(t("agentsPage.credentialSavedToast", { service: selectedService.name }));
  }, [sandboxCredential, selectedService, t]);

  const handleRunExample = useCallback(async (payloadText: string) => {
    if (!selectedService) {
      setSandboxInvokeError(t("agentsPage.selectServiceBeforeInvoking"));
      return;
    }

    const credential = sandboxCredential.trim();
    if (!credential) {
      setSandboxInvokeError(t("agentsPage.pasteCredentialBeforeRun"));
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setSandboxInvokeError(t("agentsPage.payloadMustBeValidJson"));
      return;
    }

    try {
      setSandboxInvokeError(null);
      setSandboxInvokeResult(null);
      setIsSandboxInvoking(true);
      setCredentialForService(selectedService.serviceId, credential);

      const providerAddress = selectedService.ownerAddress || selectedService.address;
      if (!providerAddress) {
        throw new Error(t("agentsPage.selectedServiceMissingProvider"));
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
      toast.success(t("agentsPage.paidInvocationCompleted"));
      await Promise.allSettled([handleOwnerRefresh(), fetchCredentials()]);
    } catch (err) {
      console.error("Sandbox invoke failed:", err);
      const message = err instanceof Error ? err.message : t("agentsPage.invocationFailed");
      setSandboxInvokeError(message);
    } finally {
      setIsSandboxInvoking(false);
    }
  }, [fetchCredentials, handleOwnerRefresh, sandboxCredential, selectedService, t]);

  const isGuideMode = mode === "guide";

  let primaryActionLabel = t("agentsPage.refreshWorkspace");
  if (!isConnected) {
    primaryActionLabel = t("agentsPage.connectWallet");
  } else if (!isSessionAuthenticated) {
    primaryActionLabel = t("agentsPage.signIn");
  } else if (Number(stats.ownerBalance) <= 0) {
    primaryActionLabel = t("agentsPage.addFunds");
  } else if (activeAgentsCount === 0) {
    primaryActionLabel = t("agentsPage.createAgent");
  } else if (!hasSuccessfulInvocation) {
    primaryActionLabel = t("agentsPage.runFirstPaidInvocation");
  }

  const issuedCredential = newCredential;

  const guideContent = (
    <>
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
    </>
  );

  const workspaceContent = (
    <>
      <header className="border-b border-white/8 pb-8">
        <section>
          <h1 className="flex items-center gap-2 text-[2.2rem] font-bold tracking-tight text-white">
            <Bot className="h-6 w-6 text-blue-400" />
            {t("agentsPage.workspaceSimpleTitle")}
          </h1>
          <p className="mt-3 max-w-3xl text-lg text-gray-400">{t("agentsPage.workspaceSimpleDescription")}</p>
        </section>
      </header>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <article className="rounded-[28px] border border-white/8 bg-[#0f0f10] p-6">
          <header className="mb-6 flex flex-col gap-4 border-b border-white/8 pb-6">
            <div>
              <h2 className="mt-2 text-[1.75rem] font-bold text-white">{t("agentsPage.workspaceYourAgentsTitle")}</h2>
              <p className="mt-2 text-sm text-gray-400">{t("agentsPage.workspaceYourAgentsDescription")}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  void handleOpenCreateModal();
                }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-gray-200"
              >
                <Plus className="h-4 w-4" />
                {t("agentsPage.workspaceCreateAgentCompact")}
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void handleRefresh();
                  }}
                  disabled={isRefreshing}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50"
                >
                  {isRefreshing ? t("agentsPage.workspaceManaging") : t("agentsPage.workspaceManageAgents")}
                </button>
              </div>
            </div>

          </header>

          <div className="space-y-4">
            {isLoading && credentials.length === 0 ? (
              [1, 2, 3].map((index) => (
                <div key={index} className="h-28 animate-pulse rounded-[24px] border border-white/5 bg-white/[0.03]" />
              ))
            ) : visibleCredentials.length === 0 ? (
              <section className="flex min-h-[420px] flex-col items-center justify-center space-y-4 rounded-[28px] border border-dashed border-white/10 bg-[#121213] p-8 text-center">
                <span className="rounded-full bg-white/[0.03] p-4" aria-hidden="true">
                  <Bot className="h-10 w-10 text-gray-600" />
                </span>
                <header>
                  <h3 className="text-lg font-bold text-white">{t("agentsPage.workspaceNoMatchingAgents")}</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{t("agentsPage.workspaceNoMatchingAgentsDescription")}</p>
                </header>
              </section>
            ) : (
              visibleCredentials.map((agent) => {
                const usagePercent = getAgentUsagePercent(agent);
                const isSelected = selectedAgent?.id === agent.id;
                const statusClasses = agent.status === "active"
                  ? "bg-emerald-500/12 text-emerald-300"
                  : "bg-white/[0.06] text-gray-300";

                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={[
                      "w-full rounded-[24px] border p-5 text-left transition-all",
                      isSelected
                        ? "border-blue-400/30 bg-[#151922] shadow-[0_0_0_1px_rgba(96,165,250,0.18)]"
                        : "border-white/8 bg-[#121213] hover:border-white/14 hover:bg-[#151516]",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <span className={`rounded-2xl border p-3 ${agent.status === "active" ? "border-blue-500/20 bg-blue-500/10" : "border-gray-500/20 bg-gray-500/10"}`} aria-hidden="true">
                          <Bot className={`h-5 w-5 ${agent.status === "active" ? "text-blue-400" : "text-gray-500"}`} />
                        </span>
                        <div>
                          <h3 className="text-xl font-semibold tracking-tight text-white">{agent.name || t("agentsPage.unnamedAgent")}</h3>
                          <p className="mt-2 text-sm text-gray-400">{t("agentsPage.workspaceAgentCardDescription")}</p>
                          <div className="mt-4 flex items-center gap-3">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses}`}>
                              {agent.status === "active" ? t("agentsPage.workspaceFilterActive") : t("agentsPage.workspaceToneRevoked")}
                            </span>
                            <span className="font-mono text-xs text-gray-500">{agent.tokenPrefix || agent.id.slice(0, 12)}</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500">{usagePercent}%</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="rounded-[28px] border border-white/8 bg-[#0f0f10]">
          {!selectedAgent ? (
            <section className="flex min-h-[720px] flex-col items-center justify-center px-8 text-center">
              <span className="rounded-[22px] bg-blue-500/10 p-5" aria-hidden="true">
                <Bot className="h-10 w-10 text-blue-300" />
              </span>
              <h2 className="mt-6 text-4xl font-bold tracking-tight text-white">{t("agentsPage.workspaceDetailEmptyTitle")}</h2>
              <p className="mt-4 max-w-md text-lg leading-8 text-gray-400">{t("agentsPage.workspaceDetailEmptyDescription")}</p>
            </section>
          ) : (
            <>
              <header className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-[2rem] font-bold tracking-tight text-white">{selectedAgent.name || t("agentsPage.unnamedAgent")}</h2>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedAgent.id, `agent-id-${selectedAgent.id}`)}
                      className="rounded-lg border border-white/10 p-2 text-gray-400 transition hover:border-white/20 hover:text-white"
                      title={t("agentsPage.workspaceCopyAgentId")}
                    >
                      {copiedId === `agent-id-${selectedAgent.id}` ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-3 text-base text-gray-400">{t("agentsPage.workspaceDetailDescription")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(null)}
                  className="text-gray-500 transition hover:text-white"
                  aria-label={t("agentsPage.workspaceCloseDetail")}
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </header>

              <section className="space-y-8 px-6 py-6">
                <section>
                  <h3 className="text-2xl font-bold text-white">{t("agentsPage.workspaceCredentialPanelTitle")}</h3>
                  <p className="mt-2 text-base text-gray-400">{t("agentsPage.workspaceCredentialPanelDescription")}</p>
                </section>

                <section className="space-y-5">
                  <article className="rounded-2xl bg-white/[0.04] p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-500">{t("agentsPage.workspaceCredentialPrefixLabel")}</p>
                        <p className="mt-2 font-mono text-lg text-white">{selectedAgent.tokenPrefix || selectedAgent.id.slice(0, 18)}</p>
                      </div>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => void handleRegenerateCredential(selectedAgent)}
                          disabled={selectedAgent.status !== "active" || isRegeneratingCredential}
                          className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRegeneratingCredential ? t("agentsPage.workspaceRegenerating") : t("agentsPage.workspaceRegenerateCredential")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(selectedAgent.id)}
                          className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400"
                        >
                          {t("agentsPage.workspaceRevokeShort")}
                        </button>
                      </div>
                    </div>
                  </article>

                  <article className="rounded-2xl bg-white/[0.04] p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-500">{t("agentsPage.workspaceQuotaPanelTitle")}</p>
                        <p className="mt-2 text-base text-gray-400">{t("agentsPage.workspaceQuotaPanelDescription")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditModal(selectedAgent)}
                        disabled={selectedAgent.status !== "active"}
                        className="inline-flex items-center gap-2 rounded-full border border-white/14 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PencilLine className="h-4 w-4" />
                        {t("agentsPage.workspaceEdit")}
                      </button>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceBudgetTile")}</p>
                        <p className="mt-3 text-2xl font-bold text-emerald-400">{formatAgentBudget(selectedAgent.creditLimit)}</p>
                      </div>
                      <div className="rounded-2xl bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceUsageTile")}</p>
                        <p className="mt-3 text-2xl font-bold text-white">{selectedAgent.callsUsed} / {selectedAgent.maxCalls || "∞"}</p>
                      </div>
                      <div className="rounded-2xl bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceRateLimitTile")}</p>
                        <p className="mt-3 text-2xl font-bold text-white">{selectedAgent.rpm > 0 ? `${selectedAgent.rpm}/min` : t("agentsPage.workspaceUnlimited")}</p>
                      </div>
                      <div className="rounded-2xl bg-black/30 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceRemainingCallsTile")}</p>
                        <p className="mt-3 text-2xl font-bold text-white">{selectedAgentRemainingCalls}</p>
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="flex items-center justify-between text-sm text-gray-400">
                        <span>{t("agentsPage.workspaceUsageBarLabel")}</span>
                        <span>{selectedAgentUsagePercent}%</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: `${selectedAgentUsagePercent}%` }} />
                      </div>
                    </div>
                  </article>

                  <article className="rounded-2xl bg-white/[0.04] p-5">
                    <h3 className="text-lg font-semibold text-white">{t("agentsPage.workspaceDetailMetaTitle")}</h3>
                    <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl bg-black/30 p-4">
                        <dt className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceStatusTile")}</dt>
                        <dd className="mt-3 text-base font-semibold text-white">{selectedAgent.status === "active" ? t("agentsPage.workspaceFilterActive") : t("agentsPage.workspaceToneRevoked")}</dd>
                      </div>
                      <div className="rounded-2xl bg-black/30 p-4">
                        <dt className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceUpdatedTile")}</dt>
                        <dd className="mt-3 text-base font-semibold text-white">
                          {selectedAgent.updatedAt || selectedAgent.createdAt ? new Date((selectedAgent.updatedAt ?? selectedAgent.createdAt) as string | number).toLocaleString() : t("agentsPage.workspacePending")}
                        </dd>
                      </div>
                      <div className="rounded-2xl bg-black/30 p-4 sm:col-span-2">
                        <dt className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.boundOwnerValueLabel")}</dt>
                        <dd className="mt-3 break-all font-mono text-sm text-blue-300">{selectedAgent.ownerAddress}</dd>
                      </div>
                      <div className="rounded-2xl bg-black/30 p-4 sm:col-span-2">
                        <dt className="text-xs uppercase tracking-[0.2em] text-gray-500">{t("agentsPage.workspaceSecretVisibilityTitle")}</dt>
                        <dd className="mt-3 text-sm leading-7 text-gray-400">{t("agentsPage.workspaceSecretVisibilityDescription")}</dd>
                      </div>
                    </dl>
                  </article>
                </section>
              </section>
            </>
          )}
        </article>
      </section>
    </>
  );

  return (
    <main className="mx-auto max-w-[1400px] space-y-10 p-8">
      {error && (
        <aside role="alert" className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle className="h-5 w-5" />
          {error}
        </aside>
      )}

      {isGuideMode ? guideContent : workspaceContent}

      {isCreateModalOpen && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" aria-labelledby="create-agent-title">
          <section className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/5 p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <span id="create-agent-title" className="sr-only">{t("agentsPage.createAgentProfile")}</span>
                <Plus className="h-5 w-5 text-blue-400" />
                {t("agentsPage.createAgentProfile")}
              </h2>
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="text-gray-500 hover:text-white">
                <XCircle className="h-5 w-5" />
              </button>
            </header>
            <form onSubmit={handleCreateCredential} className="space-y-6 p-6">
              <label htmlFor="agent-name" className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.agentNameLabel")}</span>
                <input
                  id="agent-name"
                  type="text"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  placeholder={t("agentsPage.agentNamePlaceholder")}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                  required
                />
              </label>
              <label htmlFor="bound-owner" className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.boundOwnerLabel")}</span>
                <input
                  id="bound-owner"
                  type="text"
                  readOnly
                  value={ownerAddress || t("agentsPage.walletSessionRequired")}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-mono text-blue-300"
                />
              </label>
              <section className="grid grid-cols-2 gap-4">
                <label htmlFor="daily-budget" className="block space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</span>
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
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.maxCallsLabel")}</span>
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
                  {t("agentsPage.createAgentHint")}
                </p>
              </aside>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-xl bg-blue-500 py-4 text-sm font-bold text-white transition-all hover:bg-blue-400 disabled:opacity-50"
              >
                {isLoading ? t("agentsPage.creating") : t("agentsPage.issueCredential")}
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
                <h2 id="issued-agent-title" className="text-2xl font-bold text-white">{t("agentsPage.credentialIssuedTitle")}</h2>
                <p className="mt-2 text-sm text-gray-500">{t("agentsPage.credentialIssuedDescription")}</p>
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
                  <dt className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.agentNameLabel")}</dt>
                  <dd className="text-sm font-bold text-white">{issuedCredential.name}</dd>
                </div>
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <dt className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</dt>
                  <dd className="text-sm font-bold text-emerald-400">${(issuedCredential.creditLimit ?? 0).toFixed(2)}</dd>
                </div>
              </dl>

              <dl className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-left">
                <dt className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.boundOwnerValueLabel")}</dt>
                <dd className="break-all font-mono text-sm text-blue-300">{issuedCredential.ownerAddress}</dd>
              </dl>

              <button
                type="button"
                onClick={() => setNewCredential(null)}
                className="w-full rounded-xl bg-white py-4 text-sm font-bold text-black transition-all hover:bg-gray-200"
              >
                {t("agentsPage.savedTokenCta")}
              </button>
            </section>
          </section>
        </dialog>
      )}

      {isEditModalOpen && (
        <dialog open className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" aria-labelledby="edit-agent-title">
          <section className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/5 p-6">
              <h2 id="edit-agent-title" className="flex items-center gap-2 text-lg font-bold text-white">
                <PencilLine className="h-5 w-5 text-blue-400" />
                {t("agentsPage.editAgentLimitsTitle")}
              </h2>
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="text-gray-500 hover:text-white">
                <XCircle className="h-5 w-5" />
              </button>
            </header>
            <section className="space-y-5 p-6">
              <p className="text-sm leading-6 text-gray-400">{t("agentsPage.editAgentLimitsDescription")}</p>
              <label className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.maxCallsLabel")}</span>
                <input
                  type="number"
                  value={quotaMaxCalls}
                  onChange={(event) => setQuotaMaxCalls(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.rateLimitLabel")}</span>
                <input
                  type="number"
                  value={quotaRpm}
                  onChange={(event) => setQuotaRpm(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quotaDailyBudget}
                  onChange={(event) => setQuotaDailyBudget(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.expirationLabel")}</span>
                <input
                  type="datetime-local"
                  value={quotaExpiresAtLocal}
                  onChange={(event) => setQuotaExpiresAtLocal(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-blue-500/50 focus:outline-none"
                />
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-white/5">{t("agentsPage.cancel")}</button>
                <button type="button" onClick={() => void handleUpdateQuota()} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-400">{t("agentsPage.save")}</button>
              </div>
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
