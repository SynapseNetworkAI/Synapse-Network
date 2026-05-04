import {
  clearAdminCsrfToken,
  readAdminCsrfTokenFromStorage,
  saveAdminCsrfToken,
} from "@/lib/admin-csrf-token";
import {
  assertApprovalStatus,
  assertExecutionJobStatus,
  assertProviderServiceStatus,
  assertRiskLevel,
  assertWithdrawalStatus,
  type ApprovalStatus,
  type ExecutionJobStatus,
  type ProviderServiceStatus,
  type RiskLevel,
  type WithdrawalStatus,
} from "@/domain/status";
import {
  buildAdminRequestUrl as buildAdminRequestUrlFromBase,
  shouldUseSameOriginAdminProxy,
} from "./admin-api-url";
import {
  AdminApiError,
  isAdminApiError,
  isExpiredAdminSession,
} from "./admin-api-errors";

export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  requestId: string;
};

export type ApiErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
  data?: unknown;
};

export { AdminApiError, isAdminApiError };

export type AdminProfile = {
  adminId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
};

export type LoginResponse = {
  expiresIn: number;
  csrfToken: string;
  admin: AdminProfile;
  security: AdminAuthSecurityPolicy;
};

export type AdminAuthSecurityPolicy = {
  loginTotpRequired: boolean;
  highRiskTotpRequired: boolean;
  totpIssuer: string;
};

export type MfaEnrollmentRequiredData = {
  enrollmentToken: string;
  expiresIn: number;
  maskedEmail: string;
  totpIssuer: string;
};

export type MfaEnrollBeginResponse = {
  factorId: string;
  issuer: string;
  accountName: string;
  otpauthUrl: string;
  manualEntryKey: string;
  expiresIn: number;
};

let adminCsrfToken: string | null = null;

function setAdminCsrfToken(token: string | null): void {
  adminCsrfToken = token;
  saveAdminCsrfToken(token);
}

function readAdminCsrfToken(): string | null {
  if (adminCsrfToken) {
    return adminCsrfToken;
  }

  const persistedToken = readAdminCsrfTokenFromStorage();
  if (persistedToken) {
    adminCsrfToken = persistedToken;
  }
  return persistedToken;
}

function redirectToLoginOnExpiredSession(): void {
  setAdminCsrfToken(null);
  clearAdminCsrfToken();

  if (globalThis.window === undefined) {
    return;
  }

  if (globalThis.window.location.pathname === "/login") {
    return;
  }

  globalThis.window.location.replace("/login");
}

function isSafeMethod(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return (
    normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS"
  );
}

export type DashboardOverview = {
  metrics: {
    pendingApprovals: number;
    depositExceptions: number;
    auditAlerts: number;
    vaultLedgerDelta: string;
  };
  highlights: Array<{
    title: string;
    value: string;
    trend: string;
  }>;
};

export type SystemStatus = {
  gatewayAdmin: string;
  gateway: string;
  approvalQueueDepth: number;
  lastReconciliationAt: string | null;
};

export type DashboardDiagnosticSignal = {
  signalId: string;
  label: string;
  status: string;
  value: string;
  detail: string;
};

export type DashboardDiagnosticAction = {
  actionId: string;
  label: string;
  href: string;
  detail: string;
  status: string;
};

export type DashboardDiagnostics = {
  overallStatus: string;
  checkedAt: string;
  summary: string;
  signals: DashboardDiagnosticSignal[];
  actions: DashboardDiagnosticAction[];
};

export type AnalyticsWindow = "24h" | "7d" | "30d";
export type AnalyticsDataQualityWindow = "1h" | "24h";

export type AnalyticsMetricCard = {
  key: string;
  label: string;
  value: string | number;
  unit: string;
  tone: "green" | "orange" | "red" | "gray" | string;
  detail: string;
};

export type AnalyticsAlert = {
  severity: string;
  title: string;
  detail: string;
  href?: string | null;
};

export type AnalyticsOverview = {
  window: string;
  overallStatus: string;
  cards: AnalyticsMetricCard[];
  alerts: AnalyticsAlert[];
};

export type AnalyticsFunnelStep = {
  eventName: string;
  label: string;
  users: number;
  events: number;
  conversionRate: number;
  dropoffRate: number;
};

export type AnalyticsConsumerFunnel = {
  window: string;
  steps: AnalyticsFunnelStep[];
  summary: {
    activationRate: number;
    firstInvokeUsers: number;
    quoteToInvokeRate: number;
    depositToFirstInvokeRate: number;
  };
};

export type AnalyticsDistributionItem = {
  key: string;
  label: string;
  count: number;
  value: number;
  rate?: number;
};

export type AnalyticsLatencyPercentiles = {
  p50: number;
  p95: number;
  p99?: number | null;
};

export type AnalyticsInvocationTrendPoint = {
  bucket: string;
  invokeCompleted: number;
  invokeFailed: number;
  gmvUsdc: string;
  platformFeeUsdc: string;
  providerNetUsdc: string;
};

export type AnalyticsInvocationRevenue = {
  window: string;
  quoteCount: number;
  invokeStartedCount: number;
  invokeCompletedCount: number;
  invokeFailedCount: number;
  successRate: number;
  gmvUsdc: string;
  priceAvgUsdc: string;
  platformFeeUsdc: string;
  providerNetUsdc: string;
  latencyMs: AnalyticsLatencyPercentiles;
  failureStages: AnalyticsDistributionItem[];
  errorCodes: AnalyticsDistributionItem[];
  trend: AnalyticsInvocationTrendPoint[];
};

export type AnalyticsProviderRevenue = {
  window: string;
  revenueProviderCount: number;
  firstRevenueProviderCount: number;
  avgTimeSinceListingMs: number;
  providerGrossUsdc: string;
  platformFeeUsdc: string;
  providerNetUsdc: string;
  pendingSettlementUsdc: string;
  settlementCompletedUsdc: string;
  settlementFailureRate: number;
  settlementP95ConfirmMs: number;
  settlementFunnel: Array<{
    eventName: string;
    label: string;
    count: number;
    amountUsdc: string;
    conversionRate: number;
  }>;
  topProviders: Array<{
    providerId: string;
    serviceId: string;
    grossUsdc: string;
    providerNetUsdc: string;
    invokeCount: number;
  }>;
};

export type AnalyticsDepositFailureSample = {
  timestamp: string;
  errorCode: string;
  amountUsdc: string;
  env: string;
  correlationId: string;
  txHash: string;
};

export type AnalyticsMoneyFlow = {
  window: string;
  depositUsdc: string;
  depositFailedCount: number;
  withdrawalUsdc: string;
  withdrawalFailedCount: number;
  refundUsdc: string;
  confirmLatencyMs: AnalyticsLatencyPercentiles;
  depositErrors: AnalyticsDistributionItem[];
  depositFailureSamples: AnalyticsDepositFailureSample[];
  withdrawalErrors: AnalyticsDistributionItem[];
  financeContext: {
    pendingDepositCount: number;
    pendingWithdrawalCount: number;
    vaultLedgerDeltaUsdc: string;
    chainConfirmedNotLedgerConfirmedCount: number;
  };
};

export type AnalyticsBudgetBlock = {
  key: string;
  errorCode: string;
  serviceId: string;
  surface: string;
  count: number;
  requiredUsdc: string;
  availableUsdc: string;
  gapUsdc: string;
};

export type AnalyticsBudgetBlockSample = {
  timestamp: string;
  serviceId: string;
  errorCode: string;
  requiredUsdc: string;
  availableUsdc: string;
  correlationId: string;
  surface: string;
};

export type AnalyticsRiskHealth = {
  window: string;
  criticalRiskEvents: number;
  riskRules: AnalyticsDistributionItem[];
  surfaces: AnalyticsDistributionItem[];
  providerHealthDegradedCount: number;
  degradedProviders: Array<{
    providerId: string;
    serviceId: string;
    count: number;
    reason: string;
  }>;
  budgetGapUsdc: string;
  budgetBlocks: AnalyticsBudgetBlock[];
  budgetBlockSamples: AnalyticsBudgetBlockSample[];
  refundReasons: AnalyticsDistributionItem[];
};

export type AnalyticsDataQuality = {
  window: string;
  overallStatus: string;
  eventCount: number;
  duplicateRate: number;
  criticalEventsFreshness: Array<{
    eventName: string;
    seen: boolean;
    lastSeenAt: string;
    count: number;
  }>;
  sourceCoverage: Record<string, number>;
  privacyViolations: number;
  missingRequiredProperties: number;
  xorViolations: number;
  kafkaLag: number;
  clickhouseLag: number;
  fileBackendFallbackEvents: number;
  schemaIssueSamples: Array<{
    eventName: string;
    issue: string;
    count: number;
  }>;
};

export type ForumTopicContext = {
  topicId: string;
  title: string;
  body: string;
  excerpt: string;
  category: string;
  authorAddress: string;
  authorDisplay: string;
  authorRoles: string[];
  status: string;
  resolved: boolean;
  locked: boolean;
  pinned: boolean;
  viewsCount: number;
  repliesCount: number;
  officialRepliesCount: number;
  closedReason: string | null;
  closedByAdminId: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
};

export type ForumTopicEvent = {
  eventId: string;
  topicId: string;
  actorAdminId: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

export type ForumResponseTask = {
  responseTaskId: string;
  topicId: string;
  status:
    | "awaiting_response"
    | "draft_ready"
    | "responded"
    | "ignored"
    | "closed"
    | string;
  source: string;
  priority: "low" | "normal" | "high" | "critical" | string;
  classification:
    | "question"
    | "bug"
    | "feature_request"
    | "docs_issue"
    | "needs_more_info"
    | "spam"
    | string
    | null;
  suggestedReply: string | null;
  suggestedReplySource: string | null;
  suggestedReplyUpdatedAt: string | null;
  repliedByAdminId: string | null;
  replyId: string | null;
  respondedAt: string | null;
  linkedRequirementCandidateId: string | null;
  linkedRequirementId: string | null;
  linkedWorkflowRunId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  topic: ForumTopicContext | null;
};

export type ForumResponseTaskListResponse = {
  items: ForumResponseTask[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export type ForumTopicListResponse = {
  items: ForumTopicContext[];
  pagination: ForumResponseTaskListResponse["pagination"];
};

export type ForumTopicDetailResponse = {
  topic: ForumTopicContext;
  responseTask: ForumResponseTask | null;
  events: ForumTopicEvent[];
};

export type FinanceOverview = {
  todayChargeUsdc: string;
  todayDepositUsdc: string;
  todayRefundUsdc: string;
  todayWithdrawalUsdc: string;
  todayInvocationCount: number;
  todayPlatformFeeEarnedUsdc: string;
  todayProviderEarnedUsdc: string;
  ownerLiabilityUsdc: string;
  refundableConsumerBalanceUsdc: string;
  providerPayableUsdc: string;
  providerAvailableToWithdrawUsdc: string;
  providerLockedBalanceUsdc: string;
  platformFeeBalanceUsdc: string;
  vaultLedgerDeltaUsdc: string;
  pendingDepositCount: number;
  pendingWithdrawalCount: number;
  projectedAt: string | null;
};

export type ActivityTrendPoint = {
  bucketDate: string;
  depositUsdc: string;
  chargeUsdc: string;
  invocationCount: number;
  platformFeeEarnedUsdc: string;
  providerEarnedUsdc: string;
  refundUsdc: string;
  withdrawalUsdc: string;
  netFlowUsdc: string;
};

export type ActivityTrendSeries = {
  points: ActivityTrendPoint[];
};

export type OperationsOverview = {
  gatewayStatus: string;
  indexerRunning: boolean;
  indexerStatus: string;
  indexerLastProcessedAt: string | null;
  indexerLastHeartbeatAt: string | null;
  indexerLastError: string | null;
  indexerPollIntervalSec: number;
  backfillEnabled: boolean;
  backfillStatus: string;
  backfillLastScanAt: string | null;
  backfillLastScannedBlock: number | null;
  backfillLastRecovered: number;
  backfillLastError: string | null;
  recentGatewayFailures: number;
  failedDepositCount: number;
  recentAuditAlerts: number;
  reconciliationEnabled: boolean;
  reconciliationStatus: string;
  lastReconciliationAt: string | null;
  reconciliationAlert: boolean;
  reconciliationDeltaUsdc: string;
  reconciliationLastError: string | null;
  projectedAt: string | null;
};

export type ReconciliationApprovalItem = {
  approvalId: string;
  approvalType: string;
  status: ApprovalStatus;
  approvalLevel: string;
  requesterRole: string;
  amountUsdc: string;
  createdAt: string;
  ownerAddress: string | null;
  requestId: string | null;
  txHash: string | null;
};

export type ReconciliationDetail = {
  gatewayStatus: string;
  reconciliationAlert: boolean;
  reconciliationDeltaUsdc: string;
  signedDifferenceUsdc: string | null;
  imbalanceDirection: string;
  chainVaultUsdc: string | null;
  ledgerObligationUsdc: string | null;
  lastReconciliationAt: string | null;
  runtimeStateUpdatedAt: string | null;
  reconciliationLastError: string | null;
  pendingApprovals: number;
  depositExceptions: number;
  auditAlerts: number;
  pendingDepositCount: number;
  pendingWithdrawalCount: number;
  todayRefundUsdc: string;
  todayWithdrawalUsdc: string;
  ownerLiabilityUsdc: string;
  providerPayableUsdc: string;
  platformFeeBalanceUsdc: string;
  chainConfirmedNotLedgerConfirmedCount: number;
  depositP95SyncDelaySeconds: number;
  recentlyCompletedOutflowsUsdc: string;
  projectedAt: string | null;
  priorityApprovals: ReconciliationApprovalItem[];
  depositRepairApprovals: ReconciliationApprovalItem[];
  pendingWithdrawalReviews: ProviderWithdrawReviewItem[];
};

export type ReconciliationDrilldownResult = {
  ownerAddress: string | null;
  requestId: string | null;
  txHash: string | null;
  priorityApprovals: ReconciliationApprovalItem[];
  depositRepairApprovals: ReconciliationApprovalItem[];
  pendingWithdrawalReviews: ProviderWithdrawReviewItem[];
};

export type ApprovalItem = {
  approvalId: string;
  approvalType: string;
  status: ApprovalStatus;
  approvalLevel: string;
  requesterRole: string;
  amountUsdc: string;
  createdAt: string;
};

export type ApprovalListResponse = {
  items: ApprovalItem[];
  nextCursor: string | null;
};

export type ProviderWithdrawReviewItem = {
  withdrawalId: string;
  withdrawalKind: "provider_withdrawal" | "consumer_refund";
  reviewType: "provider_withdraw_review" | "consumer_withdraw_review";
  ownerAddress: string;
  subjectAddress: string;
  amountUsdc: string;
  status: WithdrawalStatus;
  requestId: string | null;
  txHash: string | null;
  riskLevel: RiskLevel | null;
  riskReasonCode: string | null;
  evidenceSummary: string | null;
  message: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProviderWithdrawReviewListResponse = {
  items: ProviderWithdrawReviewItem[];
  nextCursor: string | null;
};

export type ProviderWithdrawReviewDecisionResult = {
  withdrawalId: string;
  withdrawalKind: "provider_withdrawal" | "consumer_refund";
  reviewType: "provider_withdraw_review" | "consumer_withdraw_review";
  ownerAddress: string;
  subjectAddress: string;
  reviewDecision: string;
  status: WithdrawalStatus;
  message: string | null;
  requestedBy: string | null;
  ticket: Record<string, unknown>;
};

export type ProviderWithdrawReviewHistoryItem = {
  withdrawalId: string;
  withdrawalKind: "provider_withdrawal" | "consumer_refund";
  reviewType: "provider_withdraw_review" | "consumer_withdraw_review";
  ownerAddress: string | null;
  subjectAddress: string | null;
  amountUsdc: string | null;
  requestId: string | null;
  txHash: string | null;
  riskLevel: RiskLevel | null;
  riskReasonCode: string | null;
  evidenceSummary: string | null;
  reviewDecision: string;
  currentStatus: WithdrawalStatus;
  reviewerEmail: string | null;
  reviewerRole: string | null;
  reviewerNote: string | null;
  message: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  reviewedAt: string | null;
};

export type ProviderWithdrawReviewHistoryListResponse = {
  items: ProviderWithdrawReviewHistoryItem[];
  nextCursor: string | null;
  totalCount: number;
  totalPages: number;
};

export type ProviderServiceItem = {
  serviceId: string;
  ownerAddress: string;
  serviceName: string;
  summary: string;
  tags: string[];
  pricing: {
    amount: string;
    currency: string;
  };
  controlStatus: ProviderServiceStatus;
  status: ProviderServiceStatus;
  isActive: boolean;
  runtimeStatus: ProviderServiceStatus;
  runtimeAvailable: boolean;
  probeTier: string;
  health: {
    overallStatus?: string;
    probeStatus?: string;
    healthyTargets?: number;
    totalTargets?: number;
    lastCheckedAt?: number | null;
    isStale?: boolean;
    runtimeAvailable?: boolean;
    probeTier?: string;
  };
  targets: Array<{
    targetUrl: string;
    status: ProviderServiceStatus;
    httpStatus?: number | null;
    latencyMs?: number | null;
    consecutiveSuccesses?: number;
    consecutiveFailures?: number;
    lastCheckedAt?: number | null;
    lastHealthyAt?: number | null;
    error?: string | null;
  }>;
  adaptiveConcurrencyLimit: number;
  inFlight: number;
  queueDepth: number;
  latencyP95Ms: number;
  errorRate: number;
  circuitState: string;
  lastConcurrencyAdjustmentAt: number | null;
  downstreamTargets: Array<{
    targetUrl: string;
    adaptiveConcurrencyLimit: number;
    inFlight: number;
    queueDepth: number;
    latencyP95Ms: number;
    errorRate: number;
    circuitState: string;
    lastConcurrencyAdjustmentAt: number | null;
  }>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProviderServiceListResponse = {
  items: ProviderServiceItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type ProviderServiceActionResponse = {
  service: ProviderServiceItem;
};

export type ProviderServiceDeleteResponse = {
  serviceId: string;
  status: ProviderServiceStatus;
};

export type AuditActionItem = {
  auditId: number | null;
  actionType: string;
  resultStatus: string;
  operatorId: string | null;
  operatorEmail: string | null;
  operatorRole: string | null;
  approvalId: string | null;
  jobId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  errorCode: string | null;
  createdAt: string | null;
};

export type AuditActionListResponse = {
  items: AuditActionItem[];
  nextCursor: string | null;
};

export type ExecutionAttemptItem = {
  attemptNo: number;
  status: ExecutionJobStatus;
  errorCode: string | null;
  errorSummary: string | null;
  finishedAt: string | null;
};

export type ExecutionJobItem = {
  jobId: string;
  approvalId: string;
  executionType: string;
  targetSystem: string;
  status: ExecutionJobStatus;
  idempotencyKey: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetryCount: number;
  queuedBy: string | null;
  updatedAt: string | null;
  attempts: ExecutionAttemptItem[];
};

export type ExecutionJobListResponse = {
  items: ExecutionJobItem[];
  nextCursor: string | null;
};

export type ExecutionRetryResult = {
  jobId: string;
  status: ExecutionJobStatus;
  retryCount: number;
};

type RawReconciliationApprovalItem = Omit<
  ReconciliationApprovalItem,
  "status"
> & { status: string };
type RawApprovalItem = Omit<ApprovalItem, "status"> & { status: string };
type RawProviderWithdrawReviewItem = Omit<
  ProviderWithdrawReviewItem,
  "status" | "riskLevel" | "withdrawalKind" | "reviewType" | "subjectAddress"
> & {
  status: string;
  riskLevel: string | null;
  withdrawalKind?: ProviderWithdrawReviewItem["withdrawalKind"];
  reviewType?: ProviderWithdrawReviewItem["reviewType"];
  subjectAddress?: string | null;
};
type RawProviderWithdrawReviewDecisionResult = Omit<
  ProviderWithdrawReviewDecisionResult,
  "status" | "withdrawalKind" | "reviewType" | "subjectAddress"
> & {
  status: string;
  withdrawalKind?: ProviderWithdrawReviewDecisionResult["withdrawalKind"];
  reviewType?: ProviderWithdrawReviewDecisionResult["reviewType"];
  subjectAddress?: string | null;
};
type RawProviderWithdrawReviewHistoryItem = Omit<
  ProviderWithdrawReviewHistoryItem,
  | "currentStatus"
  | "riskLevel"
  | "withdrawalKind"
  | "reviewType"
  | "subjectAddress"
> & {
  currentStatus: string;
  riskLevel: string | null;
  withdrawalKind?: ProviderWithdrawReviewHistoryItem["withdrawalKind"];
  reviewType?: ProviderWithdrawReviewHistoryItem["reviewType"];
  subjectAddress?: string | null;
};
type RawProviderServiceItem = Omit<
  ProviderServiceItem,
  "controlStatus" | "status" | "runtimeStatus" | "targets"
> & {
  controlStatus: string;
  status: string;
  runtimeStatus: string;
  targets: Array<
    Omit<ProviderServiceItem["targets"][number], "status"> & { status: string }
  >;
};
type RawProviderServiceDeleteResponse = Omit<
  ProviderServiceDeleteResponse,
  "status"
> & { status: string };
type RawExecutionAttemptItem = Omit<ExecutionAttemptItem, "status"> & {
  status: string;
};
type RawExecutionJobItem = Omit<ExecutionJobItem, "status" | "attempts"> & {
  status: string;
  attempts: RawExecutionAttemptItem[];
};
type RawExecutionRetryResult = Omit<ExecutionRetryResult, "status"> & {
  status: string;
};
type RawReconciliationDetail = Omit<
  ReconciliationDetail,
  "priorityApprovals" | "depositRepairApprovals" | "pendingWithdrawalReviews"
> & {
  priorityApprovals: RawReconciliationApprovalItem[];
  depositRepairApprovals: RawReconciliationApprovalItem[];
  pendingWithdrawalReviews: RawProviderWithdrawReviewItem[];
};

function numericOrZero(value: unknown): number {
  return Number(value ?? 0);
}

function normalizeProviderServiceTargets(
  item: RawProviderServiceItem
): ProviderServiceItem["targets"] {
  return item.targets.map((target) => ({
    ...target,
    status: assertProviderServiceStatus(target.status),
  }));
}

function normalizeDownstreamTargets(
  item: RawProviderServiceItem
): ProviderServiceItem["downstreamTargets"] {
  return Array.isArray(item.downstreamTargets) ? item.downstreamTargets : [];
}
type RawReconciliationDrilldownResult = Omit<
  ReconciliationDrilldownResult,
  "priorityApprovals" | "depositRepairApprovals" | "pendingWithdrawalReviews"
> & {
  priorityApprovals: RawReconciliationApprovalItem[];
  depositRepairApprovals: RawReconciliationApprovalItem[];
  pendingWithdrawalReviews: RawProviderWithdrawReviewItem[];
};
type RawApprovalListResponse = {
  items: RawApprovalItem[];
  nextCursor: string | null;
};
type RawProviderWithdrawReviewListResponse = {
  items: RawProviderWithdrawReviewItem[];
  nextCursor: string | null;
};
type RawProviderWithdrawReviewHistoryListResponse = Omit<
  ProviderWithdrawReviewHistoryListResponse,
  "items"
> & {
  items: RawProviderWithdrawReviewHistoryItem[];
};
type RawProviderServiceListResponse = Omit<
  ProviderServiceListResponse,
  "items"
> & { items: RawProviderServiceItem[] };
type RawProviderServiceActionResponse = { service: RawProviderServiceItem };
type RawExecutionJobListResponse = {
  items: RawExecutionJobItem[];
  nextCursor: string | null;
};

function normalizeApprovalItem(item: RawApprovalItem): ApprovalItem {
  return {
    ...item,
    status: assertApprovalStatus(item.status),
  };
}

function normalizeReconciliationApprovalItem(
  item: RawReconciliationApprovalItem
): ReconciliationApprovalItem {
  return {
    ...item,
    status: assertApprovalStatus(item.status),
  };
}

function normalizeProviderWithdrawReviewItem(
  item: RawProviderWithdrawReviewItem
): ProviderWithdrawReviewItem {
  const withdrawalKind = item.withdrawalKind ?? "provider_withdrawal";
  return {
    ...item,
    withdrawalKind,
    reviewType:
      item.reviewType ??
      (withdrawalKind === "consumer_refund"
        ? "consumer_withdraw_review"
        : "provider_withdraw_review"),
    subjectAddress: item.subjectAddress ?? item.ownerAddress,
    status: assertWithdrawalStatus(item.status),
    riskLevel: item.riskLevel === null ? null : assertRiskLevel(item.riskLevel),
  };
}

function normalizeProviderWithdrawReviewHistoryItem(
  item: RawProviderWithdrawReviewHistoryItem
): ProviderWithdrawReviewHistoryItem {
  const withdrawalKind = item.withdrawalKind ?? "provider_withdrawal";
  return {
    ...item,
    withdrawalKind,
    reviewType:
      item.reviewType ??
      (withdrawalKind === "consumer_refund"
        ? "consumer_withdraw_review"
        : "provider_withdraw_review"),
    subjectAddress: item.subjectAddress ?? item.ownerAddress,
    currentStatus: assertWithdrawalStatus(item.currentStatus),
    riskLevel: item.riskLevel === null ? null : assertRiskLevel(item.riskLevel),
  };
}

function normalizeProviderServiceItem(
  item: RawProviderServiceItem
): ProviderServiceItem {
  return {
    ...item,
    controlStatus: assertProviderServiceStatus(item.controlStatus),
    status: assertProviderServiceStatus(item.status),
    runtimeStatus: assertProviderServiceStatus(item.runtimeStatus),
    adaptiveConcurrencyLimit: numericOrZero(item.adaptiveConcurrencyLimit),
    inFlight: numericOrZero(item.inFlight),
    queueDepth: numericOrZero(item.queueDepth),
    latencyP95Ms: numericOrZero(item.latencyP95Ms),
    errorRate: numericOrZero(item.errorRate),
    circuitState: String(item.circuitState ?? "closed"),
    lastConcurrencyAdjustmentAt: item.lastConcurrencyAdjustmentAt ?? null,
    downstreamTargets: normalizeDownstreamTargets(item),
    targets: normalizeProviderServiceTargets(item),
  };
}

function normalizeExecutionAttemptItem(
  item: RawExecutionAttemptItem
): ExecutionAttemptItem {
  return {
    ...item,
    status: assertExecutionJobStatus(item.status),
  };
}

function normalizeExecutionJobItem(
  item: RawExecutionJobItem
): ExecutionJobItem {
  return {
    ...item,
    status: assertExecutionJobStatus(item.status),
    attempts: item.attempts.map(normalizeExecutionAttemptItem),
  };
}

export type AdminUserItem = {
  adminId: string;
  email: string;
  displayName: string;
  status: string;
  authSource: string;
  requireMfa: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  roleKeys: string[];
  permissions: string[];
};

export type AdminUserListResponse = {
  items: AdminUserItem[];
  nextCursor: string | null;
};

export type AdminRoleCatalogItem = {
  roleKey: string;
  roleName: string;
  description: string | null;
  status: string;
  permissions: string[];
};

export type AdminPermissionCatalogItem = {
  permissionKey: string;
  resourceDomain: string;
  action: string;
  riskLevel: string;
  description: string | null;
};

export type AdminRoleCatalogResponse = {
  items: AdminRoleCatalogItem[];
};

export type AdminPermissionCatalogResponse = {
  items: AdminPermissionCatalogItem[];
};

export type CreateAdminUserResponse = {
  admin: AdminUserItem;
};

export type UpdateAdminUserResponse = {
  admin: AdminUserItem;
};

export type DeleteAdminUserResponse = {
  adminId: string;
  status: string;
};

export type CreateAdminRoleResponse = {
  role: AdminRoleCatalogItem;
};

export type UpdateAdminRoleResponse = {
  role: AdminRoleCatalogItem;
};

export type DeleteAdminRoleResponse = {
  roleKey: string;
  status: string;
};

export type AdminMenuConfigItem = {
  itemId: string;
  sectionId: string;
  sectionLabel: string;
  sectionDescription: string;
  label: string;
  href: string | null;
  description: string;
  parentItemId: string | null;
  nodeType: "category" | "page" | "panel";
  iconKey: string;
  requiredRoles: string[];
  requiredPermissions: string[];
  sortOrder: number;
  keywords: string[];
};

export type AdminMenuConfigMeta = {
  draftVersion: number;
  publishedVersion: number;
  isDirty: boolean;
  updatedAt: string | null;
  publishedAt: string | null;
  updatedBy: string | null;
  publishedBy: string | null;
};

export type AdminMenuConfigResponse = {
  items: AdminMenuConfigItem[];
  meta: AdminMenuConfigMeta;
};

export function resolveAdminApiBaseUrl(baseUrl: string | undefined): string {
  const normalized = baseUrl?.trim().replace(/\/$/, "");
  return normalized && normalized.length > 0 ? normalized : "";
}

const ADMIN_API_BASE_URL = resolveAdminApiBaseUrl(
  process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL
);

export { shouldUseSameOriginAdminProxy };

export function buildAdminRequestUrl(
  path: string,
  baseUrl = ADMIN_API_BASE_URL,
  currentLocation?: Pick<Location, "hostname" | "origin" | "protocol">
): string {
  return buildAdminRequestUrlFromBase(path, baseUrl, currentLocation);
}

function buildRequestUrl(path: string): string {
  return buildAdminRequestUrl(path);
}

export function buildPath(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  if (!params) {
    return path;
  }
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function buildHeaders(init?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...init,
  };
}

function requiresAdminCsrf(path: string, method: string): boolean {
  if (isSafeMethod(method)) {
    return false;
  }

  if (
    path === "/api/admin/v1/auth/login" ||
    path === "/api/admin/v1/auth/mfa/enroll/begin" ||
    path === "/api/admin/v1/auth/mfa/enroll/verify"
  ) {
    return false;
  }

  return true;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const headers = new Headers(buildHeaders(init?.headers));
  if (requiresAdminCsrf(path, method)) {
    const csrfToken = readAdminCsrfToken();
    if (!csrfToken) {
      throw new Error("Missing admin CSRF token");
    }
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(buildRequestUrl(path), {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include",
  });

  const body = (await response.json()) as ApiEnvelope<T> | ApiErrorEnvelope;
  if (!response.ok || !body.success) {
    const message =
      "error" in body
        ? body.error.message
        : `Request failed: ${response.status}`;
    const code = "error" in body ? body.error.code : null;
    if (isExpiredAdminSession(response.status, code, message)) {
      redirectToLoginOnExpiredSession();
    }
    throw new AdminApiError(message, {
      status: response.status,
      code,
      requestId: body.requestId,
      data: "data" in body ? body.data : undefined,
    });
  }
  return body.data;
}

export async function loginAdmin(input: {
  email: string;
  password: string;
  otpCode?: string;
}): Promise<LoginResponse> {
  const session = await request<LoginResponse>("/api/admin/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  setAdminCsrfToken(session.csrfToken);
  return session;
}

export async function beginAdminMfaEnrollment(
  enrollmentToken: string
): Promise<MfaEnrollBeginResponse> {
  return request<MfaEnrollBeginResponse>(
    "/api/admin/v1/auth/mfa/enroll/begin",
    {
      method: "POST",
      body: JSON.stringify({ enrollmentToken }),
    }
  );
}

export async function verifyAdminMfaEnrollment(input: {
  enrollmentToken: string;
  factorId: string;
  otpCode: string;
}): Promise<LoginResponse> {
  const session = await request<LoginResponse>(
    "/api/admin/v1/auth/mfa/enroll/verify",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  setAdminCsrfToken(session.csrfToken);
  return session;
}

export async function getAdminAuthPolicy(): Promise<AdminAuthSecurityPolicy> {
  return request<AdminAuthSecurityPolicy>("/api/admin/v1/auth/policy");
}

export async function getCurrentAdmin(token: string): Promise<LoginResponse> {
  const session = await request<LoginResponse>("/api/admin/v1/auth/me");
  setAdminCsrfToken(session.csrfToken);
  return session;
}

export async function logoutAdmin(
  token: string
): Promise<{ adminId: string; loggedOut: boolean }> {
  const result = await request<{ adminId: string; loggedOut: boolean }>(
    "/api/admin/v1/auth/logout",
    { method: "POST" }
  );
  setAdminCsrfToken(null);
  return result;
}

export async function getDashboardOverview(
  token: string
): Promise<DashboardOverview> {
  return request<DashboardOverview>("/api/admin/v1/dashboard/overview");
}

export async function getSystemStatus(token: string): Promise<SystemStatus> {
  return request<SystemStatus>("/api/admin/v1/dashboard/system-status");
}

export async function getFinanceOverview(
  token: string
): Promise<FinanceOverview> {
  return request<FinanceOverview>("/api/admin/v1/dashboard/finance-overview");
}

export async function getActivityTrends(
  token: string
): Promise<ActivityTrendSeries> {
  return request<ActivityTrendSeries>(
    "/api/admin/v1/dashboard/activity-trends"
  );
}

export async function getOperationsOverview(
  token: string
): Promise<OperationsOverview> {
  return request<OperationsOverview>(
    "/api/admin/v1/dashboard/operations-overview"
  );
}

export async function getReconciliationDetail(
  token: string
): Promise<ReconciliationDetail> {
  const response = await request<RawReconciliationDetail>(
    "/api/admin/v1/dashboard/reconciliation-detail"
  );
  return {
    ...response,
    priorityApprovals: response.priorityApprovals.map(
      normalizeReconciliationApprovalItem
    ),
    depositRepairApprovals: response.depositRepairApprovals.map(
      normalizeReconciliationApprovalItem
    ),
    pendingWithdrawalReviews: response.pendingWithdrawalReviews.map(
      normalizeProviderWithdrawReviewItem
    ),
  };
}

export async function getReconciliationDrilldown(
  token: string,
  locator: { ownerAddress?: string; requestId?: string; txHash?: string }
): Promise<ReconciliationDrilldownResult> {
  const response = await request<RawReconciliationDrilldownResult>(
    buildPath("/api/admin/v1/dashboard/reconciliation-drilldown", locator)
  );
  return {
    ...response,
    priorityApprovals: response.priorityApprovals.map(
      normalizeReconciliationApprovalItem
    ),
    depositRepairApprovals: response.depositRepairApprovals.map(
      normalizeReconciliationApprovalItem
    ),
    pendingWithdrawalReviews: response.pendingWithdrawalReviews.map(
      normalizeProviderWithdrawReviewItem
    ),
  };
}

export async function getDashboardDiagnostics(
  token: string
): Promise<DashboardDiagnostics> {
  return request<DashboardDiagnostics>("/api/admin/v1/dashboard/diagnostics");
}

export async function getAnalyticsOverview(
  token: string,
  window: AnalyticsWindow = "24h"
): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>(
    buildPath("/api/admin/v1/dashboard/analytics/overview", { window })
  );
}

export async function getAnalyticsConsumerFunnel(
  token: string,
  window: AnalyticsWindow = "24h"
): Promise<AnalyticsConsumerFunnel> {
  return request<AnalyticsConsumerFunnel>(
    buildPath("/api/admin/v1/dashboard/analytics/consumer-funnel", { window })
  );
}

export async function getAnalyticsInvocationRevenue(
  token: string,
  window: AnalyticsWindow = "24h"
): Promise<AnalyticsInvocationRevenue> {
  return request<AnalyticsInvocationRevenue>(
    buildPath("/api/admin/v1/dashboard/analytics/invocation-revenue", {
      window,
    })
  );
}

export async function getAnalyticsProviderRevenue(
  token: string,
  window: AnalyticsWindow = "24h"
): Promise<AnalyticsProviderRevenue> {
  return request<AnalyticsProviderRevenue>(
    buildPath("/api/admin/v1/dashboard/analytics/provider-revenue", { window })
  );
}

export async function getAnalyticsMoneyFlow(
  token: string,
  window: AnalyticsWindow = "24h"
): Promise<AnalyticsMoneyFlow> {
  return request<AnalyticsMoneyFlow>(
    buildPath("/api/admin/v1/dashboard/analytics/money-flow", { window })
  );
}

export async function getAnalyticsRiskHealth(
  token: string,
  window: AnalyticsWindow = "24h"
): Promise<AnalyticsRiskHealth> {
  return request<AnalyticsRiskHealth>(
    buildPath("/api/admin/v1/dashboard/analytics/risk-health", { window })
  );
}

export async function getAnalyticsDataQuality(
  token: string,
  window: AnalyticsDataQualityWindow = "24h"
): Promise<AnalyticsDataQuality> {
  return request<AnalyticsDataQuality>(
    buildPath("/api/admin/v1/dashboard/analytics/data-quality", { window })
  );
}

export async function listForumResponseTasks(
  token: string,
  params?: {
    status?: string;
    classification?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<ForumResponseTaskListResponse> {
  return request<ForumResponseTaskListResponse>(
    buildPath("/api/admin/v1/forum/response-tasks", {
      status: params?.status,
      classification: params?.classification,
      page: params?.page,
      page_size: params?.pageSize,
    })
  );
}

export async function getForumResponseTask(
  token: string,
  taskId: string
): Promise<ForumResponseTask> {
  return request<ForumResponseTask>(
    `/api/admin/v1/forum/response-tasks/${taskId}`
  );
}

export async function sendForumResponseReply(
  token: string,
  taskId: string,
  input: { body: string; authorDisplay?: string; authorAddress?: string }
): Promise<ForumResponseTask> {
  return request<ForumResponseTask>(
    `/api/admin/v1/forum/response-tasks/${taskId}/send-reply`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function ignoreForumResponseTask(
  token: string,
  taskId: string,
  input: { reason: string }
): Promise<ForumResponseTask> {
  return request<ForumResponseTask>(
    `/api/admin/v1/forum/response-tasks/${taskId}/ignore`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function listForumTopics(
  token: string,
  params?: {
    status?: string;
    category?: string;
    q?: string;
    pinned?: boolean;
    page?: number;
    pageSize?: number;
  }
): Promise<ForumTopicListResponse> {
  return request<ForumTopicListResponse>(
    buildPath("/api/admin/v1/forum/topics", {
      status: params?.status,
      category: params?.category,
      q: params?.q,
      pinned: params?.pinned,
      page: params?.page,
      page_size: params?.pageSize,
    })
  );
}

export async function getForumTopic(
  token: string,
  topicId: string
): Promise<ForumTopicDetailResponse> {
  return request<ForumTopicDetailResponse>(
    `/api/admin/v1/forum/topics/${topicId}`
  );
}

export async function closeForumTopic(
  token: string,
  topicId: string,
  input: { reason: string }
): Promise<ForumTopicContext> {
  return request<ForumTopicContext>(
    `/api/admin/v1/forum/topics/${topicId}/close`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function reopenForumTopic(
  token: string,
  topicId: string
): Promise<ForumTopicContext> {
  return request<ForumTopicContext>(
    `/api/admin/v1/forum/topics/${topicId}/reopen`,
    {
      method: "POST",
    }
  );
}

export async function pinForumTopic(
  token: string,
  topicId: string
): Promise<ForumTopicContext> {
  return request<ForumTopicContext>(
    `/api/admin/v1/forum/topics/${topicId}/pin`,
    {
      method: "POST",
    }
  );
}

export async function unpinForumTopic(
  token: string,
  topicId: string
): Promise<ForumTopicContext> {
  return request<ForumTopicContext>(
    `/api/admin/v1/forum/topics/${topicId}/unpin`,
    {
      method: "POST",
    }
  );
}

export async function listApprovals(
  token: string,
  params?: { status?: string; approvalType?: string; limit?: number }
): Promise<ApprovalListResponse> {
  const response = await request<RawApprovalListResponse>(
    buildPath("/api/admin/v1/approvals", params)
  );
  return {
    ...response,
    items: response.items.map(normalizeApprovalItem),
  };
}

export async function listProviderWithdrawReviews(
  token: string,
  params?: { limit?: number }
): Promise<ProviderWithdrawReviewListResponse> {
  const response = await request<RawProviderWithdrawReviewListResponse>(
    buildPath("/api/admin/v1/withdrawal-reviews", params)
  );
  return {
    ...response,
    items: response.items.map(normalizeProviderWithdrawReviewItem),
  };
}

export async function listProviderWithdrawReviewHistory(
  token: string,
  params?: {
    limit?: number;
    cursor?: string;
    query?: string;
    reviewer?: string;
    currentStatus?: string;
    reviewDecision?: string;
    reviewedFrom?: string;
    reviewedTo?: string;
  }
): Promise<ProviderWithdrawReviewHistoryListResponse> {
  const response = await request<RawProviderWithdrawReviewHistoryListResponse>(
    buildPath("/api/admin/v1/withdrawal-reviews/history", params)
  );
  return {
    ...response,
    items: response.items.map(normalizeProviderWithdrawReviewHistoryItem),
  };
}

export async function decideProviderWithdrawReview(
  token: string,
  withdrawalId: string,
  input: {
    decision: "APPROVE" | "REJECT";
    note?: string;
    otpCode?: string;
  }
): Promise<ProviderWithdrawReviewDecisionResult> {
  const response = await request<RawProviderWithdrawReviewDecisionResult>(
    `/api/admin/v1/withdrawal-reviews/${withdrawalId}/decision`,
    {
      method: "POST",
      headers: input.otpCode
        ? { "X-Admin-OTP-Code": input.otpCode }
        : undefined,
      body: JSON.stringify({ decision: input.decision, note: input.note }),
    }
  );
  return {
    ...response,
    withdrawalKind: response.withdrawalKind ?? "provider_withdrawal",
    reviewType: response.reviewType ?? "provider_withdraw_review",
    subjectAddress: response.subjectAddress ?? response.ownerAddress,
    status: assertWithdrawalStatus(response.status),
  };
}

export async function listProviderServices(
  token: string,
  params?: {
    query?: string;
    status?: string;
    runtimeStatus?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<ProviderServiceListResponse> {
  const response = await request<RawProviderServiceListResponse>(
    buildPath("/api/admin/v1/provider-services", params)
  );
  return {
    ...response,
    items: response.items.map(normalizeProviderServiceItem),
  };
}

export async function forceProbeProviderService(
  token: string,
  serviceId: string
): Promise<ProviderServiceActionResponse> {
  const response = await request<RawProviderServiceActionResponse>(
    `/api/admin/v1/provider-services/${serviceId}/force-probe`,
    {
      method: "POST",
    }
  );
  return { service: normalizeProviderServiceItem(response.service) };
}

export async function updateProviderServiceLifecycle(
  token: string,
  serviceId: string,
  input: { action: "PAUSE" | "RESUME" | "SUSPEND"; note?: string }
): Promise<ProviderServiceActionResponse> {
  const response = await request<RawProviderServiceActionResponse>(
    `/api/admin/v1/provider-services/${serviceId}/lifecycle`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
  return { service: normalizeProviderServiceItem(response.service) };
}

export async function deleteProviderService(
  token: string,
  serviceId: string,
  note?: string
): Promise<ProviderServiceDeleteResponse> {
  const response = await request<RawProviderServiceDeleteResponse>(
    `/api/admin/v1/provider-services/${serviceId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ note }),
    }
  );
  return {
    ...response,
    status: assertProviderServiceStatus(response.status),
  };
}

export async function listAuditActions(
  token: string,
  params?: {
    resultStatus?: string;
    actionType?: string;
    operatorId?: string;
    limit?: number;
  }
): Promise<AuditActionListResponse> {
  return request<AuditActionListResponse>(
    buildPath("/api/admin/v1/audit/actions", params)
  );
}

export async function listExecutionJobs(
  token: string,
  params?: {
    status?: string;
    approvalId?: string;
    targetSystem?: string;
    limit?: number;
  }
): Promise<ExecutionJobListResponse> {
  const response = await request<RawExecutionJobListResponse>(
    buildPath("/api/admin/v1/execution-jobs", params)
  );
  return {
    ...response,
    items: response.items.map(normalizeExecutionJobItem),
  };
}

export async function retryExecutionJob(
  token: string,
  jobId: string,
  otpCode?: string
): Promise<ExecutionRetryResult> {
  const response = await request<RawExecutionRetryResult>(
    `/api/admin/v1/execution-jobs/${jobId}/retry`,
    {
      method: "POST",
      headers: otpCode ? { "X-Admin-OTP-Code": otpCode } : undefined,
    }
  );
  return {
    ...response,
    status: assertExecutionJobStatus(response.status),
  };
}

export async function listAdminUsers(
  token: string,
  params?: {
    status?: string;
    search?: string;
    roleKey?: string;
    limit?: number;
  }
): Promise<AdminUserListResponse> {
  return request<AdminUserListResponse>(
    buildPath("/api/admin/v1/users", params)
  );
}

export async function listAdminRoles(
  token: string
): Promise<AdminRoleCatalogResponse> {
  return request<AdminRoleCatalogResponse>("/api/admin/v1/users/roles");
}

export async function listAdminPermissions(
  token: string
): Promise<AdminPermissionCatalogResponse> {
  return request<AdminPermissionCatalogResponse>(
    "/api/admin/v1/users/permissions"
  );
}

export async function createAdminUser(
  token: string,
  input: {
    email: string;
    displayName: string;
    roleKey: string;
    password: string;
    requireMfa: boolean;
    status?: string;
  }
): Promise<CreateAdminUserResponse> {
  return request<CreateAdminUserResponse>("/api/admin/v1/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAdminUser(
  token: string,
  adminId: string,
  input: {
    displayName: string;
    roleKey: string;
    password?: string;
    requireMfa: boolean;
    status: string;
  }
): Promise<UpdateAdminUserResponse> {
  return request<UpdateAdminUserResponse>(`/api/admin/v1/users/${adminId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteAdminUser(
  token: string,
  adminId: string
): Promise<DeleteAdminUserResponse> {
  return request<DeleteAdminUserResponse>(`/api/admin/v1/users/${adminId}`, {
    method: "DELETE",
  });
}

export async function createAdminRole(
  token: string,
  input: {
    roleKey: string;
    roleName: string;
    description?: string;
    status: string;
    permissions: string[];
  }
): Promise<CreateAdminRoleResponse> {
  return request<CreateAdminRoleResponse>("/api/admin/v1/users/roles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAdminRole(
  token: string,
  roleKey: string,
  input: {
    roleName: string;
    description?: string;
    status: string;
    permissions: string[];
  }
): Promise<UpdateAdminRoleResponse> {
  return request<UpdateAdminRoleResponse>(
    `/api/admin/v1/users/roles/${roleKey}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export async function deleteAdminRole(
  token: string,
  roleKey: string
): Promise<DeleteAdminRoleResponse> {
  return request<DeleteAdminRoleResponse>(
    `/api/admin/v1/users/roles/${roleKey}`,
    {
      method: "DELETE",
    }
  );
}

export async function getAdminMenuConfig(
  token: string,
  params?: { stage?: "draft" | "published" }
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    buildPath("/api/admin/v1/config/menu-items", params)
  );
}

export async function getVisibleAdminMenuConfig(
  token: string
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    "/api/admin/v1/config/menu-items/visible"
  );
}

export async function createAdminMenuItem(
  token: string,
  input: {
    itemId: string;
    sectionId: string;
    sectionLabel: string;
    sectionDescription: string;
    label: string;
    href: string | null;
    description: string;
    parentItemId?: string | null;
    nodeType?: "category" | "page" | "panel";
    iconKey?: string;
    requiredRoles: string[];
    requiredPermissions: string[];
    sortOrder?: number;
    keywords?: string[];
  }
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>("/api/admin/v1/config/menu-items", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAdminMenuItem(
  token: string,
  itemId: string,
  input: {
    sectionId: string;
    sectionLabel: string;
    sectionDescription: string;
    label: string;
    href: string | null;
    description: string;
    parentItemId?: string | null;
    nodeType?: "category" | "page" | "panel";
    iconKey?: string;
    requiredRoles: string[];
    requiredPermissions: string[];
    sortOrder?: number;
    keywords?: string[];
  }
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    `/api/admin/v1/config/menu-items/${itemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export async function deleteAdminMenuItem(
  token: string,
  itemId: string
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    `/api/admin/v1/config/menu-items/${itemId}`,
    {
      method: "DELETE",
    }
  );
}

export async function publishAdminMenuConfig(
  token: string,
  otpCode?: string
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    "/api/admin/v1/config/menu-items/publish",
    {
      method: "POST",
      headers: otpCode ? { "X-Admin-OTP-Code": otpCode } : undefined,
    }
  );
}
