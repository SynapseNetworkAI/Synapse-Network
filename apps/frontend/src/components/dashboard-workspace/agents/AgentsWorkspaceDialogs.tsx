"use client";

import { type FormEvent } from "react";
import { Check, Copy, PencilLine, Plus, ShieldCheck } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  XDialog,
  XDialogBody,
  XDialogCloseButton,
  XDialogFooter,
  XDialogHeader,
  XDialogHeaderCopy,
  XDialogSurface,
} from "@/components/xui/XDialog";
import { XButton } from "@/components/xui/XButton";
import { XInput } from "@/components/xui/XInput";
import { XPanel } from "@/components/xui/XPanel";
import type {
  AgentCredentialIssueResponse,
  AgentCredentialRecord,
} from "@/utils/agentCredentialApi";
import type { PendingDangerAction } from "@/components/dashboard-workspace/agents/agentsWorkspace.types";

type AgentsWorkspaceDialogsProps = {
  isCreateModalOpen: boolean;
  ownerAddress: string;
  isLoading: boolean;
  agentName: string;
  dailyBudget: string;
  maxCalls: string;
  onCloseCreateModal: () => void;
  onCreateCredential: (event: FormEvent) => void;
  onAgentNameChange: (value: string) => void;
  onDailyBudgetChange: (value: string) => void;
  onMaxCallsChange: (value: string) => void;
  pendingDangerAction: PendingDangerAction | null;
  onCloseDangerAction: () => void;
  onConfirmDangerAction: () => Promise<void>;
  pendingDeleteAgent: AgentCredentialRecord | null;
  deleteConfirmationName: string;
  isDeletingAgent: boolean;
  onCloseDeleteAgent: () => void;
  onDeleteConfirmationNameChange: (value: string) => void;
  onConfirmDeleteAgent: () => void;
  newCredential: AgentCredentialIssueResponse | null;
  copiedId: string | null;
  onCopyNewToken: () => void;
  onCloseIssuedCredential: () => void;
  isEditModalOpen: boolean;
  quotaMaxCalls: string;
  quotaRpm: string;
  quotaDailyBudget: string;
  quotaExpiresAtLocal: string;
  onCloseEditModal: () => void;
  onQuotaMaxCallsChange: (value: string) => void;
  onQuotaRpmChange: (value: string) => void;
  onQuotaDailyBudgetChange: (value: string) => void;
  onQuotaExpiresAtLocalChange: (value: string) => void;
  onUpdateQuota: () => void;
};

export default function AgentsWorkspaceDialogs({
  isCreateModalOpen,
  ownerAddress,
  isLoading,
  agentName,
  dailyBudget,
  maxCalls,
  onCloseCreateModal,
  onCreateCredential,
  onAgentNameChange,
  onDailyBudgetChange,
  onMaxCallsChange,
  pendingDangerAction,
  onCloseDangerAction,
  onConfirmDangerAction,
  pendingDeleteAgent,
  deleteConfirmationName,
  isDeletingAgent,
  onCloseDeleteAgent,
  onDeleteConfirmationNameChange,
  onConfirmDeleteAgent,
  newCredential,
  copiedId,
  onCopyNewToken,
  onCloseIssuedCredential,
  isEditModalOpen,
  quotaMaxCalls,
  quotaRpm,
  quotaDailyBudget,
  quotaExpiresAtLocal,
  onCloseEditModal,
  onQuotaMaxCallsChange,
  onQuotaRpmChange,
  onQuotaDailyBudgetChange,
  onQuotaExpiresAtLocalChange,
  onUpdateQuota,
}: Readonly<AgentsWorkspaceDialogsProps>) {
  const { t } = useLanguage();

  return (
    <>
      {isCreateModalOpen ? (
        <XDialog open={isCreateModalOpen} ariaLabelledby="create-agent-title">
          <XDialogSurface className="max-w-[560px]">
            <XDialogHeader>
              <h2 id="create-agent-title" className="x-modal-title flex items-center gap-2 text-white">
                <Plus className="h-5 w-5 text-blue-400" />
                {t("agentsPage.createAgentProfile")}
              </h2>
              <XDialogCloseButton onClick={onCloseCreateModal} />
            </XDialogHeader>
            <form onSubmit={onCreateCredential} className="space-y-6">
              <XDialogBody className="space-y-6">
                <label htmlFor="agent-name" className="block space-y-2.5 text-left">
                  <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.agentNameLabel")}</span>
                  <XInput
                    id="agent-name"
                    type="text"
                    value={agentName}
                    onChange={(event) => onAgentNameChange(event.target.value)}
                    placeholder={t("agentsPage.agentNamePlaceholder")}
                    required
                  />
                </label>
                <label htmlFor="bound-owner" className="block space-y-2.5 text-left">
                  <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.boundOwnerLabel")}</span>
                  <XInput
                    id="bound-owner"
                    type="text"
                    readOnly
                    value={ownerAddress || t("agentsPage.walletSessionRequired")}
                    className="text-sm font-mono text-blue-300"
                  />
                </label>
                <section className="grid grid-cols-2 gap-4">
                  <label htmlFor="daily-budget" className="block space-y-2.5 text-left">
                    <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.dailyBudgetLabel")}</span>
                    <XInput
                      id="daily-budget"
                      type="number"
                      step="0.01"
                      value={dailyBudget}
                      onChange={(event) => onDailyBudgetChange(event.target.value)}
                      required
                    />
                  </label>
                  <label htmlFor="max-calls" className="block space-y-2.5 text-left">
                    <span className="x-overline-label font-bold uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.maxCallsLabel")}</span>
                    <XInput
                      id="max-calls"
                      type="number"
                      value={maxCalls}
                      onChange={(event) => onMaxCallsChange(event.target.value)}
                      required
                    />
                  </label>
                </section>
                <XPanel as="aside" variant="muted" className="flex items-start gap-3 rounded-[24px] p-4 shadow-[inset_0_0_0_1px_rgba(29,155,240,0.14)]">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-400" />
                  <p className="x-overline-label leading-relaxed text-gray-400">
                    {t("agentsPage.createAgentHint")}
                  </p>
                </XPanel>
              </XDialogBody>
              <XDialogFooter className="justify-center border-t-0 pt-0">
                <XButton variant="ghost" size="modal" onClick={onCloseCreateModal}>
                  {t("agentsPage.cancel")}
                </XButton>
                <XButton variant="primary" size="modal" type="submit" disabled={isLoading}>
                  {isLoading ? t("agentsPage.creating") : t("agentsPage.createAgentProfile")}
                </XButton>
              </XDialogFooter>
            </form>
          </XDialogSurface>
        </XDialog>
      ) : null}

      {pendingDangerAction ? (
        <XDialog open={Boolean(pendingDangerAction)} ariaLabelledby="danger-agent-title">
          <XDialogSurface className="max-w-[560px]">
            <XDialogHeader>
              <XDialogHeaderCopy>
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
              </XDialogHeaderCopy>
              <XDialogCloseButton onClick={onCloseDangerAction} />
            </XDialogHeader>

            <XDialogBody className="space-y-6">
              <XPanel as="article" variant="muted" className="rounded-[24px] p-5">
                <h3 className="x-card-title text-white">{pendingDangerAction.agent.name || t("agentsPage.unnamedAgent")}</h3>
                <p className="x-data-label mt-2 font-mono text-gray-400">{pendingDangerAction.agent.tokenPrefix || pendingDangerAction.agent.id}</p>
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
              <XButton variant="ghost" size="modal" onClick={onCloseDangerAction}>
                {t("agentsPage.cancel")}
              </XButton>
              <XButton
                type="button"
                variant={pendingDangerAction.type === "revoke" ? "danger" : "primary"}
                size="modal"
                onClick={() => void onConfirmDangerAction()}
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
      ) : null}

      {pendingDeleteAgent ? (
        <XDialog open={Boolean(pendingDeleteAgent)} ariaLabelledby="delete-agent-title">
          <XDialogSurface className="max-w-[560px]">
            <XDialogHeader>
              <XDialogHeaderCopy>
                <h2 id="delete-agent-title" className="x-modal-title text-white">
                  {t("agentsPage.workspaceDeleteAgentTitle")}
                </h2>
                <p className="x-body-copy mt-3 text-gray-400">
                  {t("agentsPage.workspaceDeleteAgentDescription", {
                    name: pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                </p>
              </XDialogHeaderCopy>
              <XDialogCloseButton onClick={onCloseDeleteAgent} />
            </XDialogHeader>

            <XDialogBody className="space-y-6">
              <div className="space-y-3">
                <p className="x-body-copy text-gray-400">
                  {t("agentsPage.workspaceDeleteAgentConfirmInstruction", {
                    name: pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                </p>
                <XInput
                  type="text"
                  value={deleteConfirmationName}
                  onChange={(event) => onDeleteConfirmationNameChange(event.target.value)}
                  placeholder={t("agentsPage.workspaceDeleteAgentPlaceholder", {
                    name: pendingDeleteAgent.name || t("agentsPage.unnamedAgent"),
                  })}
                />
                <p className="x-meta-label text-gray-500">
                  {t("agentsPage.workspaceDeleteAgentTypingMismatch")}
                </p>
              </div>
            </XDialogBody>

            <XDialogFooter className="border-t-0 pt-0">
              <XButton variant="ghost" size="modal" onClick={onCloseDeleteAgent}>
                {t("agentsPage.cancel")}
              </XButton>
              <XButton
                variant="danger"
                size="modal"
                onClick={onConfirmDeleteAgent}
                disabled={isDeletingAgent || deleteConfirmationName !== (pendingDeleteAgent.name || t("agentsPage.unnamedAgent"))}
              >
                {isDeletingAgent ? t("agentsPage.workspaceManaging") : t("agentsPage.workspaceDeleteAgentConfirm")}
              </XButton>
            </XDialogFooter>
          </XDialogSurface>
        </XDialog>
      ) : null}

      {newCredential ? (
        <XDialog open={Boolean(newCredential)} ariaLabelledby="issued-agent-title">
          <XDialogSurface className="max-w-lg border border-emerald-500/15 shadow-[0_0_70px_rgba(16,185,129,0.08)]">
            <XDialogHeader className="border-b border-emerald-500/10">
              <XDialogHeaderCopy>
                <h2 id="issued-agent-title" className="x-modal-title text-white">{t("agentsPage.credentialIssuedTitle")}</h2>
                <p className="x-body-copy mt-2 text-gray-500">{t("agentsPage.credentialIssuedDescription")}</p>
              </XDialogHeaderCopy>
              <XDialogCloseButton onClick={onCloseIssuedCredential} />
            </XDialogHeader>
            <XDialogBody className="space-y-6 text-center">
              <span className="mx-auto block w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-[0_10px_30px_rgba(16,185,129,0.1)]" aria-hidden="true">
                <ShieldCheck className="h-10 w-10 text-emerald-400" />
              </span>

              <section className="group relative">
                <code className="x-panel-muted block break-all rounded-[24px] p-4 pr-12 text-left font-mono text-sm text-emerald-400">
                  {newCredential.token}
                </code>
                <XButton
                  variant="icon"
                  size="icon"
                  onClick={onCopyNewToken}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl p-2.5 text-gray-400"
                >
                  {copiedId === "new-token" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </XButton>
              </section>

              <dl className="grid grid-cols-2 gap-4 text-left">
                <XPanel variant="muted" className="rounded-[22px] p-4">
                  <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.agentNameLabel")}</dt>
                  <dd className="text-sm font-bold text-white">{newCredential.name}</dd>
                </XPanel>
                <XPanel variant="muted" className="rounded-[22px] p-4">
                  <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</dt>
                  <dd className="text-sm font-bold text-emerald-400">${(newCredential.creditLimit ?? 0).toFixed(2)}</dd>
                </XPanel>
              </dl>

              <dl className="x-panel-muted rounded-[22px] p-4 text-left">
                <dt className="x-overline-label mb-1 block font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.boundOwnerValueLabel")}</dt>
                <dd className="break-all font-mono text-sm text-blue-300">{newCredential.ownerAddress}</dd>
              </dl>

              <XButton variant="primary" size="modal" onClick={onCloseIssuedCredential} fullWidth>
                {t("agentsPage.savedTokenCta")}
              </XButton>
            </XDialogBody>
          </XDialogSurface>
        </XDialog>
      ) : null}

      {isEditModalOpen ? (
        <XDialog open={isEditModalOpen} ariaLabelledby="edit-agent-title">
          <XDialogSurface className="max-w-md">
            <XDialogHeader>
              <h2 id="edit-agent-title" className="x-modal-title flex items-center gap-2 text-white">
                <PencilLine className="h-5 w-5 text-blue-400" />
                {t("agentsPage.editAgentLimitsTitle")}
              </h2>
              <XDialogCloseButton onClick={onCloseEditModal} />
            </XDialogHeader>
            <XDialogBody className="space-y-5">
              <p className="x-body-copy leading-6 text-gray-400">{t("agentsPage.editAgentLimitsDescription")}</p>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.maxCallsLabel")}</span>
                <XInput type="number" value={quotaMaxCalls} onChange={(event) => onQuotaMaxCallsChange(event.target.value)} className="rounded-xl py-3 text-sm" />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.rateLimitLabel")}</span>
                <XInput type="number" value={quotaRpm} onChange={(event) => onQuotaRpmChange(event.target.value)} className="rounded-xl py-3 text-sm" />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.dailyBudgetLabel")}</span>
                <XInput type="number" step="0.01" min="0.01" value={quotaDailyBudget} onChange={(event) => onQuotaDailyBudgetChange(event.target.value)} className="rounded-xl py-3 text-sm" />
              </label>
              <label className="block space-y-2">
                <span className="x-overline-label font-bold uppercase tracking-widest text-gray-500">{t("agentsPage.expirationLabel")}</span>
                <XInput type="datetime-local" value={quotaExpiresAtLocal} onChange={(event) => onQuotaExpiresAtLocalChange(event.target.value)} className="rounded-xl py-3 text-sm" />
              </label>
            </XDialogBody>
            <XDialogFooter className="border-t-0 pt-0">
              <XButton variant="ghost" size="modal" onClick={onCloseEditModal}>{t("agentsPage.cancel")}</XButton>
              <XButton variant="primary" size="modal" onClick={onUpdateQuota}>{t("agentsPage.save")}</XButton>
            </XDialogFooter>
          </XDialogSurface>
        </XDialog>
      ) : null}
    </>
  );
}