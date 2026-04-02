"use client";

import { Bot, Check, Copy, PencilLine, XCircle } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { formatAgentBudget } from "@/components/dashboard/agents/agentWorkspacePresenters";
import { XButton } from "@/components/xui/XButton";
import { XPanel } from "@/components/xui/XPanel";
import { cx } from "@/components/xui/cx";
import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";

type AgentsWorkspaceDetailPaneProps = {
  selectedAgent: AgentCredentialRecord | null;
  copiedId: string | null;
  isRevokingCredential: boolean;
  isRegeneratingCredential: boolean;
  selectedAgentRemainingCalls: number;
  selectedAgentUsagePercent: number;
  onClose: () => void;
  onCopyAgentId: () => void;
  onOpenEdit: (agent: AgentCredentialRecord) => void;
  onRequestDangerAction: (action: "generate" | "revoke" | "regenerate", agent: AgentCredentialRecord) => void;
};

export default function AgentsWorkspaceDetailPane({
  selectedAgent,
  copiedId,
  isRevokingCredential,
  isRegeneratingCredential,
  selectedAgentRemainingCalls,
  selectedAgentUsagePercent,
  onClose,
  onCopyAgentId,
  onOpenEdit,
  onRequestDangerAction,
}: Readonly<AgentsWorkspaceDetailPaneProps>) {
  const { t } = useLanguage();

  return (
    <XPanel
      as="article"
      variant="flat"
      className={cx(
        "min-w-0 rounded-[24px] xl:w-[720px]",
        !selectedAgent && "xl:h-[560px]",
      )}
    >
      {!selectedAgent ? (
        <section className="flex h-full min-h-[560px] flex-col items-center justify-center px-8 py-20 text-center">
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
                <XButton
                  variant="icon"
                  size="icon"
                  onClick={onCopyAgentId}
                  className="rounded-lg"
                  title={t("agentsPage.workspaceCopyAgentId")}
                >
                  {copiedId === `agent-id-${selectedAgent.id}` ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </XButton>
              </div>
              <p className="x-body-copy mt-4 max-w-2xl">{t("agentsPage.workspaceDetailDescription")}</p>
            </div>
            <XButton
              variant="icon"
              size="icon"
              onClick={onClose}
              className="rounded-lg"
              aria-label={t("agentsPage.workspaceCloseDetail")}
            >
              <XCircle className="h-5 w-5" />
            </XButton>
          </header>

          <section className="space-y-5 px-6 py-6">
            <section>
              <h3 className="x-section-title text-white">{t("agentsPage.workspaceCredentialPanelTitle")}</h3>
              <p className="x-body-copy mt-2">{t("agentsPage.workspaceCredentialPanelDescription")}</p>
            </section>

            <section className="space-y-4">
              <XPanel as="article" variant="muted" className="rounded-[20px] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="x-meta-label">{t("agentsPage.workspaceCredentialPrefixLabel")}</p>
                    <p className="x-metric-value mt-2 font-mono text-white">{selectedAgent.tokenPrefix || selectedAgent.id.slice(0, 18)}</p>
                  </div>
                  {selectedAgent.status === "active" ? (
                    <div className="flex items-center gap-2.5">
                      <XButton
                        variant="danger"
                        size="credential"
                        onClick={() => onRequestDangerAction("revoke", selectedAgent)}
                        disabled={isRevokingCredential}
                        className="x-credential-action-danger"
                      >
                        {t("agentsPage.workspaceRevokeShort")}
                      </XButton>
                      <XButton
                        variant="primary"
                        size="credential"
                        onClick={() => onRequestDangerAction("regenerate", selectedAgent)}
                        disabled={isRegeneratingCredential}
                        className="x-credential-action-primary"
                      >
                        {isRegeneratingCredential ? t("agentsPage.workspaceRegenerating") : t("agentsPage.workspaceRegenerateShort")}
                      </XButton>
                    </div>
                  ) : (
                    <XButton
                      variant="primary"
                      size="credential"
                      onClick={() => onRequestDangerAction("generate", selectedAgent)}
                      disabled={isRegeneratingCredential}
                      className="x-credential-action-generate"
                    >
                      {isRegeneratingCredential ? t("agentsPage.workspaceGenerating") : t("agentsPage.workspaceGenerateCredential")}
                    </XButton>
                  )}
                </div>
              </XPanel>

              <XPanel as="article" variant="muted" className="rounded-[20px] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="x-meta-label">{t("agentsPage.workspaceQuotaPanelTitle")}</p>
                    <p className="x-body-copy mt-2 max-w-[40rem]">{t("agentsPage.workspaceQuotaPanelDescription")}</p>
                  </div>
                  <XButton
                    variant="ghost"
                    size="pill"
                    onClick={() => onOpenEdit(selectedAgent)}
                    disabled={selectedAgent.status !== "active"}
                    className="px-4 py-2"
                  >
                    <PencilLine className="h-4 w-4" />
                    {t("agentsPage.workspaceEdit")}
                  </XButton>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <XPanel variant="tile" className="rounded-[18px] p-4">
                    <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceBudgetTile")}</p>
                    <p className="x-metric-value mt-3 text-emerald-400">{formatAgentBudget(selectedAgent.creditLimit)}</p>
                  </XPanel>
                  <XPanel variant="tile" className="rounded-[18px] p-4">
                    <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceUsageTile")}</p>
                    <p className="x-metric-value mt-3 text-white">{selectedAgent.callsUsed} / {selectedAgent.maxCalls || "∞"}</p>
                  </XPanel>
                  <XPanel variant="tile" className="rounded-[18px] p-4">
                    <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceRateLimitTile")}</p>
                    <p className="x-metric-value mt-3 text-white">{selectedAgent.rpm > 0 ? `${selectedAgent.rpm}/min` : t("agentsPage.workspaceUnlimited")}</p>
                  </XPanel>
                  <XPanel variant="tile" className="rounded-[18px] p-4">
                    <p className="x-overline-label uppercase tracking-[0.18em] text-gray-500">{t("agentsPage.workspaceRemainingCallsTile")}</p>
                    <p className="x-metric-value mt-3 text-white">{selectedAgentRemainingCalls}</p>
                  </XPanel>
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
              </XPanel>
            </section>
          </section>
        </div>
      )}
    </XPanel>
  );
}