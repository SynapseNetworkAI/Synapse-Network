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
};

export type AdminProfile = {
  adminId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
};

export type LoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  admin: AdminProfile;
};

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

export type FinanceOverview = {
  todayChargeUsdc: string;
  todayDepositUsdc: string;
  todayRefundUsdc: string;
  todayWithdrawalUsdc: string;
  buyerLiabilityUsdc: string;
  sellerPayableUsdc: string;
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
  refundUsdc: string;
  withdrawalUsdc: string;
  netFlowUsdc: string;
};

export type ActivityTrendSeries = {
  points: ActivityTrendPoint[];
};

export type OperationsOverview = {
  gatewayStatus: string;
  indexerLastProcessedAt: string | null;
  backfillLastScanAt: string | null;
  backfillLastScannedBlock: number | null;
  recentGatewayFailures: number;
  failedDepositCount: number;
  recentAuditAlerts: number;
  lastReconciliationAt: string | null;
  reconciliationAlert: boolean;
  reconciliationDeltaUsdc: string;
  reconciliationLastError: string | null;
  projectedAt: string | null;
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

const ADMIN_API_BASE_URL =
  process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8300";

function buildHeaders(token?: string, init?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init,
  };
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(token, init?.headers),
    cache: "no-store",
  });

  const body = (await response.json()) as ApiEnvelope<T> | ApiErrorEnvelope;
  if (!response.ok || !body.success) {
    const message = "error" in body ? body.error.message : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return body.data;
}

export async function loginAdmin(input: {
  email: string;
  password: string;
  otpCode: string;
}): Promise<LoginResponse> {
  return request<LoginResponse>("/api/admin/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getCurrentAdmin(token: string): Promise<AdminProfile> {
  return request<AdminProfile>("/api/admin/v1/auth/me", undefined, token);
}

export async function logoutAdmin(token: string): Promise<{ adminId: string; loggedOut: boolean }> {
  return request<{ adminId: string; loggedOut: boolean }>(
    "/api/admin/v1/auth/logout",
    { method: "POST" },
    token,
  );
}

export async function getDashboardOverview(token: string): Promise<DashboardOverview> {
  return request<DashboardOverview>("/api/admin/v1/dashboard/overview", undefined, token);
}

export async function getSystemStatus(token: string): Promise<SystemStatus> {
  return request<SystemStatus>("/api/admin/v1/dashboard/system-status", undefined, token);
}

export async function getFinanceOverview(token: string): Promise<FinanceOverview> {
  return request<FinanceOverview>("/api/admin/v1/dashboard/finance-overview", undefined, token);
}

export async function getActivityTrends(token: string): Promise<ActivityTrendSeries> {
  return request<ActivityTrendSeries>("/api/admin/v1/dashboard/activity-trends", undefined, token);
}

export async function getOperationsOverview(token: string): Promise<OperationsOverview> {
  return request<OperationsOverview>("/api/admin/v1/dashboard/operations-overview", undefined, token);
}

export async function listApprovals(token: string): Promise<ApprovalListResponse> {
  return request<ApprovalListResponse>("/api/admin/v1/approvals", undefined, token);
}
