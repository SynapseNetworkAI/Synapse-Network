import { buildPath, request } from "@/services/admin-api";

export type AdminListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type OwnerAccountItem = {
  ownerId: string;
  ownerWallet: string;
  accountName: string | null;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  status: string;
  roles: string[];
  agentCount: number;
  providerServiceCount: number;
  supportCaseCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastActiveAt: string | null;
};

export type OwnerAccountListResponse = {
  items: OwnerAccountItem[];
  pagination: AdminListPagination;
};

export type ConsumerDepositItem = {
  depositId: string;
  ownerId: string;
  ownerWallet: string;
  ownerEmail: string | null;
  txHash: string;
  amountUsdc: string;
  network: string | null;
  status: string;
  confirmations: number | null;
  creditedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ConsumerDepositListResponse = {
  items: ConsumerDepositItem[];
  pagination: AdminListPagination;
};

export type ProviderWithdrawalItem = {
  withdrawalId: string;
  providerId: string | null;
  providerName: string | null;
  ownerId: string;
  ownerWallet: string;
  ownerEmail: string | null;
  amountUsdc: string;
  feeUsdc: string | null;
  status: string;
  txHash: string | null;
  ticketId: string | null;
  requestId: string | null;
  reviewDecision: string | null;
  fundsState: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProviderWithdrawalListResponse = {
  items: ProviderWithdrawalItem[];
  pagination: AdminListPagination;
};

export async function listOwnerAccounts(
  token: string,
  params?: {
    q?: string;
    wallet?: string;
    email?: string;
    status?: string;
    includeEmail?: boolean;
    sort?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<OwnerAccountListResponse> {
  void token;
  return request<OwnerAccountListResponse>(
    buildPath("/api/admin/v1/owner-accounts", params)
  );
}

export async function listConsumerDeposits(
  token: string,
  params?: {
    wallet?: string;
    txHash?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<ConsumerDepositListResponse> {
  void token;
  return request<ConsumerDepositListResponse>(
    buildPath("/api/admin/v1/finance/consumer-deposits", params)
  );
}

export async function listProviderWithdrawals(
  token: string,
  params?: {
    wallet?: string;
    txHash?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<ProviderWithdrawalListResponse> {
  void token;
  return request<ProviderWithdrawalListResponse>(
    buildPath("/api/admin/v1/finance/provider-withdrawals", params)
  );
}
