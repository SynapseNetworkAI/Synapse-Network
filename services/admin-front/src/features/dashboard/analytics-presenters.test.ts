import { describe, expect, it } from "vitest";

import {
  buildAnalyticsNorthStarCards,
  buildConsumerFunnelSteps,
  buildConsumerFunnelSummaryCards,
  buildDataQualitySignalCards,
  buildDataQualityLagCards,
  buildDataQualitySchemaIssueRows,
  buildDistributionItems,
  buildInvocationSignalCards,
  buildMoneyFlowContextCards,
  buildProviderSignalCards,
  buildProviderSettlementCards,
  summarizeSourceCoverage,
} from "./analytics-presenters";

describe("analytics dashboard presenters", () => {
  it("formats north star card values by unit", () => {
    const cards = buildAnalyticsNorthStarCards([
      { key: "gmv_usdc", label: "GMV", value: 1280.4, unit: "USDC", tone: "green", detail: "gross revenue" },
      { key: "success", label: "Success", value: 0.978, unit: "rate", tone: "green", detail: "completed ratio" },
      { key: "invokes", label: "Invokes", value: 4200, unit: "count", tone: "green", detail: "paid invokes" },
    ]);

    expect(cards[0]).toMatchObject({ value: "1,280.40 USDC", tone: "green" });
    expect(cards[1]).toMatchObject({ value: "97.8%" });
    expect(cards[2]).toMatchObject({ value: "4,200" });
  });

  it("calculates funnel step tones from conversion rate", () => {
    const steps = buildConsumerFunnelSteps({
      window: "24h",
      steps: [
        { eventName: "page_viewed", label: "page viewed", users: 100, events: 120, conversionRate: 1, dropoffRate: 0 },
        { eventName: "wallet_connected", label: "wallet connected", users: 40, events: 44, conversionRate: 0.4, dropoffRate: 0.6 },
      ],
      summary: {
        activationRate: 0.4,
        firstInvokeUsers: 10,
        quoteToInvokeRate: 0.5,
        depositToFirstInvokeRate: 0.2,
      },
    });

    expect(steps[0]).toMatchObject({ conversion: "100%", tone: "green" });
    expect(steps[1]).toMatchObject({ conversion: "40%", dropoff: "60%", tone: "red" });
  });

  it("builds consumer summary cards for the drilldown page", () => {
    const cards = buildConsumerFunnelSummaryCards({
      window: "24h",
      steps: [],
      summary: {
        activationRate: 0.181,
        firstInvokeUsers: 88,
        quoteToInvokeRate: 0.64,
        depositToFirstInvokeRate: 0.32,
      },
    });

    expect(cards.map((card) => card.key)).toEqual([
      "activation-rate",
      "first-invoke-users",
      "quote-to-invoke",
      "deposit-to-first-invoke",
    ]);
    expect(cards[0]).toMatchObject({ value: "18.1%", tone: "orange" });
    expect(cards[2]).toMatchObject({ value: "64%", tone: "green" });
  });

  it("marks invocation latency and low success rate as degraded", () => {
    const cards = buildInvocationSignalCards({
      window: "24h",
      quoteCount: 100,
      invokeStartedCount: 80,
      invokeCompletedCount: 60,
      invokeFailedCount: 20,
      successRate: 0.75,
      gmvUsdc: 900,
      priceAvgUsdc: 15,
      platformFeeUsdc: 120,
      providerNetUsdc: 780,
      latencyMs: { p50: 200, p95: 7000, p99: 9000 },
      failureStages: [],
      errorCodes: [],
      trend: [],
    });

    expect(cards[0]).toMatchObject({ key: "success-rate", tone: "red" });
    expect(cards[1]).toMatchObject({ key: "latency-p95", value: "7s", tone: "red" });
  });

  it("surfaces degraded data quality and source coverage", () => {
    const dataQuality = {
      window: "24h",
      overallStatus: "degraded",
      eventCount: 12,
      duplicateRate: 0.0833,
      criticalEventsFreshness: [
        { eventName: "page_viewed", seen: true, lastSeenAt: "2026-04-16T00:00:00Z", count: 10 },
        { eventName: "invoke_completed", seen: false, lastSeenAt: "", count: 0 },
      ],
      sourceCoverage: { frontend: 8, gateway: 4 },
      privacyViolations: 1,
      missingRequiredProperties: 0,
      xorViolations: 0,
      kafkaLag: 0,
      clickhouseLag: 0,
      fileBackendFallbackEvents: 0,
      schemaIssueSamples: [],
    };

    const cards = buildDataQualitySignalCards(dataQuality);

    expect(cards[0]).toMatchObject({ label: "Event Volume", tone: "red" });
    expect(cards[1]).toMatchObject({ label: "Privacy Check", value: "1", tone: "red" });
    expect(cards[2]).toMatchObject({ label: "Critical Freshness", value: "1 missing", tone: "red" });
    expect(summarizeSourceCoverage(dataQuality)).toBe("frontend: 8 / gateway: 4");
  });

  it("formats provider settlement, money flow, distributions, and schema samples", () => {
    const providerCards = buildProviderSettlementCards({
      window: "24h",
      revenueProviderCount: 2,
      firstRevenueProviderCount: 1,
      avgTimeSinceListingMs: 86400000,
      providerGrossUsdc: 100,
      platformFeeUsdc: 15,
      providerNetUsdc: 85,
      pendingSettlementUsdc: 20,
      settlementCompletedUsdc: 40,
      settlementFailureRate: 0,
      settlementP95ConfirmMs: 1200,
      settlementFunnel: [],
      topProviders: [],
    });
    const providerSignalCards = buildProviderSignalCards({
      window: "24h",
      revenueProviderCount: 2,
      firstRevenueProviderCount: 1,
      avgTimeSinceListingMs: 86400000,
      providerGrossUsdc: 100,
      platformFeeUsdc: 15,
      providerNetUsdc: 85,
      pendingSettlementUsdc: 20,
      settlementCompletedUsdc: 40,
      settlementFailureRate: 0,
      settlementP95ConfirmMs: 1200,
      settlementFunnel: [],
      topProviders: [],
    });

    const moneyCards = buildMoneyFlowContextCards({
      window: "24h",
      depositUsdc: 100,
      depositFailedCount: 0,
      withdrawalUsdc: 10,
      withdrawalFailedCount: 0,
      refundUsdc: 4.5,
      confirmLatencyMs: { p50: 42000, p95: 184000 },
      depositErrors: [],
      depositFailureSamples: [],
      withdrawalErrors: [],
      financeContext: {
        pendingDepositCount: 2,
        pendingWithdrawalCount: 1,
        vaultLedgerDeltaUsdc: "0.50",
        chainConfirmedNotLedgerConfirmedCount: 1,
      },
    });

    const dataQuality = {
      window: "24h",
      overallStatus: "monitoring",
      eventCount: 10,
      duplicateRate: 0,
      criticalEventsFreshness: [],
      sourceCoverage: {},
      privacyViolations: 0,
      missingRequiredProperties: 3,
      xorViolations: 1,
      kafkaLag: 0,
      clickhouseLag: 4,
      fileBackendFallbackEvents: 0,
      schemaIssueSamples: [{ eventName: "invoke_failed", issue: "missing failure_stage", count: 2 }],
    };

    expect(providerCards[0]).toMatchObject({ label: "Provider Gross", value: "100.00 USDC" });
    expect(providerCards[1]).toMatchObject({ label: "Settlement Completed", tone: "orange", detail: "Available to withdraw 20.00 USDC" });
    expect(providerSignalCards[1]).toMatchObject({ label: "Provider Net", detail: "Available to withdraw 20.00 USDC" });
    expect(moneyCards[0]).toMatchObject({ label: "Refund", value: "4.50 USDC", tone: "orange" });
    expect(moneyCards[2]).toMatchObject({ label: "Pending Deposits", value: "2", tone: "orange" });
    expect(buildDataQualityLagCards(dataQuality)[1]).toMatchObject({ key: "xor-violations", value: "1", tone: "red" });
    expect(buildDistributionItems([{ key: "RPC_TIMEOUT", label: "RPC_TIMEOUT", count: 2, value: 2, rate: 0.5 }])[0]).toMatchObject({ count: "2", rate: "50%" });
    expect(buildDataQualitySchemaIssueRows(dataQuality)).toEqual([
      { key: "invoke_failed-missing failure_stage", eventName: "invoke_failed", issue: "missing failure_stage", count: "2" },
    ]);
  });
});
