"use client";

import dynamic from "next/dynamic";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AlertCircle, Bot } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { useAuth } from "@/components/WalletAuthGuard";
import { getAgentUsagePercent } from "@/components/dashboard/agents/agentWorkspacePresenters";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import AgentsWorkspaceListPane from "@/components/dashboard-workspace/agents/AgentsWorkspaceListPane";
import type { PendingDangerAction } from "@/components/dashboard-workspace/agents/agentsWorkspace.types";
import { XPanel } from "@/components/xui/XPanel";
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
import { clearAuthSession, WALLET_SESSION_MISSING_MESSAGE } from "@/utils/authSession";

const AgentsWorkspaceDialogs = dynamic(
  () => import("@/components/dashboard-workspace/agents/AgentsWorkspaceDialogs"),
  { ssr: false }
);

const LazyAgentsWorkspaceDetailPane = dynamic(
  () => import("@/components/dashboard-workspace/agents/AgentsWorkspaceDetailPane"),
  {
    ssr: false,
    loading: () => (
      <XPanel as="article" variant="flat" className="min-w-0 rounded-[24px] xl:h-[560px] xl:w-[720px] animate-pulse" />
    ),
  }
);

export default function DashboardAgentsWorkspacePage() {
  const workspaceFrameClass = "w-full max-w-[1288px]";
  const { address: userAddress, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { t } = useLanguage();
  const { openConnectModal } = useConnectModal();

  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await listAgentCredentials(userAddress);
      setCredentials(data);
    } catch (fetchError) {
      console.error("Failed to fetch credentials:", fetchError);
      const message = fetchError instanceof Error ? fetchError.message : t("agentsPage.loadCredentialsFailed");
      if (message === WALLET_SESSION_MISSING_MESSAGE) {
        clearAuthSession();
      }
      setCredentials([]);
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, [isSessionAuthenticated, t, userAddress]);

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

  const handleCreateCredential = async (event: FormEvent) => {
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
      setIsCreateModalOpen(false);
      setAgentName("");
      setDailyBudget("10.00");
      setMaxCalls("1000");
      toast.success(t("agentsPage.agentCreatedToast", { owner: `${boundOwner.slice(0, 6)}...${boundOwner.slice(-4)}` }));
      await fetchCredentials();
    } catch (createError) {
      console.error("Failed to create credential:", createError);
      setError(t("agentsPage.createAgentFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = useCallback(async (id: string) => {
    if (!userAddress) {
      return;
    }

    try {
      setIsRevokingCredential(true);
      await revokeAgentCredential(userAddress, id);
      await fetchCredentials();
    } catch (revokeError) {
      console.error("Failed to revoke credential:", revokeError);
      toast.error(revokeError instanceof Error ? revokeError.message : t("agentsPage.revokeFailed"));
    } finally {
      setIsRevokingCredential(false);
    }
  }, [fetchCredentials, t, userAddress]);

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
    } catch (deleteError) {
      console.error("Failed to delete agent:", deleteError);
      toast.error(deleteError instanceof Error ? deleteError.message : t("agentsPage.workspaceDeleteAgentDeletedFailed"));
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
    } catch (quotaError) {
      console.error("Failed to update agent quota:", quotaError);
      toast.error(quotaError instanceof Error ? quotaError.message : t("agentsPage.updateAgentLimitsFailed"));
    }
  };

  const visibleCredentials = useMemo(() => credentials, [credentials]);
  const selectedAgent = useMemo(() => {
    if (!selectedAgentId || visibleCredentials.length === 0) {
      return null;
    }
    return visibleCredentials.find((agent) => agent.id === selectedAgentId) ?? null;
  }, [selectedAgentId, visibleCredentials]);

  useEffect(() => {
    if (visibleCredentials.length === 0) {
      if (selectedAgentId !== null) {
        setSelectedAgentId(null);
      }
      return;
    }

    if (selectedAgentId && !visibleCredentials.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null);
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
      setSelectedAgentId(agent.id);
      toast.success(t("agentsPage.workspaceCredentialRegeneratedToast"));
      await fetchCredentials();
    } catch (regenerateError) {
      console.error("Failed to regenerate credential:", regenerateError);
      toast.error(regenerateError instanceof Error ? regenerateError.message : t("agentsPage.workspaceCredentialRegeneratedFailed"));
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
      setSelectedAgentId(agent.id);
      toast.success(t("agentsPage.workspaceCredentialGeneratedToast"));
      await fetchCredentials();
    } catch (generateError) {
      console.error("Failed to generate credential:", generateError);
      toast.error(generateError instanceof Error ? generateError.message : t("agentsPage.workspaceCredentialGeneratedFailed"));
    } finally {
      setIsRegeneratingCredential(false);
    }
  }, [ensureOwnerReady, fetchCredentials, t]);

  const selectedAgentUsagePercent = selectedAgent ? getAgentUsagePercent(selectedAgent) : 0;
  const selectedAgentRemainingCalls = selectedAgent
    ? Math.max(0, (selectedAgent.maxCalls || 0) - selectedAgent.callsUsed)
    : 0;

  const handleConfirmDangerAction = useCallback(async () => {
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
  }, [handleGenerateCredential, handleRegenerateCredential, handleRevoke, pendingDangerAction]);

  const handleCloseDeleteAgent = useCallback(() => {
    setPendingDeleteAgent(null);
    setDeleteConfirmationName("");
  }, []);

  const handleConfirmDeleteAgent = useCallback(() => {
    if (!pendingDeleteAgent) {
      return;
    }
    void handleDeleteAgent(pendingDeleteAgent);
  }, [handleDeleteAgent, pendingDeleteAgent]);

  return (
    <main className="x-workspace-shell mx-auto w-full max-w-[1288px] space-y-8 px-6 py-8 transition duration-200 lg:px-8 xl:px-0">
      {error && (
        <aside role="alert" className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle className="h-5 w-5" />
          {error}
        </aside>
      )}

      <header className={`x-divider ${workspaceFrameClass} border-b pb-7`}>
        <section>
          <h1 className="x-page-title flex items-center gap-2 text-white">
            <Bot className="h-6 w-6 text-blue-400" />
            {t("agentsPage.workspaceSimpleTitle")}
          </h1>
          <p className="x-page-subtitle mt-3 max-w-3xl">{t("agentsPage.workspaceSimpleDescription")}</p>
        </section>
      </header>

      <section className={`grid ${workspaceFrameClass} grid-cols-1 items-start gap-5 xl:grid-cols-[536px_minmax(0,720px)] xl:gap-8`}>
        <AgentsWorkspaceListPane
          credentials={visibleCredentials}
          isLoading={isLoading}
          isManageMode={isManageMode}
          selectedAgentId={selectedAgentId}
          onOpenCreateModal={() => {
            void handleOpenCreateModal();
          }}
          onToggleManageMode={() => {
            setIsManageMode((current) => !current);
          }}
          onSelectAgent={setSelectedAgentId}
          onRequestDeleteAgent={(agent) => {
            setPendingDeleteAgent(agent);
            setDeleteConfirmationName("");
          }}
        />

        {selectedAgent ? (
          <LazyAgentsWorkspaceDetailPane
            selectedAgent={selectedAgent}
            copiedId={copiedId}
            isRevokingCredential={isRevokingCredential}
            isRegeneratingCredential={isRegeneratingCredential}
            selectedAgentRemainingCalls={selectedAgentRemainingCalls}
            selectedAgentUsagePercent={selectedAgentUsagePercent}
            onClose={() => setSelectedAgentId(null)}
            onCopyAgentId={() => copyToClipboard(selectedAgent.id, `agent-id-${selectedAgent.id}`)}
            onOpenEdit={openEditModal}
            onRequestDangerAction={(type, agent) => setPendingDangerAction({ type, agent })}
          />
        ) : (
          <XPanel as="article" variant="flat" className="min-w-0 rounded-[24px] xl:h-[560px] xl:w-[720px]">
            <section className="flex h-full min-h-[560px] flex-col items-center justify-center px-8 py-20 text-center">
              <span className="x-icon-chip rounded-[22px] p-5" aria-hidden="true">
                <Bot className="h-10 w-10 text-blue-300" />
              </span>
              <h2 className="x-section-title mt-6 text-white">{t("agentsPage.workspaceDetailEmptyTitle")}</h2>
              <p className="x-body-copy mt-4 max-w-md">{t("agentsPage.workspaceDetailEmptyDescription")}</p>
            </section>
          </XPanel>
        )}
      </section>

      {isAnyModalOpen ? (
        <AgentsWorkspaceDialogs
          isCreateModalOpen={isCreateModalOpen}
          ownerAddress={ownerAddress}
          isLoading={isLoading}
          agentName={agentName}
          dailyBudget={dailyBudget}
          maxCalls={maxCalls}
          onCloseCreateModal={() => setIsCreateModalOpen(false)}
          onCreateCredential={handleCreateCredential}
          onAgentNameChange={setAgentName}
          onDailyBudgetChange={setDailyBudget}
          onMaxCallsChange={setMaxCalls}
          pendingDangerAction={pendingDangerAction}
          onCloseDangerAction={() => setPendingDangerAction(null)}
          onConfirmDangerAction={handleConfirmDangerAction}
          pendingDeleteAgent={pendingDeleteAgent}
          deleteConfirmationName={deleteConfirmationName}
          isDeletingAgent={isDeletingAgent}
          onCloseDeleteAgent={handleCloseDeleteAgent}
          onDeleteConfirmationNameChange={setDeleteConfirmationName}
          onConfirmDeleteAgent={handleConfirmDeleteAgent}
          newCredential={newCredential}
          copiedId={copiedId}
          onCopyNewToken={() => copyToClipboard(newCredential?.token ?? "", "new-token")}
          onCloseIssuedCredential={() => setNewCredential(null)}
          isEditModalOpen={isEditModalOpen}
          quotaMaxCalls={quotaMaxCalls}
          quotaRpm={quotaRpm}
          quotaDailyBudget={quotaDailyBudget}
          quotaExpiresAtLocal={quotaExpiresAtLocal}
          onCloseEditModal={() => setIsEditModalOpen(false)}
          onQuotaMaxCallsChange={setQuotaMaxCalls}
          onQuotaRpmChange={setQuotaRpm}
          onQuotaDailyBudgetChange={setQuotaDailyBudget}
          onQuotaExpiresAtLocalChange={setQuotaExpiresAtLocal}
          onUpdateQuota={handleUpdateQuota}
        />
      ) : null}
    </main>
  );
}