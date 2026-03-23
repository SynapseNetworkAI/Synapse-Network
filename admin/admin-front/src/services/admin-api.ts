export type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  requestId: string;
};

import { clearAdminCsrfToken, readAdminCsrfTokenFromStorage, saveAdminCsrfToken } from "@/lib/admin-csrf-token";

export type ApiErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
  data?: unknown;
};

export class AdminApiError extends Error {
  status: number;
  code: string | null;
  requestId: string | null;
  data: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | null;
      requestId?: string | null;
      data?: unknown;
    },
  ) {
    super(message);
    this.name = "AdminApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.data = options.data;
  }
}

export function isAdminApiError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError;
}

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

function isExpiredAdminSession(status: number, code: string | null, message: string): boolean {
  return status === 401 && code === "UNAUTHORIZED" && message.trim().toLowerCase() === "admin session expired";
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
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
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
  status: string;
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
  status: string;
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
  ownerAddress: string;
  amountUsdc: string;
  status: string;
  requestId: string | null;
  txHash: string | null;
  riskLevel: string | null;
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
  ownerAddress: string;
  reviewDecision: string;
  status: string;
  message: string | null;
  requestedBy: string | null;
  ticket: Record<string, unknown>;
};

export type ProviderWithdrawReviewHistoryItem = {
  withdrawalId: string;
  ownerAddress: string | null;
  amountUsdc: string | null;
  requestId: string | null;
  txHash: string | null;
  riskLevel: string | null;
  riskReasonCode: string | null;
  evidenceSummary: string | null;
  reviewDecision: string;
  currentStatus: string;
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
  status: string;
  errorCode: string | null;
  errorSummary: string | null;
  finishedAt: string | null;
};

export type ExecutionJobItem = {
  jobId: string;
  approvalId: string;
  executionType: string;
  targetSystem: string;
  status: string;
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
  status: string;
  retryCount: number;
};

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

const ADMIN_API_BASE_URL = resolveAdminApiBaseUrl(process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL);

function buildRequestUrl(path: string): string {
  return ADMIN_API_BASE_URL ? `${ADMIN_API_BASE_URL}${path}` : path;
}

function buildPath(path: string, params?: Record<string, string | number | undefined>): string {
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    const message = "error" in body ? body.error.message : `Request failed: ${response.status}`;
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

export async function beginAdminMfaEnrollment(enrollmentToken: string): Promise<MfaEnrollBeginResponse> {
  return request<MfaEnrollBeginResponse>("/api/admin/v1/auth/mfa/enroll/begin", {
    method: "POST",
    body: JSON.stringify({ enrollmentToken }),
  });
}

export async function verifyAdminMfaEnrollment(input: {
  enrollmentToken: string;
  factorId: string;
  otpCode: string;
}): Promise<LoginResponse> {
  const session = await request<LoginResponse>("/api/admin/v1/auth/mfa/enroll/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export async function logoutAdmin(token: string): Promise<{ adminId: string; loggedOut: boolean }> {
  const result = await request<{ adminId: string; loggedOut: boolean }>("/api/admin/v1/auth/logout", { method: "POST" });
  setAdminCsrfToken(null);
  return result;
}

export async function getDashboardOverview(token: string): Promise<DashboardOverview> {
  return request<DashboardOverview>("/api/admin/v1/dashboard/overview");
}

export async function getSystemStatus(token: string): Promise<SystemStatus> {
  return request<SystemStatus>("/api/admin/v1/dashboard/system-status");
}

export async function getFinanceOverview(token: string): Promise<FinanceOverview> {
  return request<FinanceOverview>("/api/admin/v1/dashboard/finance-overview");
}

export async function getActivityTrends(token: string): Promise<ActivityTrendSeries> {
  return request<ActivityTrendSeries>("/api/admin/v1/dashboard/activity-trends");
}

export async function getOperationsOverview(token: string): Promise<OperationsOverview> {
  return request<OperationsOverview>("/api/admin/v1/dashboard/operations-overview");
}

export async function getReconciliationDetail(token: string): Promise<ReconciliationDetail> {
  return request<ReconciliationDetail>("/api/admin/v1/dashboard/reconciliation-detail");
}

export async function getReconciliationDrilldown(
  token: string,
  locator: { ownerAddress?: string; requestId?: string; txHash?: string },
): Promise<ReconciliationDrilldownResult> {
  return request<ReconciliationDrilldownResult>(buildPath("/api/admin/v1/dashboard/reconciliation-drilldown", locator));
}

export async function getDashboardDiagnostics(token: string): Promise<DashboardDiagnostics> {
  return request<DashboardDiagnostics>("/api/admin/v1/dashboard/diagnostics");
}

export async function listApprovals(
  token: string,
  params?: { status?: string; approvalType?: string; limit?: number },
): Promise<ApprovalListResponse> {
  return request<ApprovalListResponse>(buildPath("/api/admin/v1/approvals", params));
}

export async function listProviderWithdrawReviews(
  token: string,
  params?: { limit?: number },
): Promise<ProviderWithdrawReviewListResponse> {
  return request<ProviderWithdrawReviewListResponse>(buildPath("/api/admin/v1/withdrawal-reviews", params));
}

export async function listProviderWithdrawReviewHistory(
  token: string,
  params?: { limit?: number; currentStatus?: string },
): Promise<ProviderWithdrawReviewHistoryListResponse> {
  return request<ProviderWithdrawReviewHistoryListResponse>(buildPath("/api/admin/v1/withdrawal-reviews/history", params));
}

export async function decideProviderWithdrawReview(
  token: string,
  withdrawalId: string,
  input: {
    decision: "APPROVE" | "REJECT";
    note?: string;
    otpCode?: string;
  },
): Promise<ProviderWithdrawReviewDecisionResult> {
  return request<ProviderWithdrawReviewDecisionResult>(
    `/api/admin/v1/withdrawal-reviews/${withdrawalId}/decision`,
    {
      method: "POST",
      headers: input.otpCode ? { "X-Admin-OTP-Code": input.otpCode } : undefined,
      body: JSON.stringify({ decision: input.decision, note: input.note }),
    },
  );
}

export async function listAuditActions(
  token: string,
  params?: { resultStatus?: string; actionType?: string; operatorId?: string; limit?: number },
): Promise<AuditActionListResponse> {
  return request<AuditActionListResponse>(buildPath("/api/admin/v1/audit/actions", params));
}

export async function listExecutionJobs(
  token: string,
  params?: { status?: string; approvalId?: string; targetSystem?: string; limit?: number },
): Promise<ExecutionJobListResponse> {
  return request<ExecutionJobListResponse>(buildPath("/api/admin/v1/execution-jobs", params));
}

export async function retryExecutionJob(
  token: string,
  jobId: string,
  otpCode?: string,
): Promise<ExecutionRetryResult> {
  return request<ExecutionRetryResult>(`/api/admin/v1/execution-jobs/${jobId}/retry`, {
    method: "POST",
    headers: otpCode ? { "X-Admin-OTP-Code": otpCode } : undefined,
  });
}

export async function listAdminUsers(
  token: string,
  params?: { status?: string; search?: string; roleKey?: string; limit?: number },
): Promise<AdminUserListResponse> {
  return request<AdminUserListResponse>(buildPath("/api/admin/v1/users", params));
}

export async function listAdminRoles(token: string): Promise<AdminRoleCatalogResponse> {
  return request<AdminRoleCatalogResponse>("/api/admin/v1/users/roles");
}

export async function listAdminPermissions(token: string): Promise<AdminPermissionCatalogResponse> {
  return request<AdminPermissionCatalogResponse>("/api/admin/v1/users/permissions");
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
  },
): Promise<CreateAdminUserResponse> {
  return request<CreateAdminUserResponse>(
    "/api/admin/v1/users",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
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
  },
): Promise<UpdateAdminUserResponse> {
  return request<UpdateAdminUserResponse>(
    `/api/admin/v1/users/${adminId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteAdminUser(token: string, adminId: string): Promise<DeleteAdminUserResponse> {
  return request<DeleteAdminUserResponse>(
    `/api/admin/v1/users/${adminId}`,
    {
      method: "DELETE",
    },
  );
}

export async function createAdminRole(
  token: string,
  input: {
    roleKey: string;
    roleName: string;
    description?: string;
    status: string;
    permissions: string[];
  },
): Promise<CreateAdminRoleResponse> {
  return request<CreateAdminRoleResponse>(
    "/api/admin/v1/users/roles",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function updateAdminRole(
  token: string,
  roleKey: string,
  input: {
    roleName: string;
    description?: string;
    status: string;
    permissions: string[];
  },
): Promise<UpdateAdminRoleResponse> {
  return request<UpdateAdminRoleResponse>(
    `/api/admin/v1/users/roles/${roleKey}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteAdminRole(token: string, roleKey: string): Promise<DeleteAdminRoleResponse> {
  return request<DeleteAdminRoleResponse>(
    `/api/admin/v1/users/roles/${roleKey}`,
    {
      method: "DELETE",
    },
  );
}

export async function getAdminMenuConfig(
  token: string,
  params?: { stage?: "draft" | "published" },
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(buildPath("/api/admin/v1/config/menu-items", params));
}

export async function getVisibleAdminMenuConfig(token: string): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>("/api/admin/v1/config/menu-items/visible");
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
  },
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    "/api/admin/v1/config/menu-items",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
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
  },
): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    `/api/admin/v1/config/menu-items/${itemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteAdminMenuItem(token: string, itemId: string): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>(
    `/api/admin/v1/config/menu-items/${itemId}`,
    {
      method: "DELETE",
    },
  );
}

export async function publishAdminMenuConfig(token: string, otpCode?: string): Promise<AdminMenuConfigResponse> {
  return request<AdminMenuConfigResponse>("/api/admin/v1/config/menu-items/publish", {
    method: "POST",
    headers: otpCode ? { "X-Admin-OTP-Code": otpCode } : undefined,
  });
}
