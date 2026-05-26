import { compareMoneyStrings, formatDateTime, formatUsdc } from "@/lib/admin-console";
import type {
  AnalyticsConsumerFunnel,
  AnalyticsDataQuality,
  AnalyticsDistributionItem,
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
  statusLabel?: string;
};

export type AnalyticsFunnelSummaryCard = AnalyticsSignalCard;

export type AnalyticsDistributionPresenterItem = {
  key: string;
  label: string;
  count: string;
  value: string;
  rate: string;
};

export type AnalyticsSchemaIssueRow = {
  key: string;
  eventName: string;
  issue: string;
  count: string;
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
    return `${formatUsdc(typeof card.value === "number" ? card.value : String(card.value ?? "0"))} USDC`;
  }

  if (card.unit === "rate") {
    return formatRate(Number(card.value ?? 0));
  }

  if (card.unit === "count") {
    return formatCount(Number(card.value ?? 0));
  }

  return String(card.value ?? "n/a");
}

function consumerRateTone(value: number, denominator: number): AnalyticsTone {
  if (denominator <= 0 && value <= 0) {
    return "gray";
  }

  if (value >= 0.25) {
    return "green";
  }

  if (value >= 0.1) {
    return "orange";
  }

  return "red";
}

function consumerRateStatusLabel(tone: AnalyticsTone): string {
  if (tone === "gray") {
    return "No data";
  }

  if (tone === "red") {
    return "Low";
  }

  if (tone === "orange") {
    return "Watch";
  }

  return "Healthy";
}

function consumerThresholdTone(value: number, denominator: number, green: number, orange: number): AnalyticsTone {
  if (denominator <= 0 && value <= 0) {
    return "gray";
  }

  if (value >= green) {
    return "green";
  }

  if (value >= orange) {
    return "orange";
  }

  return "red";
}

function consumerStepUsers(funnel: AnalyticsConsumerFunnel | null, eventName: string): number {
  return funnel?.steps.find((step) => step.eventName === eventName)?.users ?? 0;
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

export function buildConsumerFunnelSummaryCards(funnel: AnalyticsConsumerFunnel | null): AnalyticsFunnelSummaryCard[] {
  const activationRate = funnel?.summary.activationRate ?? 0;
  const firstInvokeUsers = funnel?.summary.firstInvokeUsers ?? 0;
  const quoteToInvokeRate = funnel?.summary.quoteToInvokeRate ?? 0;
  const depositToFirstInvokeRate = funnel?.summary.depositToFirstInvokeRate ?? 0;
  const pageViewedUsers = consumerStepUsers(funnel, "page_viewed");
  const quoteUsers = consumerStepUsers(funnel, "quote_generated");
  const depositUsers = consumerStepUsers(funnel, "deposit_completed");
  const activationTone = consumerRateTone(activationRate, pageViewedUsers);
  const quoteToInvokeTone = consumerThresholdTone(quoteToInvokeRate, quoteUsers, 0.6, 0.35);
  const depositToFirstInvokeTone = consumerThresholdTone(depositToFirstInvokeRate, depositUsers, 0.5, 0.25);
  const firstInvokeTone: AnalyticsTone = firstInvokeUsers > 0 ? "green" : "gray";

  return [
    {
      key: "activation-rate",
      label: "Activation Rate",
      value: formatRate(activationRate),
      detail: "invoke_completed users / page_viewed users.",
      tone: activationTone,
      statusLabel: consumerRateStatusLabel(activationTone),
    },
    {
      key: "first-invoke-users",
      label: "First Invoke Users",
      value: formatCount(firstInvokeUsers),
      detail: "Users with is_first_invoke in invoke_completed.",
      tone: firstInvokeTone,
      statusLabel: firstInvokeUsers > 0 ? "Healthy" : "No data",
    },
    {
      key: "quote-to-invoke",
      label: "Quote To Invoke",
      value: formatRate(quoteToInvokeRate),
      detail: "invoke_completed users / quote_generated users.",
      tone: quoteToInvokeTone,
      statusLabel: consumerRateStatusLabel(quoteToInvokeTone),
    },
    {
      key: "deposit-to-first-invoke",
      label: "Deposit To First Invoke",
      value: formatRate(depositToFirstInvokeRate),
      detail: "first invoke users / deposit_completed users.",
      tone: depositToFirstInvokeTone,
      statusLabel: consumerRateStatusLabel(depositToFirstInvokeTone),
    },
  ];
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
      value: `${formatUsdc(invocation?.gmvUsdc ?? "0")} USDC`,
      detail: `Average price ${formatUsdc(invocation?.priceAvgUsdc ?? "0")} USDC`,
      tone: "green",
    },
  ];
}

export function buildInvocationVolumeCards(invocation: AnalyticsInvocationRevenue | null): AnalyticsSignalCard[] {
  return [
    {
      key: "quotes",
      label: "Quotes",
      value: formatCount(invocation?.quoteCount),
      detail: "quote_generated events.",
      tone: (invocation?.quoteCount ?? 0) > 0 ? "green" : "gray",
    },
    {
      key: "started",
      label: "Started",
      value: formatCount(invocation?.invokeStartedCount),
      detail: "invoke_started events accepted by Gateway.",
      tone: (invocation?.invokeStartedCount ?? 0) > 0 ? "green" : "gray",
    },
    {
      key: "failed",
      label: "Failed",
      value: formatCount(invocation?.invokeFailedCount),
      detail: "invoke_failed events across all stages.",
      tone: (invocation?.invokeFailedCount ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "platform-fee",
      label: "Platform Fee",
      value: `${formatUsdc(invocation?.platformFeeUsdc ?? "0")} USDC`,
      detail: "platform_fee_usdc from invocation revenue.",
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
      value: `${formatUsdc(provider?.providerNetUsdc ?? "0")} USDC`,
      detail: `Available to withdraw ${formatUsdc(provider?.pendingSettlementUsdc ?? "0")} USDC`,
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

export function buildProviderSettlementCards(provider: AnalyticsProviderRevenue | null): AnalyticsSignalCard[] {
  return [
    {
      key: "gross",
      label: "Provider Gross",
      value: `${formatUsdc(provider?.providerGrossUsdc ?? "0")} USDC`,
      detail: "gross_usdc from provider_revenue_received.",
      tone: "green",
    },
    {
      key: "completed-settlement",
      label: "Settlement Completed",
      value: `${formatUsdc(provider?.settlementCompletedUsdc ?? "0")} USDC`,
      detail: `Available to withdraw ${formatUsdc(provider?.pendingSettlementUsdc ?? "0")} USDC`,
      tone: compareMoneyStrings(provider?.pendingSettlementUsdc ?? "0", "0") > 0 ? "orange" : "green",
    },
    {
      key: "first-revenue",
      label: "First Revenue",
      value: formatCount(provider?.firstRevenueProviderCount),
      detail: `Average time since listing ${formatDurationMs(provider?.avgTimeSinceListingMs)}`,
      tone: (provider?.firstRevenueProviderCount ?? 0) > 0 ? "green" : "gray",
    },
  ];
}

export function buildMoneyFlowSignalCards(money: AnalyticsMoneyFlow | null): AnalyticsSignalCard[] {
  return [
    {
      key: "deposit",
      label: "Deposit",
      value: `${formatUsdc(money?.depositUsdc ?? "0")} USDC`,
      detail: `${formatCount(money?.depositFailedCount)} failed deposits`,
      tone: (money?.depositFailedCount ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "withdrawal",
      label: "Withdrawal",
      value: `${formatUsdc(money?.withdrawalUsdc ?? "0")} USDC`,
      detail: `${formatCount(money?.withdrawalFailedCount)} failed withdrawals`,
      tone: (money?.withdrawalFailedCount ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "ledger-context",
      label: "Ledger Context",
      value: `${formatUsdc(money?.financeContext.vaultLedgerDeltaUsdc ?? "0")} USDC`,
      detail: `${formatCount(money?.financeContext.chainConfirmedNotLedgerConfirmedCount)} chain confirmed, not ledger confirmed`,
      tone: compareMoneyStrings(money?.financeContext.vaultLedgerDeltaUsdc ?? "0", "0") > 0 ? "orange" : "green",
    },
  ];
}

export function buildMoneyFlowContextCards(money: AnalyticsMoneyFlow | null): AnalyticsSignalCard[] {
  return [
    {
      key: "refund",
      label: "Refund",
      value: `${formatUsdc(money?.refundUsdc ?? "0")} USDC`,
      detail: "refund_completed amount in the selected window.",
      tone: compareMoneyStrings(money?.refundUsdc ?? "0", "0") > 0 ? "orange" : "green",
    },
    {
      key: "confirm-p95",
      label: "Confirm P95",
      value: formatDurationMs(money?.confirmLatencyMs.p95),
      detail: `P50 ${formatDurationMs(money?.confirmLatencyMs.p50)}`,
      tone: (money?.confirmLatencyMs.p95 ?? 0) > 180000 ? "orange" : "green",
    },
    {
      key: "pending-deposits",
      label: "Pending Deposits",
      value: formatCount(money?.financeContext.pendingDepositCount),
      detail: `${formatCount(money?.financeContext.pendingWithdrawalCount)} pending withdrawals`,
      tone: (money?.financeContext.pendingDepositCount ?? 0) + (money?.financeContext.pendingWithdrawalCount ?? 0) > 0 ? "orange" : "green",
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
      value: `${formatUsdc(risk?.budgetGapUsdc ?? "0")} USDC`,
      detail: "required_usdc - available_usdc from budget_blocked.",
      tone: compareMoneyStrings(risk?.budgetGapUsdc ?? "0", "0") > 0 ? "orange" : "green",
    },
  ];
}

export function buildRiskContextCards(risk: AnalyticsRiskHealth | null): AnalyticsSignalCard[] {
  return [
    {
      key: "surfaces",
      label: "Risk Surfaces",
      value: formatCount(risk?.surfaces.length),
      detail: "Distinct surfaces from risk_rule_triggered.",
      tone: (risk?.surfaces.length ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "refund-reasons",
      label: "Refund Reasons",
      value: formatCount(risk?.refundReasons.length),
      detail: "Reason distribution from refund_completed.",
      tone: (risk?.refundReasons.length ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "degraded-providers",
      label: "Degraded Providers",
      value: formatCount(risk?.degradedProviders.length),
      detail: "Providers with provider_health_degraded events.",
      tone: (risk?.degradedProviders.length ?? 0) > 0 ? "orange" : "green",
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

export function buildDataQualityLagCards(dataQuality: AnalyticsDataQuality | null): AnalyticsSignalCard[] {
  return [
    {
      key: "missing-required",
      label: "Missing Required",
      value: formatCount(dataQuality?.missingRequiredProperties),
      detail: "Events missing required properties.",
      tone: (dataQuality?.missingRequiredProperties ?? 0) > 0 ? "orange" : "green",
    },
    {
      key: "xor-violations",
      label: "XOR Violations",
      value: formatCount(dataQuality?.xorViolations),
      detail: "invoke_completed XOR invoke_failed final-state violations.",
      tone: (dataQuality?.xorViolations ?? 0) > 0 ? "red" : "green",
    },
    {
      key: "stream-lag",
      label: "Stream Lag",
      value: `${formatCount(dataQuality?.kafkaLag)} / ${formatCount(dataQuality?.clickhouseLag)}`,
      detail: "Kafka lag / ClickHouse lag.",
      tone: (dataQuality?.kafkaLag ?? 0) + (dataQuality?.clickhouseLag ?? 0) > 0 ? "orange" : "green",
    },
  ];
}

export function buildDistributionItems(items: AnalyticsDistributionItem[] | null | undefined): AnalyticsDistributionPresenterItem[] {
  return (items ?? []).map((item) => ({
    key: item.key,
    label: item.label,
    count: formatCount(item.count),
    value: formatUsdc(item.value),
    rate: item.rate === undefined ? "n/a" : formatRate(item.rate),
  }));
}

export function buildDataQualitySchemaIssueRows(dataQuality: AnalyticsDataQuality | null): AnalyticsSchemaIssueRow[] {
  return (dataQuality?.schemaIssueSamples ?? []).map((item) => ({
    key: `${item.eventName}-${item.issue}`,
    eventName: item.eventName,
    issue: item.issue,
    count: formatCount(item.count),
  }));
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
