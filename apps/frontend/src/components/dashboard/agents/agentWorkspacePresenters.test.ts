import { describe, expect, it } from "vitest";

import {
  buildAgentWorkspaceHighlights,
  buildAgentWorkspaceSummary,
  filterAgentWorkspaceCredentials,
  formatAgentBudget,
  getAgentUsagePercent,
  isAgentNeedingAttention,
} from "@/components/dashboard/agents/agentWorkspacePresenters";
import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";

const credentials: AgentCredentialRecord[] = [
  {
    id: "agt_live_alpha",
    ownerAddress: "0xabc",
    name: "Alpha",
    tokenPrefix: "agt_alpha",
    status: "active",
    maxCalls: 100,
    callsUsed: 20,
    rpm: 600,
    creditLimit: 10,
    expiresAt: 0,
  },
  {
    id: "agt_live_bravo",
    ownerAddress: "0xabc",
    name: "Bravo",
    tokenPrefix: "agt_bravo",
    status: "active",
    maxCalls: 100,
    callsUsed: 90,
    rpm: 300,
    creditLimit: 25,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  },
  {
    id: "agt_revoked_charlie",
    ownerAddress: "0xabc",
    name: "Charlie",
    tokenPrefix: "agt_charlie",
    status: "revoked",
    maxCalls: 50,
    callsUsed: 10,
    rpm: 120,
    creditLimit: 5,
    expiresAt: 0,
  },
];

describe("agentWorkspacePresenters", () => {
  it("builds workspace summary from credentials", () => {
    expect(buildAgentWorkspaceSummary(credentials)).toEqual({
      totalAgents: 3,
      activeAgents: 2,
      attentionAgents: 1,
      totalBudget: 40,
      remainingCalls: 130,
    });
  });

  it("filters credentials by query and status", () => {
    expect(filterAgentWorkspaceCredentials(credentials, "bravo", "all")).toHaveLength(1);
    expect(filterAgentWorkspaceCredentials(credentials, "", "active")).toHaveLength(2);
    expect(filterAgentWorkspaceCredentials(credentials, "agt_", "revoked")).toHaveLength(1);
  });

  it("calculates usage and attention correctly", () => {
    expect(getAgentUsagePercent(credentials[0]!)).toBe(20);
    expect(isAgentNeedingAttention(credentials[0]!)).toBe(false);
    expect(isAgentNeedingAttention(credentials[1]!)).toBe(true);
    expect(isAgentNeedingAttention(credentials[2]!)).toBe(false);
  });

  it("ranks highlights with attention agents first", () => {
    const highlights = buildAgentWorkspaceHighlights(credentials);

    expect(highlights[0]).toMatchObject({
      name: "Bravo",
      tone: "amber",
    });
    expect(highlights[2]).toMatchObject({
      name: "Charlie",
      tone: "slate",
    });
  });

  it("formats budget labels", () => {
    expect(formatAgentBudget(12.5)).toBe("$12.50");
    expect(formatAgentBudget(null)).toBe("$0.00");
  });
});