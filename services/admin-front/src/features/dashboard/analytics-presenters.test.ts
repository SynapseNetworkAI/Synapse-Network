import { describe, expect, it } from "vitest";

import {
  buildAnalyticsNorthStarCards,
  buildConsumerFunnelSteps,
  buildDataQualitySignalCards,
  buildInvocationSignalCards,
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
});
