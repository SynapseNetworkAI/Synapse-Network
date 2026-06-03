import { describe, expect, it } from "vitest";

import type { BusinessPolicyOverviewResponse } from "@/services/admin-api";

import {
  buildConfigEntryCards,
  buildPolicyDiffRows,
  buildPolicySnapshotRows,
  canManageBusinessPolicy,
  flattenRuntimeSummary,
  getPolicyFieldValue,
  groupRuntimeRowsBySource,
  policyFieldGroups,
  setPolicyFieldValue,
} from "./config-center-presenters";

const overview = {
  draft: {
    policy: {
      finance: {
        platformFeeRate: "0.120000",
        gatewayRoutingTaxUsdc: "0.010000",
        consumerWithdrawFeeUsdc: "0.500000",
        consumerDepositMinUsdc: "5.000000",
      },
      consumerWithdraw: {
        minUsdc: "10.000000",
        manualReviewThresholdUsdc: "200.000000",
        maxDailyCount: 8,
        maturitySeconds: 3600,
      },
      risk: {
        withdrawalAutoSingleLimitUsdc: "100.000000",
        withdrawalAuto24hLimitUsdc: "500.000000",
        withdrawalWindowHours: 24,
      },
      reconciliation: {
        alertDeltaUsdc: "1.000000",
      },
    },
    meta: {
      draftVersion: 3,
      publishedVersion: 2,
      isDirty: true,
      updatedAt: "2026-06-03T01:00:00Z",
      publishedAt: "2026-06-03T00:00:00Z",
      updatedBy: "adm-1",
      publishedBy: "adm-2",
    },
  },
  published: {
    policy: {
      finance: {
        platformFeeRate: "0.100000",
        gatewayRoutingTaxUsdc: "0.010000",
        consumerWithdrawFeeUsdc: "0.500000",
        consumerDepositMinUsdc: "5.000000",
      },
      consumerWithdraw: {
        minUsdc: "10.000000",
        manualReviewThresholdUsdc: "200.000000",
        maxDailyCount: 6,
        maturitySeconds: 3600,
      },
      risk: {
        withdrawalAutoSingleLimitUsdc: "100.000000",
        withdrawalAuto24hLimitUsdc: "500.000000",
        withdrawalWindowHours: 24,
      },
      reconciliation: {
        alertDeltaUsdc: "1.000000",
      },
    },
    meta: {
      draftVersion: 3,
      publishedVersion: 2,
      isDirty: true,
      updatedAt: "2026-06-03T01:00:00Z",
      publishedAt: "2026-06-03T00:00:00Z",
      updatedBy: "adm-1",
      publishedBy: "adm-2",
    },
  },
  runtime: {
    businessPolicy: {
      source: "published",
      publishedVersion: 2,
      updatedAt: "2026-06-03T00:00:00Z",
      updatedBy: "adm-2",
    },
    envSummary: {
      gateway: {
        rpcUrl: { source: "env", value: "https://rpc.example" },
        webhookSecret: { source: "secret", configured: true },
      },
      policy: {
        platformFeeRate: { source: "published", value: "0.100000" },
      },
    },
  },
} satisfies BusinessPolicyOverviewResponse;

describe("config-center presenters", () => {
  it("keeps the overview as entry cards instead of policy form fields", () => {
    expect(buildConfigEntryCards().map((entry) => entry.href)).toEqual([
      "/config/business-policy",
      "/config/runtime",
      "/config/published",
      "/menu-config",
    ]);
    expect(
      buildConfigEntryCards().some((entry) =>
        entry.title.includes("Platform Fee Rate")
      )
    ).toBe(false);
  });

  it("splits business policy fields into focused domain groups", () => {
    expect(policyFieldGroups.map((group) => group.title)).toEqual([
      "Finance",
      "Consumer Withdraw",
      "Risk",
      "Reconciliation",
    ]);
    expect(policyFieldGroups[0]?.fields.map((field) => field.path)).toContain(
      "finance.platformFeeRate"
    );
  });

  it("allows only super_admin to edit business policy", () => {
    expect(canManageBusinessPolicy("super_admin")).toBe(true);
    expect(canManageBusinessPolicy("platform_ops_admin")).toBe(false);
    expect(canManageBusinessPolicy("finance_admin")).toBe(false);
  });

  it("updates numeric fields as numbers and money fields as strings", () => {
    const next = setPolicyFieldValue(
      overview.draft.policy,
      "consumerWithdraw.maxDailyCount",
      "12"
    );
    expect(next.consumerWithdraw.maxDailyCount).toBe(12);
    expect(
      getPolicyFieldValue(
        setPolicyFieldValue(next, "finance.gatewayRoutingTaxUsdc", "0.020000"),
        "finance.gatewayRoutingTaxUsdc"
      )
    ).toBe("0.020000");
  });

  it("redacts sensitive runtime values and groups rows by source", () => {
    const rows = flattenRuntimeSummary(overview.runtime.envSummary);
    const secretRow = rows.find((row) => row.key === "webhookSecret");
    expect(secretRow?.displayValue).toBe("configured");
    expect(secretRow?.sensitive).toBe(true);
    expect(groupRuntimeRowsBySource(rows).map((group) => group.source)).toEqual(
      ["env", "published", "secret"]
    );
  });

  it("builds published snapshot rows and draft diff rows", () => {
    expect(buildPolicySnapshotRows(overview.published.policy)).toHaveLength(12);
    expect(
      buildPolicyDiffRows(overview.draft.policy, overview.published.policy)
    ).toEqual([
      {
        label: "Finance / Platform Fee Rate",
        draft: "0.120000",
        published: "0.100000",
        unit: "ratio",
      },
      {
        label: "Consumer Withdraw / Max Daily Count",
        draft: "8",
        published: "6",
        unit: "count",
      },
    ]);
  });
});
