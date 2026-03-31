"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AlertCircle, Bot, Check, Copy, MinusCircle, PencilLine, Plus, ShieldCheck } from "lucide-react";
import { createPortal } from "react-dom";
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
  deleteAgentCredential,
  issueAgentCredential,
  listAgentCredentials,
  revokeAgentCredential,
  rotateAgentCredential,
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

type PendingDangerAction =
  | { type: "generate"; agent: AgentCredentialRecord }
  | { type: "revoke"; agent: AgentCredentialRecord }
  | { type: "regenerate"; agent: AgentCredentialRecord };

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
  const [isRevokingCredential, setIsRevokingCredential] = useState(false);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [pendingDangerAction, setPendingDangerAction] = useState<PendingDangerAction | null>(null);
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState<AgentCredentialRecord | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");

  const [agentName, setAgentName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10.00");
  const [maxCalls, setMaxCalls] = useState("1000");
  const ownerAddress = userAddress?.toLowerCase() ?? "";
  const isAnyModalOpen = Boolean(
    isCreateModalOpen
    || pendingDangerAction
    || pendingDeleteAgent
    || newCredential
    || isEditModalOpen,
  );

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

  useEffect(() => {
    if (!isAnyModalOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isAnyModalOpen]);

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
    if (!userAddress) {
      return;
    }

    try {
      setIsRevokingCredential(true);
      await revokeAgentCredential(userAddress, id);
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to revoke credential:", err);
      toast.error(err instanceof Error ? err.message : t("agentsPage.revokeFailed"));
    } finally {
      setIsRevokingCredential(false);
    }
  };

  const handleDeleteAgent = useCallback(async (agent: AgentCredentialRecord) => {
    if (!userAddress) {
      return;
    }

    try {
      setIsDeletingAgent(true);
      await deleteAgentCredential(userAddress, agent.id);
      if (selectedAgentId === agent.id) {
        setSelectedAgentId(null);
      }
      setPendingDeleteAgent(null);
      setDeleteConfirmationName("");
      toast.success(t("agentsPage.workspaceDeleteAgentDeletedToast"));
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to delete agent:", err);
      toast.error(err instanceof Error ? err.message : t("agentsPage.workspaceDeleteAgentDeletedFailed"));
    } finally {
      setIsDeletingAgent(false);
    }
  }, [fetchCredentials, selectedAgentId, t, userAddress]);

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

      const result = await rotateAgentCredential(boundOwner, agent.id);

      setNewCredential(result);
      setSandboxCredential(result.token);
      setSelectedAgentId(agent.id);
      toast.success(t("agentsPage.workspaceCredentialRegeneratedToast"));
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to regenerate credential:", err);
      toast.error(err instanceof Error ? err.message : t("agentsPage.workspaceCredentialRegeneratedFailed"));
    } finally {
      setIsRegeneratingCredential(false);
    }
  }, [ensureOwnerReady, fetchCredentials, t]);

  const handleGenerateCredential = useCallback(async (agent: AgentCredentialRecord) => {
    const boundOwner = await ensureOwnerReady();
    if (!boundOwner) {
      return;
    }

    try {
      setIsRegeneratingCredential(true);
      setError(null);

      const result = await rotateAgentCredential(boundOwner, agent.id);

      setNewCredential(result);
      setSandboxCredential(result.token);
      setSelectedAgentId(agent.id);
      toast.success(t("agentsPage.workspaceCredentialGeneratedToast"));
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to generate credential:", err);
      toast.error(err instanceof Error ? err.message : t("agentsPage.workspaceCredentialGeneratedFailed"));
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
      <header className="x-divider mx-auto w-full border-b pb-7 xl:max-w-[1318px]">
        <section>
          <h1 className="x-page-title flex items-center gap-2 text-white">
            <Bot className="h-6 w-6 text-blue-400" />
            {t("agentsPage.workspaceSimpleTitle")}
          </h1>
          <p className="x-page-subtitle mt-3 max-w-3xl">{t("agentsPage.workspaceSimpleDescription")}</p>
        </section>
      </header>

      <section className="mx-auto grid w-full grid-cols-1 gap-4 xl:max-w-[1318px] xl:justify-center xl:grid-cols-[35.5rem_45rem]">
        <article className="x-panel-flat rounded-[24px] p-5">
          <header className="x-divider mb-4 flex flex-col gap-4 border-b pb-4">
            <div>
              <h2 className="x-section-title mt-1 text-white">{t("agentsPage.workspaceYourAgentsTitle")}</h2>
              <p className="x-body-copy mt-3">{t("agentsPage.workspaceYourAgentsDescription")}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  void handleOpenCreateModal();
                }}
                className="x-button-primary x-action-label inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold"
              >
                <Plus className="h-4 w-4" />
                {t("agentsPage.workspaceCreateAgentCompact")}
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsManageMode((current) => !current);
                  }}
                  className={[
                    "x-action-label inline-flex items-center gap-2 rounded-full px-4 py-2.5 font-medium transition",
                    isManageMode
                      ? "text-white shadow-[inset_0_0_0_1px_rgba(96,165,250,0.85),0_0_0_1px_rgba(37,99,235,0.16)] bg-[rgba(29,155,240,0.08)]"
                      : "x-button-ghost disabled:opacity-50",
                  ].join(" ")}
                >
                  {isManageMode ? <Check className="h-4 w-4" /> : null}
                  {isManageMode ? t("agentsPage.workspaceDoneManaging") : t("agentsPage.workspaceManageAgents")}
                </button>
              </div>
            </div>

          </header>

          <div className="space-y-2.5 xl:max-w-[530px]">
            {isLoading && credentials.length === 0 ? (
              [1, 2, 3].map((index) => (
                <div key={index} className="x-panel-muted h-[128px] animate-pulse rounded-[20px]" />
              ))
            ) : visibleCredentials.length === 0 ? (
              <section className="x-panel-muted flex min-h-[420px] flex-col items-center justify-center space-y-4 rounded-[24px] p-8 text-center">
                <span className="x-panel-muted rounded-full p-4" aria-hidden="true">
                  <Bot className="h-10 w-10 text-gray-600" />
                </span>
                <header>
                  <h3 className="x-card-title text-white">{t("agentsPage.workspaceNoMatchingAgents")}</h3>
                  <p className="x-body-copy mx-auto mt-2 max-w-md">{t("agentsPage.workspaceNoMatchingAgentsDescription")}</p>
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
                      "x-list-card block w-full p-4 text-left transition-all",
                      isSelected
                        ? "x-tile-active"
                        : "x-tile-flat x-tile-flat-hover",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className={`rounded-[16px] p-2.5 ${agent.status === "active" ? "x-icon-chip" : "x-panel-muted"}`} aria-hidden="true">
                          <Bot className={`h-5 w-5 ${agent.status === "active" ? "text-blue-400" : "text-gray-500"}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="x-card-title truncate text-white">{agent.name || t("agentsPage.unnamedAgent")}</h3>
                          <p className="x-body-copy mt-1.5 max-w-[24rem] pr-2">{t("agentsPage.workspaceAgentCardDescription")}</p>
                          <div className="mt-4 flex flex-wrap items-center gap-2.5">
                            <span className={`x-status-inline ${statusClasses}`}>
                              {agent.status === "active" ? t("agentsPage.workspaceFilterActive") : t("agentsPage.workspaceToneRevoked")}
                            </span>
                            <span className="x-data-label font-mono text-gray-500">{agent.tokenPrefix || agent.id.slice(0, 12)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="x-agent-rail flex flex-col items-end justify-between gap-4">
                        <span className="x-agent-usage">{usagePercent}%</span>
                        {isManageMode ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPendingDeleteAgent(agent);
                              setDeleteConfirmationName("");
                            }}
                            className="x-manage-delete"
                            aria-label={t("agentsPage.workspaceDeleteAgentLabel")}
                            title={t("agentsPage.workspaceDeleteAgentLabel")}
                          >
                            <MinusCircle className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="x-panel-flat rounded-[24px] xl:w-[720px]">
          {!selectedAgent ? (
            <section className="flex flex-col items-center justify-center px-8 py-20 text-center">
              <span className="x-icon-chip rounded-[22px] p-5" aria-hidden="true">
                <Bot className="h-10 w-10 text-blue-300" />
              </span>
              <h2 className="x-section-title mt-6 text-white">{t("agentsPage.workspaceDetailEmptyTitle")}</h2>
              <p className="x-body-copy mt-4 max-w-md">{t("agentsPage.workspaceDetailEmptyDescription")}</p>
            </section>
          ) : (
            <div className="flex flex-col">
              <header className="x-divider flex items-start justify-between gap-4 border-b px-6 py-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="x-detail-title text-white">{selectedAgent.name || t("agentsPage.unnamedAgent")}</h2>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(selectedAgent.id, `agent-id-${selectedAgent.id}`)}
                      className="x-icon-button rounded-lg p-2"
                      title={t("agentsPage.workspaceCopyAgentId")}
                    >
                      {copiedId === `agent-id-${selectedAgent.id}` ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="x-body-copy mt-4 max-w-2xl">{t("agentsPage.workspaceDetailDescription")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(null)}
                  className="x-icon-button rounded-lg p-2"
                  aria-label={t("agentsPage.workspaceCloseDetail")}
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </header>

              <section className="space-y-5 px-6 py-6">
                <section>
                  <h3 className="x-section-title text-white">{t("agentsPage.workspaceCredentialPanelTitle")}</h3>
                  <p className="x-body-copy mt-2">{t("agentsPage.workspaceCredentialPanelDescription")}</p>
                </section>

                <section className="space-y-4">
                  <article className="x-panel-muted rounded-[20px] p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="x-meta-label">{t("agentsPage.workspaceCredentialPrefixLabel")}</p>
                        <p className="x-metric-value mt-2 font-mono text-white">{selectedAgent.tokenPrefix || selectedAgent.id.slice(0, 18)}</p>
                      </div>
                      {selectedAgent.status === "active" ? (
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => setPendingDangerAction({ type: "revoke", agent: selectedAgent })}
                            disabled={isRevokingCredential}
                            className="x-button-danger x-credential-action x-credential-action-danger disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t("agentsPage.workspaceRevokeShort")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDangerAction({ type: "regenerate", agent: selectedAgent })}
                            disabled={isRegeneratingCredential}
                            className="x-button-primary x-credential-action x-credential-action-primary disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRegeneratingCredential ? t("agentsPage.workspaceRegenerating") : t("agentsPage.workspaceRegenerateShort")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDangerAction({ type: "generate", agent: selectedAgent })}
                          disabled={isRegeneratingCredential}
                          className="x-button-primary x-credential-action x-credential-action-generate disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRegeneratingCredential ? t("agentsPage.workspaceGenerating") : t("agentsPage.workspaceGenerateCredential")}
                        </button>
                      )}
                    </div>
                  </article>

                  <article className="x-panel-muted rounded-[20px] p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="x-meta-label">{t("agentsPage.workspaceQuotaPanelTitle")}</p>
                        <p className="x-body-copy mt-2 max-w-[40rem]">{t("agentsPage.workspaceQuotaPanelDescription")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditModal(selectedAgent)}
                        disabled={selectedAgent.status !== "active"}
                        className="x-button-ghost x-action-label inline-flex items-center gap-2 rounded-full px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <PencilLine className="h-4 w-4" />
                        {t("agentsPage.workspaceEdit")}
                      </button>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="x-tile-flat rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceBudgetTile")}</p>
                        <p className="x-metric-value mt-3 text-emerald-400">{formatAgentBudget(selectedAgent.creditLimit)}</p>
                      </div>
                      <div className="x-tile-flat rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceUsageTile")}</p>
                        <p className="x-metric-value mt-3 text-white">{selectedAgent.callsUsed} / {selectedAgent.maxCalls || "∞"}</p>
                      </div>
                      <div className="x-tile-flat rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceRateLimitTile")}</p>
                        <p className="x-metric-value mt-3 text-white">{selectedAgent.rpm > 0 ? `${selectedAgent.rpm}/min` : t("agentsPage.workspaceUnlimited")}</p>
                      </div>
                      <div className="x-tile-flat rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceRemainingCallsTile")}</p>
                        <p className="x-metric-value mt-3 text-white">{selectedAgentRemainingCalls}</p>
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="x-data-label flex items-center justify-between text-gray-400">
                        <span>{t("agentsPage.workspaceUsageBarLabel")}</span>
                        <span>{selectedAgentUsagePercent}%</span>
                      </div>
                      <div className="x-progress-track mt-3 h-2 overflow-hidden rounded-full">
                        <div className="x-progress-fill h-full rounded-full" style={{ width: `${selectedAgentUsagePercent}%` }} />
                      </div>
                    </div>
                  </article>
                </section>
              </section>
            </div>
          )}
        </article>
      </section>
    </>
  );

  return (
    <main className="x-workspace-shell mx-auto max-w-[1318px] space-y-8 px-6 py-7 transition duration-200 lg:px-8">
      {error && (
        <aside role="alert" className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle className="h-5 w-5" />
          {error}
        </aside>
      )}

      {isGuideMode ? guideContent : workspaceContent}

      {isCreateModalOpen && (
        <ModalLayer ariaLabelledby="create-agent-title">
          <section className="x-modal-flat x-modal-surface max-w-[560px]">
            <header className="x-modal-header x-divider">
              <h2 id="create-agent-title" className="x-modal-title flex items-center gap-2 text-white">
                <Plus className="h-5 w-5 text-blue-400" />
                {t("agentsPage.createAgentProfile")}
              </h2>
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="x-modal-close">
                <XCircle className="h-5 w-5" />
              </button>
            </header>
            <form onSubmit={handleCreateCredential} className="x-modal-body space-y-6">
              <label htmlFor="agent-name" className="block space-y-2.5 text-left">
                <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.agentNameLabel")}</span>
                <input
                  id="agent-name"
                  type="text"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  placeholder={t("agentsPage.agentNamePlaceholder")}
                  className="x-input-flat w-full rounded-2xl px-4 py-3.5 text-base text-white placeholder:text-gray-500"
                  required
                />
              </label>
              <label htmlFor="bound-owner" className="block space-y-2.5 text-left">
                <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.boundOwnerLabel")}</span>
                <input
                  id="bound-owner"
                  type="text"
                  readOnly
                  value={ownerAddress || t("agentsPage.walletSessionRequired")}
                  className="x-input-flat w-full rounded-2xl px-4 py-3.5 text-sm font-mono text-blue-300"
                />
              </label>
              <section className="grid grid-cols-2 gap-4">
                <label htmlFor="daily-budget" className="block space-y-2.5 text-left">
                  <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.dailyBudgetLabel")}</span>
                  <input
                    id="daily-budget"
                    type="number"
                    step="0.01"
                    value={dailyBudget}
                    onChange={(event) => setDailyBudget(event.target.value)}
                    className="x-input-flat w-full rounded-2xl px-4 py-3.5 text-base text-white"
                    required
                  />
                </label>
                <label htmlFor="max-calls" className="block space-y-2.5 text-left">
                  <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.maxCallsLabel")}</span>
                  <input
                    id="max-calls"
                    type="number"
                    value={maxCalls}
                    onChange={(event) => setMaxCalls(event.target.value)}
                    className="x-input-flat w-full rounded-2xl px-4 py-3.5 text-base text-white"
                    required
                  />
                </label>
              </section>
              <aside className="x-panel-muted flex items-start gap-3 rounded-[24px] p-4 shadow-[inset_0_0_0_1px_rgba(29,155,240,0.14)]">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-400" />
                <p className="x-overline-label leading-relaxed text-gray-400">
                  {t("agentsPage.createAgentHint")}
                </p>
              </aside>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="x-button-ghost x-modal-action x-modal-action-secondary"
                >
                  {t("agentsPage.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="x-button-primary x-modal-action x-modal-action-primary disabled:opacity-50"
                >
                  {isLoading ? t("agentsPage.creating") : t("agentsPage.createAgentProfile")}
                </button>
              </div>
            </form>
          </section>
        </ModalLayer>
      )}

      {pendingDangerAction && (
        <ModalLayer ariaLabelledby="danger-agent-title">
          <section className="x-modal-flat x-modal-surface max-w-[560px]">
            <header className="x-modal-header x-divider">
              <div className="x-modal-header-copy">
                <h2 id="danger-agent-title" className="x-modal-title text-white">
                  {pendingDangerAction.type === "generate"
                    ? t("agentsPage.workspaceDangerGenerateTitle")
                    : pendingDangerAction.type === "regenerate"
                    ? t("agentsPage.workspaceDangerRegenerateTitle")
                    : t("agentsPage.workspaceDangerRevokeTitle")}
                </h2>
                <p className="x-body-copy mt-3 text-gray-400">
                  {pendingDangerAction.type === "generate"
                    ? t("agentsPage.workspaceDangerGenerateQuestion")
                    : pendingDangerAction.type === "regenerate"
                    ? t("agentsPage.workspaceDangerRegenerateQuestion")
                    : t("agentsPage.workspaceDangerRevokeQuestion")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDangerAction(null)}
                className="x-modal-close"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </header>

            <section className="x-modal-body space-y-6">
              <article className="x-panel-muted rounded-[24px] p-5">
                <h3 className="x-card-title text-white">{pendingDangerAction.agent.name || t("agentsPage.unnamedAgent")}</h3>
                <p className="x-data-label mt-2 font-mono text-gray-400">{pendingDangerAction.agent.tokenPrefix || pendingDangerAction.agent.id}</p>
              </article>

              <p className="x-body-copy max-w-xl leading-8 text-gray-400">
                {pendingDangerAction.type === "generate"
                  ? t("agentsPage.workspaceDangerGenerateDescription")
                  : pendingDangerAction.type === "regenerate"
                  ? t("agentsPage.workspaceDangerRegenerateDescription")
                  : t("agentsPage.workspaceDangerRevokeDescription")}
              </p>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDangerAction(null)}
                  className="x-button-ghost x-modal-action x-modal-action-secondary"
                >
                  {t("agentsPage.cancel")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const action = pendingDangerAction;
                    setPendingDangerAction(null);
                    if (!action) {
                      return;
                    }
                    if (action.type === "generate") {
                      await handleGenerateCredential(action.agent);
                      return;
                    }
                    if (action.type === "regenerate") {
                      await handleRegenerateCredential(action.agent);
                      return;
                    }
                    await handleRevoke(action.agent.id);
                  }}
                  className={[
                    pendingDangerAction.type === "revoke" ? "x-button-danger" : "x-button-primary",
                    "x-modal-action",
                    "x-modal-action-primary",
                  ].join(" ")}
                >
                  {pendingDangerAction.type === "generate"
                    ? t("agentsPage.workspaceDangerConfirmGenerate")
                    : pendingDangerAction.type === "regenerate"
                    ? t("agentsPage.workspaceDangerConfirmRegenerate")
                    : t("agentsPage.workspaceDangerConfirmRevoke")}
                </button>
              </div>
            </section>
          </section>
        </ModalLayer>
      )}

      {pendingDeleteAgent && (
        <ModalLayer ariaLabelledby="delete-agent-title">
          <section className="x-modal-flat x-modal-surface max-w-[560px]">
            <header className="x-modal-header x-divider">
              <div className="x-modal-header-copy">
                <h2 id="delete-agent-title" className="x-modal-title text-white">
                  {t("agentsPage.workspaceDeleteAgentTitle")}
                </h2>
                <p className="x-body-copy mt-3 text-gray-400">
                  {t("agentsPage.workspaceDeleteAgentDescription", {
                    name: pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteAgent(null);
                  setDeleteConfirmationName("");
                }}
                className="x-modal-close"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </header>

            <section className="x-modal-body space-y-6">
              <div className="space-y-3">
                <p className="x-body-copy text-gray-400">
                  {t("agentsPage.workspaceDeleteAgentConfirmInstruction", {
                    name: pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                </p>
                <input
                  type="text"
                  value={deleteConfirmationName}
                  onChange={(event) => setDeleteConfirmationName(event.target.value)}
                  placeholder={t("agentsPage.workspaceDeleteAgentPlaceholder", {
                    name: pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                  className="x-input-flat w-full rounded-2xl px-4 py-3.5 text-base text-white placeholder:text-gray-500"
                />
                <p className="x-meta-label text-gray-500">
                  {t("agentsPage.workspaceDeleteAgentTypingMismatch")}
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingDeleteAgent(null);
                    setDeleteConfirmationName("");
                  }}
                  className="x-button-ghost x-modal-action x-modal-action-secondary"
                >
                  {t("agentsPage.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteAgent(pendingDeleteAgent)}
                  disabled={isDeletingAgent || deleteConfirmationName !== (pendingDeleteAgent.name || t("agentsPage.unnamedAgent"))}
                  className="x-button-danger x-modal-action x-modal-action-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeletingAgent ? t("agentsPage.workspaceManaging") : t("agentsPage.workspaceDeleteAgentConfirm")}
                </button>
              </div>
            </section>
          </section>
        </ModalLayer>
      )}

      {issuedCredential && (
        <ModalLayer ariaLabelledby="issued-agent-title">
          <section className="x-modal-flat x-modal-surface max-w-lg border border-emerald-500/15 shadow-[0_0_70px_rgba(16,185,129,0.08)]">
            <header className="x-modal-header border-b border-emerald-500/10">
              <div className="x-modal-header-copy">
                <h2 id="issued-agent-title" className="x-modal-title text-white">{t("agentsPage.credentialIssuedTitle")}</h2>
                <p className="x-body-copy mt-2 text-gray-500">{t("agentsPage.credentialIssuedDescription")}</p>
              </div>
              <button type="button" onClick={() => setNewCredential(null)} className="x-modal-close">
                <XCircle className="h-5 w-5" />
              </button>
            </header>
            <section className="x-modal-body space-y-6 text-center">
              <span className="mx-auto block w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-[0_10px_30px_rgba(16,185,129,0.1)]" aria-hidden="true">
                <ShieldCheck className="h-10 w-10 text-emerald-400" />
              </span>

              <section className="group relative">
                <code className="x-panel-muted block break-all rounded-[24px] p-4 pr-12 text-left font-mono text-sm text-emerald-400">
                  {issuedCredential.token}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(issuedCredential.token, "new-token")}
                  className="x-icon-button absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2.5 text-gray-400"
                >
                  {copiedId === "new-token" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </section>

              <dl className="grid grid-cols-2 gap-4 text-left">
                <div className="x-panel-muted rounded-[22px] p-4">
                  <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.agentNameLabel")}</dt>
                  <dd className="text-sm font-bold text-white">{issuedCredential.name}</dd>
                </div>
                <div className="x-panel-muted rounded-[22px] p-4">
                  <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</dt>
                  <dd className="text-sm font-bold text-emerald-400">${(issuedCredential.creditLimit ?? 0).toFixed(2)}</dd>
                </div>
              </dl>

              <dl className="x-panel-muted rounded-[22px] p-4 text-left">
                <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.boundOwnerValueLabel")}</dt>
                <dd className="break-all font-mono text-sm text-blue-300">{issuedCredential.ownerAddress}</dd>
              </dl>

              <button
                type="button"
                onClick={() => setNewCredential(null)}
                className="x-button-primary x-modal-action w-full"
              >
                {t("agentsPage.savedTokenCta")}
              </button>
            </section>
          </section>
        </ModalLayer>
      )}

      {isEditModalOpen && (
        <ModalLayer ariaLabelledby="edit-agent-title">
          <section className="x-modal-flat x-modal-surface max-w-md">
            <header className="x-modal-header x-divider">
              <h2 id="edit-agent-title" className="x-modal-title flex items-center gap-2 text-white">
                <PencilLine className="h-5 w-5 text-blue-400" />
                {t("agentsPage.editAgentLimitsTitle")}
              </h2>
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="x-modal-close">
                <XCircle className="h-5 w-5" />
              </button>
            </header>
            <section className="x-modal-body space-y-5">
              <p className="x-body-copy leading-6 text-gray-400">{t("agentsPage.editAgentLimitsDescription")}</p>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.maxCallsLabel")}</span>
                <input
                  type="number"
                  value={quotaMaxCalls}
                  onChange={(event) => setQuotaMaxCalls(event.target.value)}
                  className="x-input-flat w-full rounded-xl px-4 py-3 text-sm text-white"
                />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.rateLimitLabel")}</span>
                <input
                  type="number"
                  value={quotaRpm}
                  onChange={(event) => setQuotaRpm(event.target.value)}
                  className="x-input-flat w-full rounded-xl px-4 py-3 text-sm text-white"
                />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quotaDailyBudget}
                  onChange={(event) => setQuotaDailyBudget(event.target.value)}
                  className="x-input-flat w-full rounded-xl px-4 py-3 text-sm text-white"
                />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.expirationLabel")}</span>
                <input
                  type="datetime-local"
                  value={quotaExpiresAtLocal}
                  onChange={(event) => setQuotaExpiresAtLocal(event.target.value)}
                  className="x-input-flat w-full rounded-xl px-4 py-3 text-sm text-white"
                />
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="x-button-ghost x-modal-action x-modal-action-secondary">{t("agentsPage.cancel")}</button>
                <button type="button" onClick={() => void handleUpdateQuota()} className="x-button-primary x-modal-action x-modal-action-primary">{t("agentsPage.save")}</button>
              </div>
            </section>
          </section>
        </ModalLayer>
      )}
    </main>
  );
}

type ModalLayerProps = {
  ariaLabelledby: string;
  children: React.ReactNode;
};

function ModalLayer({ ariaLabelledby, children }: Readonly<ModalLayerProps>) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="x-dialog-shell x-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledby}
    >
      {children}
    </div>,
    document.body,
  );
}

function XCircle({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
