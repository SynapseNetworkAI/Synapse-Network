"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  AlertCircle,
  Bot,
  Check,
  MinusCircle,
  PencilLine,
  Plus,
  ShieldCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  formatAgentBudget,
  getAgentUsagePercent,
} from "@/components/dashboard/agents/agentWorkspacePresenters";
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
import {
  clearAuthSession,
  WALLET_SESSION_MISSING_MESSAGE,
} from "@/utils/authSession";
import { invokePaidService } from "@/utils/invokePaidService";
import { payForServiceWithApproval } from "@/utils/payForService";
import {
  discoverServices,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import CopyableValue from "@/components/xui/CopyableValue";
import { XButton } from "@/components/xui/XButton";
import {
  XDialog,
  XDialogBody,
  XDialogCloseButton,
  XDialogFooter,
  XDialogHeader,
  XDialogHeaderCopy,
  XDialogSurface,
} from "@/components/xui/XDialog";
import { XInput } from "@/components/xui/XInput";
import { XPanel } from "@/components/xui/XPanel";
import { cx } from "@/components/xui/cx";
import type { FirstInvocationResult } from "@/components/dashboard/agents/FirstInvocationPanel";

const ActivationStatusStrip = dynamic(
  () => import("@/components/dashboard/agents/ActivationStatusStrip"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[112px] animate-pulse rounded-[28px] border border-white/[0.06] bg-white/[0.025]" />
    ),
  }
);
const ActivationRunway = dynamic(
  () => import("@/components/dashboard/agents/ActivationRunway"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] animate-pulse rounded-[28px] border border-white/[0.06] bg-white/[0.025]" />
    ),
  }
);
const FirstInvocationPanel = dynamic(
  () => import("@/components/dashboard/agents/FirstInvocationPanel"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] animate-pulse rounded-[28px] border border-white/[0.06] bg-white/[0.025]" />
    ),
  }
);

function scrollToSection(sectionId: string) {
  document
    .getElementById(sectionId)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const possibleKeys = [
    "request_id",
    "requestId",
    "trace_id",
    "traceId",
  ] as const;
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

export default function DashboardAgentsPage({
  mode = "guide",
}: Readonly<DashboardAgentsPageProps>) {
  const workspaceFrameClass = "w-full max-w-[1288px]";
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
  const [sandboxInvokeError, setSandboxInvokeError] = useState<string | null>(
    null
  );
  const [sandboxInvokeResult, setSandboxInvokeResult] =
    useState<FirstInvocationResult | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCredential, setNewCredential] =
    useState<AgentCredentialIssueResponse | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedCredentialId, setSelectedCredentialId] = useState<
    string | null
  >(null);
  const [quotaMaxCalls, setQuotaMaxCalls] = useState("1000");
  const [quotaRpm, setQuotaRpm] = useState("600");
  const [quotaDailyBudget, setQuotaDailyBudget] = useState("10.00");
  const [quotaExpiresAtLocal, setQuotaExpiresAtLocal] = useState("");
  const [isRegeneratingCredential, setIsRegeneratingCredential] =
    useState(false);
  const [isRevokingCredential, setIsRevokingCredential] = useState(false);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [pendingDangerAction, setPendingDangerAction] =
    useState<PendingDangerAction | null>(null);
  const [pendingDeleteAgent, setPendingDeleteAgent] =
    useState<AgentCredentialRecord | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");

  const [agentName, setAgentName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10.00");
  const [maxCalls, setMaxCalls] = useState("1000");
  const isGuideMode = mode === "guide";
  const ownerAddress = userAddress?.toLowerCase() ?? "";
  const isAnyModalOpen = Boolean(
    isCreateModalOpen ||
      pendingDangerAction ||
      pendingDeleteAgent ||
      newCredential ||
      isEditModalOpen
  );

  const fetchCredentials = useCallback(async () => {
    if (!userAddress || !isSessionAuthenticated) {
      setCredentials([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await listAgentCredentials(userAddress);
      setCredentials(data);
    } catch (err) {
      console.error("Failed to fetch credentials:", err);
      if (
        err instanceof Error &&
        err.message === WALLET_SESSION_MISSING_MESSAGE
      ) {
        clearAuthSession();
      }
      setCredentials([]);
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, [isSessionAuthenticated, userAddress]);

  const fetchServices = useCallback(async () => {
    try {
      setServiceError(null);
      setIsServicesLoading(true);
      const rows = await discoverServices("agent");
      const activeRows = rows.filter(
        (service) => service.isActive && Boolean(service.endpoint)
      );
      setServices(activeRows);
      setSelectedServiceId((current) => {
        if (
          current &&
          activeRows.some((service) => service.serviceId === current)
        ) {
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
    if (!isGuideMode) {
      setServices([]);
      setIsServicesLoading(false);
      setServiceError(null);
      return;
    }

    void fetchServices();
  }, [fetchServices, isGuideMode]);

  useEffect(() => {
    if (!isAnyModalOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

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
    const refreshTasks = [fetchCredentials(), handleOwnerRefresh()];
    if (isGuideMode) {
      refreshTasks.push(fetchServices());
    }
    await Promise.allSettled(refreshTasks);
    setIsRefreshing(false);
  }, [fetchCredentials, fetchServices, handleOwnerRefresh, isGuideMode]);

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
  }, [
    authorize,
    isConnected,
    isSessionAuthenticated,
    openConnectModal,
    t,
    userAddress,
  ]);

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
      toast.success(
        t("agentsPage.agentCreatedToast", {
          owner: `${boundOwner.slice(0, 6)}...${boundOwner.slice(-4)}`,
        })
      );
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
      toast.error(t("agentsPage.revokeFailed"));
    } finally {
      setIsRevokingCredential(false);
    }
  };

  const handleDeleteAgent = useCallback(
    async (agent: AgentCredentialRecord) => {
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
        toast.error(t("agentsPage.workspaceDeleteAgentDeletedFailed"));
      } finally {
        setIsDeletingAgent(false);
      }
    },
    [fetchCredentials, selectedAgentId, t, userAddress]
  );

  const openEditModal = (agent: AgentCredentialRecord) => {
    setSelectedCredentialId(agent.id);
    setQuotaMaxCalls(String(agent.maxCalls || 0));
    setQuotaRpm(String(agent.rpm || 0));
    setQuotaDailyBudget(String(agent.creditLimit ?? 0));
    if (agent.expiresAt) {
      setQuotaExpiresAtLocal(
        new Date(agent.expiresAt * 1000).toISOString().slice(0, 16)
      );
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
        creditLimit:
          Number.isFinite(parsedCreditLimit) && parsedCreditLimit > 0
            ? parsedCreditLimit
            : undefined,
        expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : 0,
      });
      toast.success(t("agentsPage.agentLimitsUpdated"));
      setIsEditModalOpen(false);
      await fetchCredentials();
    } catch (err) {
      console.error("Failed to update agent quota:", err);
      toast.error(t("agentsPage.updateAgentLimitsFailed"));
    }
  };

  const activeAgentsCount = credentials.filter(
    (credential) => credential.status === "active"
  ).length;
  const visibleCredentials = useMemo(() => credentials, [credentials]);
  const latestCredential = credentials[0] ?? null;
  const selectedAgent = useMemo(() => {
    if (!selectedAgentId || visibleCredentials.length === 0) {
      return null;
    }
    return (
      visibleCredentials.find((agent) => agent.id === selectedAgentId) ?? null
    );
  }, [selectedAgentId, visibleCredentials]);

  useEffect(() => {
    if (visibleCredentials.length === 0) {
      if (selectedAgentId !== null) {
        setSelectedAgentId(null);
      }
      return;
    }

    if (
      selectedAgentId &&
      !visibleCredentials.some((agent) => agent.id === selectedAgentId)
    ) {
      setSelectedAgentId(null);
    }
  }, [selectedAgentId, visibleCredentials]);

  const handleRegenerateCredential = useCallback(
    async (agent: AgentCredentialRecord) => {
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
        toast.error(t("agentsPage.workspaceCredentialRegeneratedFailed"));
      } finally {
        setIsRegeneratingCredential(false);
      }
    },
    [ensureOwnerReady, fetchCredentials, t]
  );

  const handleGenerateCredential = useCallback(
    async (agent: AgentCredentialRecord) => {
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
        toast.error(t("agentsPage.workspaceCredentialGeneratedFailed"));
      } finally {
        setIsRegeneratingCredential(false);
      }
    },
    [ensureOwnerReady, fetchCredentials, t]
  );

  const selectedAgentUsagePercent = selectedAgent
    ? getAgentUsagePercent(selectedAgent)
    : 0;
  const selectedAgentRemainingCalls = selectedAgent
    ? Math.max(0, (selectedAgent.maxCalls || 0) - selectedAgent.callsUsed)
    : 0;
  const latestSuccessfulInvocation = logs
    .filter(
      (log) =>
        (log.status === "accepted" || log.status === "succeeded") &&
        typeof log.created_at === "number"
    )
    .sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0))[0];
  const hasSuccessfulInvocation = Boolean(latestSuccessfulInvocation);
  const selectedService =
    services.find((service) => service.serviceId === selectedServiceId) ??
    services[0] ??
    null;

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
  }, [
    activeAgentsCount,
    authorize,
    handleOpenCreateModal,
    handleRefresh,
    hasSuccessfulInvocation,
    isConnected,
    isSessionAuthenticated,
    openConnectModal,
    stats.ownerBalance,
    t,
  ]);

  const handlePersistSandboxCredential = useCallback(() => {
    if (!selectedService || !sandboxCredential.trim()) {
      return;
    }
    setCredentialForService(
      selectedService.serviceId,
      sandboxCredential.trim()
    );
    toast.success(
      t("agentsPage.credentialSavedToast", { service: selectedService.name })
    );
  }, [sandboxCredential, selectedService, t]);

  const handleRunExample = useCallback(
    async (payloadText: string) => {
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

        const providerAddress =
          selectedService.ownerAddress || selectedService.address;
        if (!providerAddress) {
          throw new Error(t("agentsPage.selectedServiceMissingProvider"));
        }

        const startedAt = performance.now();
        const result = await invokePaidService({
          endpoint: selectedService.endpoint,
          serviceId: selectedService.serviceId,
          payload,
          credential,
          payForService: async () =>
            payForServiceWithApproval({
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
        setSandboxInvokeError(t("agentsPage.invocationFailed"));
      } finally {
        setIsSandboxInvoking(false);
      }
    },
    [
      fetchCredentials,
      handleOwnerRefresh,
      sandboxCredential,
      selectedService,
      t,
    ]
  );

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
      <header className={`x-divider ${workspaceFrameClass} border-b pb-7`}>
        <section>
          <h1 className="x-page-title flex items-center gap-2 text-white">
            <Bot className="h-6 w-6 text-blue-400" />
            {t("agentsPage.workspaceSimpleTitle")}
          </h1>
          <p className="x-page-subtitle mt-3 max-w-3xl">
            {t("agentsPage.workspaceSimpleDescription")}
          </p>
        </section>
      </header>

      <section
        className={`grid ${workspaceFrameClass} grid-cols-1 items-start gap-5 xl:grid-cols-[536px_minmax(0,720px)] xl:gap-8`}
      >
        <article className="min-w-0">
          <header className="x-divider mb-4 flex flex-col gap-4 border-b pb-4">
            <div>
              <h2 className="x-section-title mt-1 text-white">
                {t("agentsPage.workspaceYourAgentsTitle")}
              </h2>
              <p className="x-body-copy mt-3">
                {t("agentsPage.workspaceYourAgentsDescription")}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <XButton
                variant="primary"
                size="pill"
                onClick={() => {
                  void handleOpenCreateModal();
                }}
                className="px-5"
              >
                <Plus className="h-4 w-4" />
                {t("agentsPage.workspaceCreateAgentCompact")}
              </XButton>
              <div className="flex items-center gap-3">
                <XButton
                  variant="ghost"
                  size="pill"
                  onClick={() => {
                    setIsManageMode((current) => !current);
                  }}
                  className={cx(
                    "px-4 font-medium transition",
                    isManageMode
                      ? "text-white shadow-[inset_0_0_0_1px_rgba(96,165,250,0.85),0_0_0_1px_rgba(37,99,235,0.16)] bg-[rgba(29,155,240,0.08)]"
                      : ""
                  )}
                  aria-pressed={isManageMode}
                >
                  {isManageMode ? <Check className="h-4 w-4" /> : null}
                  {isManageMode
                    ? t("agentsPage.workspaceDoneManaging")
                    : t("agentsPage.workspaceManageAgents")}
                </XButton>
              </div>
            </div>
          </header>

          <div className="space-y-2.5">
            {isLoading && credentials.length === 0 ? (
              [1, 2, 3].map((index) => (
                <XPanel
                  key={index}
                  variant="muted"
                  className="h-[128px] animate-pulse rounded-[20px]"
                />
              ))
            ) : visibleCredentials.length === 0 ? (
              <XPanel
                as="section"
                variant="muted"
                className="flex min-h-[420px] flex-col items-center justify-center space-y-4 rounded-[24px] p-8 text-center"
              >
                <XPanel
                  variant="muted"
                  className="rounded-full p-4"
                  aria-hidden="true"
                >
                  <Bot className="h-10 w-10 text-gray-600" />
                </XPanel>
                <header>
                  <h3 className="x-card-title text-white">
                    {t("agentsPage.workspaceNoMatchingAgents")}
                  </h3>
                  <p className="x-body-copy mx-auto mt-2 max-w-md">
                    {t("agentsPage.workspaceNoMatchingAgentsDescription")}
                  </p>
                </header>
              </XPanel>
            ) : (
              visibleCredentials.map((agent) => {
                const isSelected = selectedAgent?.id === agent.id;
                const statusClasses =
                  agent.status === "active"
                    ? "bg-emerald-500/12 text-emerald-300"
                    : "bg-white/[0.06] text-gray-300";

                return (
                  <div
                    key={agent.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedAgentId(agent.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedAgentId(agent.id);
                      }
                    }}
                    className={cx(
                      "x-list-card block w-full cursor-pointer px-6 py-5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9bf0]/60 xl:w-[536px]",
                      isSelected
                        ? "x-tile-active"
                        : "x-tile-flat x-tile-flat-hover"
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={cx(
                          "mt-0.5 rounded-[18px] p-3",
                          agent.status === "active"
                            ? "x-icon-chip"
                            : "x-panel-muted"
                        )}
                        aria-hidden="true"
                      >
                        <Bot
                          className={`h-5 w-5 ${
                            agent.status === "active"
                              ? "text-blue-400"
                              : "text-gray-500"
                          }`}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="x-card-title truncate text-[17px] text-white">
                              {agent.name || t("agentsPage.unnamedAgent")}
                            </h3>
                            <p className="x-body-copy mt-2 max-w-[22rem] leading-7">
                              {t("agentsPage.workspaceAgentCardDescription")}
                            </p>
                          </div>
                          {isManageMode ? (
                            <XButton
                              variant="icon"
                              size="icon"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setPendingDeleteAgent(agent);
                                setDeleteConfirmationName("");
                              }}
                              className="x-manage-delete mt-0.5 rounded-full p-0"
                              aria-label={t(
                                "agentsPage.workspaceDeleteAgentLabel"
                              )}
                              title={t("agentsPage.workspaceDeleteAgentLabel")}
                            >
                              <MinusCircle className="h-4 w-4" />
                            </XButton>
                          ) : null}
                        </div>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                          <span className={`x-status-inline ${statusClasses}`}>
                            {agent.status === "active"
                              ? t("agentsPage.workspaceFilterActive")
                              : t("agentsPage.workspaceToneRevoked")}
                          </span>
                          <span className="x-data-label font-mono text-gray-500">
                            {agent.tokenPrefix || agent.id.slice(0, 12)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <XPanel
          as="article"
          variant="flat"
          className={cx(
            "min-w-0 rounded-[24px] xl:w-[720px]",
            !selectedAgent && "xl:h-[560px]"
          )}
        >
          {!selectedAgent ? (
            <section className="flex h-full min-h-[560px] flex-col items-center justify-center px-8 py-20 text-center">
              <span
                className="x-icon-chip rounded-[22px] p-5"
                aria-hidden="true"
              >
                <Bot className="h-10 w-10 text-blue-300" />
              </span>
              <h2 className="x-section-title mt-6 text-white">
                {t("agentsPage.workspaceDetailEmptyTitle")}
              </h2>
              <p className="x-body-copy mt-4 max-w-md">
                {t("agentsPage.workspaceDetailEmptyDescription")}
              </p>
            </section>
          ) : (
            <div className="flex flex-col">
              <header className="x-divider flex items-start justify-between gap-4 border-b px-6 py-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="x-detail-title text-white">
                      {selectedAgent.name || t("agentsPage.unnamedAgent")}
                    </h2>
                    <CopyableValue
                      value={selectedAgent.id}
                      displayValue=""
                      label={t("agentsPage.workspaceAgentIdLabel")}
                      className="gap-0"
                      valueClassName="sr-only"
                      buttonClassName="rounded-lg"
                    />
                  </div>
                  <p className="x-body-copy mt-4 max-w-2xl">
                    {t("agentsPage.workspaceDetailDescription")}
                  </p>
                </div>
                <XButton
                  variant="icon"
                  size="icon"
                  onClick={() => setSelectedAgentId(null)}
                  className="rounded-lg"
                  aria-label={t("agentsPage.workspaceCloseDetail")}
                >
                  <XCircle className="h-5 w-5" />
                </XButton>
              </header>

              <section className="space-y-5 px-6 py-6">
                <section>
                  <h3 className="x-section-title text-white">
                    {t("agentsPage.workspaceCredentialPanelTitle")}
                  </h3>
                  <p className="x-body-copy mt-2">
                    {t("agentsPage.workspaceCredentialPanelDescription")}
                  </p>
                </section>

                <section className="space-y-4">
                  <XPanel
                    as="article"
                    variant="muted"
                    className="rounded-[20px] p-5"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="x-meta-label">
                          {t("agentsPage.workspaceCredentialPrefixLabel")}
                        </p>
                        <p className="x-metric-value mt-2 font-mono text-white">
                          {selectedAgent.tokenPrefix ||
                            selectedAgent.id.slice(0, 18)}
                        </p>
                      </div>
                      {selectedAgent.status === "active" ? (
                        <div className="flex items-center gap-2.5">
                          <XButton
                            variant="danger"
                            size="credential"
                            onClick={() =>
                              setPendingDangerAction({
                                type: "revoke",
                                agent: selectedAgent,
                              })
                            }
                            disabled={isRevokingCredential}
                            className="x-credential-action-danger"
                          >
                            {t("agentsPage.workspaceRevokeShort")}
                          </XButton>
                          <XButton
                            variant="primary"
                            size="credential"
                            onClick={() =>
                              setPendingDangerAction({
                                type: "regenerate",
                                agent: selectedAgent,
                              })
                            }
                            disabled={isRegeneratingCredential}
                            className="x-credential-action-primary"
                          >
                            {isRegeneratingCredential
                              ? t("agentsPage.workspaceRegenerating")
                              : t("agentsPage.workspaceRegenerateShort")}
                          </XButton>
                        </div>
                      ) : (
                        <XButton
                          variant="primary"
                          size="credential"
                          onClick={() =>
                            setPendingDangerAction({
                              type: "generate",
                              agent: selectedAgent,
                            })
                          }
                          disabled={isRegeneratingCredential}
                          className="x-credential-action-generate"
                        >
                          {isRegeneratingCredential
                            ? t("agentsPage.workspaceGenerating")
                            : t("agentsPage.workspaceGenerateCredential")}
                        </XButton>
                      )}
                    </div>
                  </XPanel>

                  <XPanel
                    as="article"
                    variant="muted"
                    className="rounded-[20px] p-5"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="x-meta-label">
                          {t("agentsPage.workspaceQuotaPanelTitle")}
                        </p>
                        <p className="x-body-copy mt-2 max-w-[40rem]">
                          {t("agentsPage.workspaceQuotaPanelDescription")}
                        </p>
                      </div>
                      <XButton
                        variant="ghost"
                        size="pill"
                        onClick={() => openEditModal(selectedAgent)}
                        disabled={selectedAgent.status !== "active"}
                        className="px-4 py-2"
                      >
                        <PencilLine className="h-4 w-4" />
                        {t("agentsPage.workspaceEdit")}
                      </XButton>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <XPanel variant="tile" className="rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">
                          {t("agentsPage.workspaceBudgetTile")}
                        </p>
                        <p className="x-metric-value mt-3 text-emerald-400">
                          {formatAgentBudget(selectedAgent.creditLimit)}
                        </p>
                      </XPanel>
                      <XPanel variant="tile" className="rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">
                          {t("agentsPage.workspaceUsageTile")}
                        </p>
                        <p className="x-metric-value mt-3 text-white">
                          {selectedAgent.callsUsed} /{" "}
                          {selectedAgent.maxCalls || "∞"}
                        </p>
                      </XPanel>
                      <XPanel variant="tile" className="rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">
                          {t("agentsPage.workspaceRateLimitTile")}
                        </p>
                        <p className="x-metric-value mt-3 text-white">
                          {selectedAgent.rpm > 0
                            ? `${selectedAgent.rpm}/min`
                            : t("agentsPage.workspaceUnlimited")}
                        </p>
                      </XPanel>
                      <XPanel variant="tile" className="rounded-[18px] p-4">
                        <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">
                          {t("agentsPage.workspaceRemainingCallsTile")}
                        </p>
                        <p className="x-metric-value mt-3 text-white">
                          {selectedAgentRemainingCalls}
                        </p>
                      </XPanel>
                    </div>

                    <div className="mt-5">
                      <div className="x-data-label flex items-center justify-between text-gray-400">
                        <span>{t("agentsPage.workspaceUsageBarLabel")}</span>
                        <span>{selectedAgentUsagePercent}%</span>
                      </div>
                      <div className="x-progress-track mt-3 h-2 overflow-hidden rounded-full">
                        <div
                          className="x-progress-fill h-full rounded-full"
                          style={{ width: `${selectedAgentUsagePercent}%` }}
                        />
                      </div>
                    </div>
                  </XPanel>
                </section>
              </section>
            </div>
          )}
        </XPanel>
      </section>
    </>
  );

  return (
    <main className="x-workspace-shell mx-auto w-full max-w-[1288px] space-y-8 px-6 py-8 transition duration-200 lg:px-8 xl:px-0">
      {error && (
        <aside
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
        >
          <AlertCircle className="h-5 w-5" />
          {error}
        </aside>
      )}

      {isGuideMode ? guideContent : workspaceContent}

      {isCreateModalOpen && (
        <XDialog open={isCreateModalOpen} ariaLabelledby="create-agent-title">
          <XDialogSurface className="max-w-[560px]">
            <XDialogHeader>
              <h2
                id="create-agent-title"
                className="x-modal-title flex items-center gap-2 text-white"
              >
                <Plus className="h-5 w-5 text-blue-400" />
                {t("agentsPage.createAgentProfile")}
              </h2>
              <XDialogCloseButton onClick={() => setIsCreateModalOpen(false)} />
            </XDialogHeader>
            <form onSubmit={handleCreateCredential} className="space-y-6">
              <XDialogBody className="space-y-6">
                <label
                  htmlFor="agent-name"
                  className="block space-y-2.5 text-left"
                >
                  <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">
                    {t("agentsPage.agentNameLabel")}
                  </span>
                  <XInput
                    id="agent-name"
                    type="text"
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder={t("agentsPage.agentNamePlaceholder")}
                    required
                  />
                </label>
                <label
                  htmlFor="bound-owner"
                  className="block space-y-2.5 text-left"
                >
                  <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">
                    {t("agentsPage.boundOwnerLabel")}
                  </span>
                  <XInput
                    id="bound-owner"
                    type="text"
                    readOnly
                    value={
                      ownerAddress || t("agentsPage.walletSessionRequired")
                    }
                    className="text-sm font-mono text-blue-300"
                  />
                </label>
                <section className="grid grid-cols-2 gap-4">
                  <label
                    htmlFor="daily-budget"
                    className="block space-y-2.5 text-left"
                  >
                    <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">
                      {t("agentsPage.dailyBudgetLabel")}
                    </span>
                    <XInput
                      id="daily-budget"
                      type="number"
                      step="0.01"
                      value={dailyBudget}
                      onChange={(event) => setDailyBudget(event.target.value)}
                      required
                    />
                  </label>
                  <label
                    htmlFor="max-calls"
                    className="block space-y-2.5 text-left"
                  >
                    <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">
                      {t("agentsPage.maxCallsLabel")}
                    </span>
                    <XInput
                      id="max-calls"
                      type="number"
                      value={maxCalls}
                      onChange={(event) => setMaxCalls(event.target.value)}
                      required
                    />
                  </label>
                </section>
                <XPanel
                  as="aside"
                  variant="muted"
                  className="flex items-start gap-3 rounded-[24px] p-4 shadow-[inset_0_0_0_1px_rgba(29,155,240,0.14)]"
                >
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-400" />
                  <p className="x-overline-label leading-relaxed text-gray-400">
                    {t("agentsPage.createAgentHint")}
                  </p>
                </XPanel>
              </XDialogBody>
              <XDialogFooter className="justify-center border-t-0 pt-0">
                <XButton
                  variant="ghost"
                  size="modal"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  {t("agentsPage.cancel")}
                </XButton>
                <XButton
                  variant="primary"
                  size="modal"
                  type="submit"
                  disabled={isLoading}
                >
                  {isLoading
                    ? t("agentsPage.creating")
                    : t("agentsPage.createAgentProfile")}
                </XButton>
              </XDialogFooter>
            </form>
          </XDialogSurface>
        </XDialog>
      )}

      {pendingDangerAction && (
        <XDialog
          open={Boolean(pendingDangerAction)}
          ariaLabelledby="danger-agent-title"
        >
          <XDialogSurface className="max-w-[560px]">
            <XDialogHeader>
              <XDialogHeaderCopy>
                <h2
                  id="danger-agent-title"
                  className="x-modal-title text-white"
                >
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
              </XDialogHeaderCopy>
              <XDialogCloseButton
                onClick={() => setPendingDangerAction(null)}
              />
            </XDialogHeader>

            <XDialogBody className="space-y-6">
              <XPanel
                as="article"
                variant="muted"
                className="rounded-[24px] p-5"
              >
                <h3 className="x-card-title text-white">
                  {pendingDangerAction.agent.name ||
                    t("agentsPage.unnamedAgent")}
                </h3>
                <p className="x-data-label mt-2 font-mono text-gray-400">
                  {pendingDangerAction.agent.tokenPrefix ||
                    pendingDangerAction.agent.id}
                </p>
              </XPanel>

              <p className="x-body-copy max-w-xl leading-8 text-gray-400">
                {pendingDangerAction.type === "generate"
                  ? t("agentsPage.workspaceDangerGenerateDescription")
                  : pendingDangerAction.type === "regenerate"
                  ? t("agentsPage.workspaceDangerRegenerateDescription")
                  : t("agentsPage.workspaceDangerRevokeDescription")}
              </p>
            </XDialogBody>

            <XDialogFooter className="justify-center border-t-0 pt-0">
              <XButton
                variant="ghost"
                size="modal"
                onClick={() => setPendingDangerAction(null)}
              >
                {t("agentsPage.cancel")}
              </XButton>
              <XButton
                type="button"
                variant={
                  pendingDangerAction.type === "revoke" ? "danger" : "primary"
                }
                size="modal"
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
              >
                {pendingDangerAction.type === "generate"
                  ? t("agentsPage.workspaceDangerConfirmGenerate")
                  : pendingDangerAction.type === "regenerate"
                  ? t("agentsPage.workspaceDangerConfirmRegenerate")
                  : t("agentsPage.workspaceDangerConfirmRevoke")}
              </XButton>
            </XDialogFooter>
          </XDialogSurface>
        </XDialog>
      )}

      {pendingDeleteAgent && (
        <XDialog
          open={Boolean(pendingDeleteAgent)}
          ariaLabelledby="delete-agent-title"
        >
          <XDialogSurface className="max-w-[560px]">
            <XDialogHeader>
              <XDialogHeaderCopy>
                <h2
                  id="delete-agent-title"
                  className="x-modal-title text-white"
                >
                  {t("agentsPage.workspaceDeleteAgentTitle")}
                </h2>
                <p className="x-body-copy mt-3 text-gray-400">
                  {t("agentsPage.workspaceDeleteAgentDescription", {
                    name:
                      pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                </p>
              </XDialogHeaderCopy>
              <XDialogCloseButton
                onClick={() => {
                  setPendingDeleteAgent(null);
                  setDeleteConfirmationName("");
                }}
              />
            </XDialogHeader>

            <XDialogBody className="space-y-6">
              <div className="space-y-3">
                <p className="x-body-copy text-gray-400">
                  {t("agentsPage.workspaceDeleteAgentConfirmInstruction", {
                    name:
                      pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                </p>
                <XInput
                  type="text"
                  value={deleteConfirmationName}
                  onChange={(event) =>
                    setDeleteConfirmationName(event.target.value)
                  }
                  placeholder={t("agentsPage.workspaceDeleteAgentPlaceholder", {
                    name:
                      pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                />
                <p className="x-meta-label text-gray-500">
                  {t("agentsPage.workspaceDeleteAgentTypingMismatch")}
                </p>
              </div>
            </XDialogBody>

            <XDialogFooter className="border-t-0 pt-0">
              <XButton
                variant="ghost"
                size="modal"
                onClick={() => {
                  setPendingDeleteAgent(null);
                  setDeleteConfirmationName("");
                }}
              >
                {t("agentsPage.cancel")}
              </XButton>
              <XButton
                variant="danger"
                size="modal"
                onClick={() => void handleDeleteAgent(pendingDeleteAgent)}
                disabled={
                  isDeletingAgent ||
                  deleteConfirmationName !==
                    (pendingDeleteAgent.name || t("agentsPage.unnamedAgent"))
                }
              >
                {isDeletingAgent
                  ? t("agentsPage.workspaceManaging")
                  : t("agentsPage.workspaceDeleteAgentConfirm")}
              </XButton>
            </XDialogFooter>
          </XDialogSurface>
        </XDialog>
      )}

      {issuedCredential && (
        <XDialog
          open={Boolean(issuedCredential)}
          ariaLabelledby="issued-agent-title"
        >
          <XDialogSurface className="max-w-lg border border-emerald-500/15 shadow-[0_0_70px_rgba(16,185,129,0.08)]">
            <XDialogHeader className="border-b border-emerald-500/10">
              <XDialogHeaderCopy>
                <h2
                  id="issued-agent-title"
                  className="x-modal-title text-white"
                >
                  {t("agentsPage.credentialIssuedTitle")}
                </h2>
                <p className="x-body-copy mt-2 text-gray-500">
                  {t("agentsPage.credentialIssuedDescription")}
                </p>
              </XDialogHeaderCopy>
              <XDialogCloseButton onClick={() => setNewCredential(null)} />
            </XDialogHeader>
            <XDialogBody className="space-y-6 text-center">
              <span
                className="mx-auto block w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-[0_10px_30px_rgba(16,185,129,0.1)]"
                aria-hidden="true"
              >
                <ShieldCheck className="h-10 w-10 text-emerald-400" />
              </span>

              <section className="group relative">
                <code className="x-panel-muted block break-all rounded-[24px] p-4 pr-12 text-left font-mono text-sm text-emerald-400">
                  {issuedCredential.token}
                </code>
                <CopyableValue
                  value={issuedCredential.token}
                  displayValue=""
                  label={t("agentsPage.workspaceCredentialValueLabel")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 gap-0"
                  valueClassName="sr-only"
                  buttonClassName="rounded-xl p-2.5 text-gray-400"
                />
              </section>

              <dl className="grid grid-cols-2 gap-4 text-left">
                <XPanel variant="muted" className="rounded-[22px] p-4">
                  <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">
                    {t("agentsPage.agentNameLabel")}
                  </dt>
                  <dd className="text-sm font-bold text-white">
                    {issuedCredential.name}
                  </dd>
                </XPanel>
                <XPanel variant="muted" className="rounded-[22px] p-4">
                  <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">
                    {t("agentsPage.dailyBudgetLabel")}
                  </dt>
                  <dd className="text-sm font-bold text-emerald-400">
                    ${(issuedCredential.creditLimit ?? 0).toFixed(2)}
                  </dd>
                </XPanel>
              </dl>

              <dl className="x-panel-muted rounded-[22px] p-4 text-left">
                <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">
                  {t("agentsPage.boundOwnerValueLabel")}
                </dt>
                <dd>
                  <CopyableValue
                    value={issuedCredential.ownerAddress}
                    label={t("agentsPage.boundOwnerValueLabel")}
                    valueClassName="break-all font-mono text-sm text-blue-300"
                    startChars={10}
                    endChars={8}
                  />
                </dd>
              </dl>

              <XButton
                variant="primary"
                size="modal"
                onClick={() => setNewCredential(null)}
                fullWidth
              >
                {t("agentsPage.savedTokenCta")}
              </XButton>
            </XDialogBody>
          </XDialogSurface>
        </XDialog>
      )}

      {isEditModalOpen && (
        <XDialog open={isEditModalOpen} ariaLabelledby="edit-agent-title">
          <XDialogSurface className="max-w-md">
            <XDialogHeader>
              <h2
                id="edit-agent-title"
                className="x-modal-title flex items-center gap-2 text-white"
              >
                <PencilLine className="h-5 w-5 text-blue-400" />
                {t("agentsPage.editAgentLimitsTitle")}
              </h2>
              <XDialogCloseButton onClick={() => setIsEditModalOpen(false)} />
            </XDialogHeader>
            <XDialogBody className="space-y-5">
              <p className="x-body-copy leading-6 text-gray-400">
                {t("agentsPage.editAgentLimitsDescription")}
              </p>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">
                  {t("agentsPage.maxCallsLabel")}
                </span>
                <XInput
                  type="number"
                  value={quotaMaxCalls}
                  onChange={(event) => setQuotaMaxCalls(event.target.value)}
                  className="rounded-xl py-3 text-sm"
                />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">
                  {t("agentsPage.rateLimitLabel")}
                </span>
                <XInput
                  type="number"
                  value={quotaRpm}
                  onChange={(event) => setQuotaRpm(event.target.value)}
                  className="rounded-xl py-3 text-sm"
                />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">
                  {t("agentsPage.dailyBudgetLabel")}
                </span>
                <XInput
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quotaDailyBudget}
                  onChange={(event) => setQuotaDailyBudget(event.target.value)}
                  className="rounded-xl py-3 text-sm"
                />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">
                  {t("agentsPage.expirationLabel")}
                </span>
                <XInput
                  type="datetime-local"
                  value={quotaExpiresAtLocal}
                  onChange={(event) =>
                    setQuotaExpiresAtLocal(event.target.value)
                  }
                  className="rounded-xl py-3 text-sm"
                />
              </label>
            </XDialogBody>
            <XDialogFooter className="border-t-0 pt-0">
              <XButton
                variant="ghost"
                size="modal"
                onClick={() => setIsEditModalOpen(false)}
              >
                {t("agentsPage.cancel")}
              </XButton>
              <XButton
                variant="primary"
                size="modal"
                onClick={() => void handleUpdateQuota()}
              >
                {t("agentsPage.save")}
              </XButton>
            </XDialogFooter>
          </XDialogSurface>
        </XDialog>
      )}
    </main>
  );
}

function XCircle({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
