import { formatDateTime, formatUsdc } from "@/lib/admin-console";
import type {
  AnalyticsConsumerFunnel,
  AnalyticsDataQuality,
  AnalyticsInvocationRevenue,
  AnalyticsMetricCard,
  AnalyticsMoneyFlow,
  AnalyticsProviderRevenue,
  AnalyticsRiskHealth,
} from "@/services/admin-api";

export type AnalyticsTone = "green" | "orange" | "red" | "gray";

export type AnalyticsNorthStarCard = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: AnalyticsTone;
};

export type AnalyticsFunnelPresenterStep = {
  eventName: string;
  label: string;
  users: string;
  events: string;
  conversion: string;
  dropoff: string;
  tone: AnalyticsTone;
};

export type AnalyticsSignalCard = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: AnalyticsTone;
};

function clampTone(tone: string | null | undefined): AnalyticsTone {
  if (tone === "green" || tone === "orange" || tone === "red" || tone === "gray") {
    return tone;
  }
  return "gray";
}

function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatRate(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 1000) / 10}%`;
}

function formatDurationMs(value: number | null | undefined): string {
  const numeric = value ?? 0;
  if (numeric >= 1000) {
    return `${Math.round(numeric / 1000)}s`;
  }
  return `${Math.round(numeric)}ms`;
}

function formatMetricValue(card: AnalyticsMetricCard): string {
  if (card.unit === "USDC") {
    return `${formatUsdc(Number(card.value ?? 0))} USDC`;
  }

  if (card.unit === "rate") {
    return formatRate(Number(card.value ?? 0));
  }

  if (card.unit === "count") {
    return formatCount(Number(card.value ?? 0));
  }

  return String(card.value ?? "n/a");
}

export function buildAnalyticsNorthStarCards(cards: AnalyticsMetricCard[]): AnalyticsNorthStarCard[] {
  return cards.map((card) => ({
    key: card.key,
    label: card.label,
    value: formatMetricValue(card),
    detail: card.detail,
    tone: clampTone(card.tone),
  }));
}

export function buildConsumerFunnelSteps(funnel: AnalyticsConsumerFunnel | null): AnalyticsFunnelPresenterStep[] {
  return (funnel?.steps ?? []).map((step) => {
    const tone: AnalyticsTone = step.conversionRate >= 0.75 ? "green" : step.conversionRate >= 0.45 ? "orange" : "red";
    return {
      eventName: step.eventName,
      label: step.label,
      users: formatCount(step.users),
      events: formatCount(step.events),
      conversion: formatRate(step.conversionRate),
      dropoff: formatRate(step.dropoffRate),
      tone,
    };
  });
}

export function buildInvocationSignalCards(invocation: AnalyticsInvocationRevenue | null): AnalyticsSignalCard[] {
  return [
    {
      key: "success-rate",
      label: "Invoke Success Rate",
      value: formatRate(invocation?.successRate ?? 0),
      detail: `${formatCount(invocation?.invokeCompletedCount)} completed / ${formatCount(invocation?.invokeFailedCount)} failed`,
      tone: (invocation?.successRate ?? 0) >= 0.97 ? "green" : (invocation?.successRate ?? 0) >= 0.9 ? "orange" : "red",
    },
    {
      key: "latency-p95",
      label: "Latency P95",
      value: formatDurationMs(invocation?.latencyMs.p95),
      detail: `P50 ${formatDurationMs(invocation?.latencyMs.p50)} / P99 ${formatDurationMs(invocation?.latencyMs.p99 ?? 0)}`,
      tone: (invocation?.latencyMs.p95 ?? 0) > 5000 ? "red" : (invocation?.latencyMs.p95 ?? 0) > 1500 ? "orange" : "green",
    },
    {
      key: "gmv",
      label: "GMV",
      value: `${formatUsdc(invocation?.gmvUsdc ?? 0)} USDC`,
      detail: `Average price ${formatUsdc(invocation?.priceAvgUsdc ?? 0)} USDC`,
      tone: "green",
    },
  ];
}

export function buildProviderSignalCards(provider: AnalyticsProviderRevenue | null): AnalyticsSignalCard[] {
  return [
    {
      key: "revenue-providers",
      label: "Revenue Providers",
      value: formatCount(provider?.revenueProviderCount),
      detail: `${formatCount(provider?.firstRevenueProviderCount)} providers got first revenue`,
      tone: (provider?.revenueProviderCount ?? 0) > 0 ? "green" : "gray",
    },
    {
      key: "provider-net",
      label: "Provider Net",
      value: `${formatUsdc(provider?.providerNetUsdc ?? 0)} USDC`,
      detail: `Pending settlement ${formatUsdc(provider?.pendingSettlementUsdc ?? 0)} USDC`,
      tone: "green",
    },
    {
      key: "settlement-failures",
      label: "Settlement Failure",
      value: formatRate(provider?.settlementFailureRate ?? 0),
      detail: `P95 confirm ${formatDurationMs(provider?.settlementP95ConfirmMs)}`,
      tone: (provider?.settlementFailureRate ?? 0) > 0.05 ? "orange" : "green",
    },
  ];
}

export function buildMoneyFlowSignalCards(money: AnalyticsMoneyFlow | null): AnalyticsSignalCard[] {
  return [
    {
      key: "deposit",
      label: "Deposit",
      value: `${formatUsdc(money?.depositUsdc ?? 0)} USDC`,
      detail: `${formatCount(money?.depositFailedCount)} failed deposits`,
      tone: (money?.depositFailedCount ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "withdrawal",
      label: "Withdrawal",
      value: `${formatUsdc(money?.withdrawalUsdc ?? 0)} USDC`,
      detail: `${formatCount(money?.withdrawalFailedCount)} failed withdrawals`,
      tone: (money?.withdrawalFailedCount ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "ledger-context",
      label: "Ledger Context",
      value: `${formatUsdc(money?.financeContext.vaultLedgerDeltaUsdc ?? 0)} USDC`,
      detail: `${formatCount(money?.financeContext.chainConfirmedNotLedgerConfirmedCount)} chain confirmed, not ledger confirmed`,
      tone: Number(money?.financeContext.vaultLedgerDeltaUsdc ?? 0) > 0 ? "orange" : "green",
    },
  ];
}

export function buildRiskSignalCards(risk: AnalyticsRiskHealth | null): AnalyticsSignalCard[] {
  return [
    {
      key: "critical-risk",
      label: "Critical Risk",
      value: formatCount(risk?.criticalRiskEvents),
      detail: "High/critical risk_rule_triggered events.",
      tone: (risk?.criticalRiskEvents ?? 0) > 0 ? "red" : "green",
    },
    {
      key: "provider-health",
      label: "Provider Health",
      value: formatCount(risk?.providerHealthDegradedCount),
      detail: "provider_health_degraded events in the selected window.",
      tone: (risk?.providerHealthDegradedCount ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "budget-gap",
      label: "Budget Gap",
      value: `${formatUsdc(risk?.budgetGapUsdc ?? 0)} USDC`,
      detail: "required_usdc - available_usdc from budget_blocked.",
      tone: (risk?.budgetGapUsdc ?? 0) > 0 ? "orange" : "green",
    },
  ];
}

export function buildDataQualitySignalCards(dataQuality: AnalyticsDataQuality | null): AnalyticsSignalCard[] {
  const status = dataQuality?.overallStatus ?? "unknown";
  const criticalMissing = dataQuality?.criticalEventsFreshness.filter((event) => !event.seen).map((event) => event.eventName) ?? [];
  return [
    {
      key: "event-volume",
      label: "Event Volume",
      value: formatCount(dataQuality?.eventCount),
      detail: `Duplicate rate ${formatRate(dataQuality?.duplicateRate ?? 0)}`,
      tone: status === "degraded" ? "red" : status === "monitoring" ? "orange" : "green",
    },
    {
      key: "privacy",
      label: "Privacy Check",
      value: formatCount(dataQuality?.privacyViolations),
      detail: "raw wallet leakage checks on distinct_id and properties.",
      tone: (dataQuality?.privacyViolations ?? 0) > 0 ? "red" : "green",
    },
    {
      key: "freshness",
      label: "Critical Freshness",
      value: criticalMissing.length ? `${criticalMissing.length} missing` : "all visible",
      detail: criticalMissing.length ? criticalMissing.join(", ") : "page_viewed, wallet_connected, invoke_completed and deposit_completed are visible.",
      tone: criticalMissing.length ? "red" : "green",
    },
    {
      key: "fallback",
      label: "FileBackend Fallback",
      value: formatCount(dataQuality?.fileBackendFallbackEvents),
      detail: "Local/dev fallback events should not dominate production analytics.",
      tone: (dataQuality?.fileBackendFallbackEvents ?? 0) > 0 ? "orange" : "green",
    },
  ];
}

export function summarizeSourceCoverage(dataQuality: AnalyticsDataQuality | null): string {
  const entries = Object.entries(dataQuality?.sourceCoverage ?? {});
  if (!entries.length) {
    return "source coverage pending";
  }
  return entries.map(([source, count]) => `${source}: ${formatCount(count)}`).join(" / ");
}

export function summarizeCriticalFreshness(dataQuality: AnalyticsDataQuality | null): string {
  const latest = dataQuality?.criticalEventsFreshness
    .filter((event) => event.seen && event.lastSeenAt)
    .map((event) => `${event.eventName} ${formatDateTime(event.lastSeenAt)}`);
  return latest?.length ? latest.join(" / ") : "critical event freshness pending";
}
