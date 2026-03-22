import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";

export type AgentWorkspaceStatusFilter = "all" | AgentCredentialRecord["status"];

export type AgentWorkspaceSummary = {
  totalAgents: number;
  activeAgents: number;
  attentionAgents: number;
  totalBudget: number;
  remainingCalls: number;
};

export type AgentWorkspaceHighlight = {
  id: string;
  name: string;
  detail: string;
  tone: "blue" | "amber" | "slate";
};

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function getAgentUsagePercent(agent: AgentCredentialRecord): number {
  if (!agent.maxCalls || agent.maxCalls <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((agent.callsUsed / agent.maxCalls) * 100));
}

export function isAgentNeedingAttention(agent: AgentCredentialRecord): boolean {
  if (agent.status !== "active") {
    return false;
  }

  if (agent.maxCalls > 0 && agent.callsUsed >= agent.maxCalls) {
    return true;
  }

  if (getAgentUsagePercent(agent) >= 80) {
    return true;
  }

  if (agent.expiresAt > 0) {
    const expiresInMs = (agent.expiresAt * 1000) - Date.now();
    return expiresInMs <= 7 * 24 * 60 * 60 * 1000;
  }

  return false;
}

export function buildAgentWorkspaceSummary(credentials: AgentCredentialRecord[]): AgentWorkspaceSummary {
  return credentials.reduce<AgentWorkspaceSummary>((summary, agent) => {
    return {
      totalAgents: summary.totalAgents + 1,
      activeAgents: summary.activeAgents + (agent.status === "active" ? 1 : 0),
      attentionAgents: summary.attentionAgents + (isAgentNeedingAttention(agent) ? 1 : 0),
      totalBudget: summary.totalBudget + Math.max(0, agent.creditLimit ?? 0),
      remainingCalls: summary.remainingCalls + Math.max(0, (agent.maxCalls || 0) - agent.callsUsed),
    };
  }, {
    totalAgents: 0,
    activeAgents: 0,
    attentionAgents: 0,
    totalBudget: 0,
    remainingCalls: 0,
  });
}

export function filterAgentWorkspaceCredentials(
  credentials: AgentCredentialRecord[],
  query: string,
  status: AgentWorkspaceStatusFilter,
): AgentCredentialRecord[] {
  const normalizedQuery = normalizeQuery(query);

  return credentials.filter((agent) => {
    if (status !== "all" && agent.status !== status) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      agent.id,
      agent.name,
      agent.ownerAddress,
      agent.tokenPrefix,
      agent.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function buildAgentWorkspaceHighlights(credentials: AgentCredentialRecord[]): AgentWorkspaceHighlight[] {
  const ranked = [...credentials].sort((left, right) => {
    const attentionDelta = Number(isAgentNeedingAttention(right)) - Number(isAgentNeedingAttention(left));
    if (attentionDelta !== 0) {
      return attentionDelta;
    }

    return getAgentUsagePercent(right) - getAgentUsagePercent(left);
  });

  return ranked.slice(0, 3).map((agent) => {
    const usagePercent = getAgentUsagePercent(agent);
    if (agent.status !== "active") {
      return {
        id: agent.id,
        name: agent.name || "Unnamed Agent",
        detail: "This agent has been revoked and no longer authenticates runtime calls.",
        tone: "slate",
      };
    }

    if (isAgentNeedingAttention(agent)) {
      return {
        id: agent.id,
        name: agent.name || "Unnamed Agent",
        detail: `Usage is at ${usagePercent}% of the current call cap. Review limits before automation stalls.`,
        tone: "amber",
      };
    }

    return {
      id: agent.id,
      name: agent.name || "Unnamed Agent",
      detail: `Healthy runtime profile with ${Math.max(0, (agent.maxCalls || 0) - agent.callsUsed)} calls left in the current quota window.`,
      tone: "blue",
    };
  });
}

export function formatAgentBudget(value: number | null | undefined): string {
  return `$${Math.max(0, value ?? 0).toFixed(2)}`;
}