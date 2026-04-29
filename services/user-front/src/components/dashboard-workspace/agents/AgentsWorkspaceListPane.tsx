"use client";

import { Bot, Check, MinusCircle, Plus } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { XButton } from "@/components/xui/XButton";
import { XPanel } from "@/components/xui/XPanel";
import { cx } from "@/components/xui/cx";
import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";

type AgentsWorkspaceListPaneProps = {
  credentials: AgentCredentialRecord[];
  agentLimit: number;
  canCreateAgent: boolean;
  isLoading: boolean;
  isManageMode: boolean;
  selectedAgentId: string | null;
  onOpenCreateModal: () => void;
  onToggleManageMode: () => void;
  onSelectAgent: (agentId: string) => void;
  onRequestDeleteAgent: (agent: AgentCredentialRecord) => void;
};

export default function AgentsWorkspaceListPane({
  credentials,
  agentLimit,
  canCreateAgent,
  isLoading,
  isManageMode,
  selectedAgentId,
  onOpenCreateModal,
  onToggleManageMode,
  onSelectAgent,
  onRequestDeleteAgent,
}: Readonly<AgentsWorkspaceListPaneProps>) {
  const { t } = useLanguage();

  return (
    <article className="min-w-0">
      <header className="x-divider mb-4 flex flex-col gap-4 border-b pb-4">
        <div>
          <h2 className="x-section-title mt-1 text-white">{t("agentsPage.workspaceYourAgentsTitle")}</h2>
          <p className="x-body-copy mt-3">{t("agentsPage.workspaceYourAgentsDescription")}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <XButton
            variant="primary"
            size="pill"
            onClick={onOpenCreateModal}
            disabled={!canCreateAgent}
            className="px-5"
            title={
              !canCreateAgent
                ? t("agentsPage.workspaceAgentLimitReached", { limit: agentLimit })
                : undefined
            }
          >
            <Plus className="h-4 w-4" />
            {t("agentsPage.workspaceCreateAgentCompact")}
          </XButton>
          <div className="flex items-center gap-3">
            <XButton
              variant="ghost"
              size="pill"
              onClick={onToggleManageMode}
              className={cx(
                "px-4 font-medium transition",
                isManageMode
                  ? "text-white shadow-[inset_0_0_0_1px_rgba(96,165,250,0.85),0_0_0_1px_rgba(37,99,235,0.16)] bg-[rgba(29,155,240,0.08)]"
                  : "",
              )}
              aria-pressed={isManageMode}
            >
              {isManageMode ? <Check className="h-4 w-4" /> : null}
              {isManageMode ? t("agentsPage.workspaceDoneManaging") : t("agentsPage.workspaceManageAgents")}
            </XButton>
          </div>
        </div>
        <p className={cx("text-xs", canCreateAgent ? "text-gray-500" : "text-amber-200")}>
          {t("agentsPage.workspaceAgentLimitHint", {
            count: credentials.length,
            limit: agentLimit,
          })}
        </p>
      </header>

      <div className="space-y-2.5">
        {isLoading && credentials.length === 0 ? (
          [1, 2, 3].map((index) => (
            <XPanel key={index} variant="muted" className="h-[128px] animate-pulse rounded-[20px]" />
          ))
        ) : credentials.length === 0 ? (
          <XPanel as="section" variant="muted" className="flex min-h-[420px] flex-col items-center justify-center space-y-4 rounded-[24px] p-8 text-center">
            <XPanel variant="muted" className="rounded-full p-4" aria-hidden="true">
              <Bot className="h-10 w-10 text-gray-600" />
            </XPanel>
            <header>
              <h3 className="x-card-title text-white">{t("agentsPage.workspaceNoMatchingAgents")}</h3>
              <p className="x-body-copy mx-auto mt-2 max-w-md">{t("agentsPage.workspaceNoMatchingAgentsDescription")}</p>
            </header>
          </XPanel>
        ) : (
          credentials.map((agent) => {
            const isSelected = selectedAgentId === agent.id;
            const statusClasses = agent.status === "active"
              ? "bg-emerald-500/12 text-emerald-300"
              : "bg-white/[0.06] text-gray-300";

            return (
              <div
                key={agent.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => onSelectAgent(agent.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectAgent(agent.id);
                  }
                }}
                className={cx(
                  "x-list-card block w-full cursor-pointer px-6 py-5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d9bf0]/60 xl:w-[536px]",
                  isSelected
                    ? "x-tile-active"
                    : "x-tile-flat x-tile-flat-hover",
                )}
              >
                <div className="flex items-start gap-4">
                  <span className={cx("mt-0.5 rounded-[18px] p-3", agent.status === "active" ? "x-icon-chip" : "x-panel-muted")} aria-hidden="true">
                    <Bot className={`h-5 w-5 ${agent.status === "active" ? "text-blue-400" : "text-gray-500"}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="x-card-title truncate text-[17px] text-white">{agent.name || t("agentsPage.unnamedAgent")}</h3>
                        <p className="x-body-copy mt-2 max-w-[22rem] leading-7">{t("agentsPage.workspaceAgentCardDescription")}</p>
                      </div>
                      {isManageMode ? (
                        <XButton
                          variant="icon"
                          size="icon"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onRequestDeleteAgent(agent);
                          }}
                          className="x-manage-delete mt-0.5 rounded-full p-0"
                          aria-label={t("agentsPage.workspaceDeleteAgentLabel")}
                          title={t("agentsPage.workspaceDeleteAgentLabel")}
                        >
                          <MinusCircle className="h-4 w-4" />
                        </XButton>
                      ) : null}
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <span className={`x-status-inline ${statusClasses}`}>
                        {agent.status === "active" ? t("agentsPage.workspaceFilterActive") : t("agentsPage.workspaceToneRevoked")}
                      </span>
                      <span className="x-data-label font-mono text-gray-500">{agent.tokenPrefix || agent.id.slice(0, 12)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
