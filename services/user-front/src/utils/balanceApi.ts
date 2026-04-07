import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

const API_BASE = `${getGatewayBaseUrl()}/api/v1`;
const depositIntentInflight = new Map<string, Promise<DepositIntentRecord>>();

function buildIdempotencyKey(prefix: string): string {
  const now = Date.now().toString(36);
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2);
  return `${prefix}_${now}_${random}`.slice(0, 120);
}

function buildDepositIntentIdempotencyKey(txHash: string): string {
  const normalizedTx = String(txHash || "")
    .trim()
    .toLowerCase();
  return `deposit_tx_${normalizedTx.replace(/^0x/, "")}`.slice(0, 120);
}

function buildVoucherRedeemIdempotencyKey(voucherCode: string): string {
  const compact = String(voucherCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
  return `voucher_redeem_${compact}`.slice(0, 120);
}

async function readErrorPayload(
  response: Response
): Promise<{ code?: string; message?: string }> {
  try {
    const text = await response.text();
    if (!text) return {};
    const parsed = JSON.parse(text) as {
      detail?: { code?: string; message?: string } | string;
      message?: string;
    };
    if (parsed.detail && typeof parsed.detail === "object") {
      return {
        code:
          typeof parsed.detail.code === "string"
            ? parsed.detail.code
            : undefined,
        message:
          typeof parsed.detail.message === "string"
            ? parsed.detail.message
            : undefined,
      };
    }
    let message: string | undefined;
    if (typeof parsed.message === "string") {
      message = parsed.message;
    } else if (typeof parsed.detail === "string") {
      message = parsed.detail;
    }
    return {
      message,
    };
  } catch {
    return {};
  }
}

export type BalanceSummary = {
  ownerBalance: number;
  providerReceivable: number;
  platformFeeAccrued: number;
};

export type OwnerSpendingLimit = {
  ownerAddress: string;
  spendingLimitUsdc: number | null;
  allowUnlimited: boolean;
  cycleInterval: "monthly";
  currentCycleSpendUsdc: number;
  remainingSpendUsdc: number | null;
  updatedAt: string | number | null;
};

export type VoucherRedemptionRecord = {
  redemptionId: string;
  voucherCodeId: string;
  campaignId: string;
  campaignCode: string;
  campaignDisplayName: string;
  voucherCodeLast4: string;
  grantedAmountUsdc: number;
  ownerAddress: string;
  ledgerEntryId: string;
  targetAccountId: string;
  promoAccountId: string;
  status: string;
  beforeBalanceUsdc: number;
  afterBalanceUsdc: number;
  redeemedAt: string;
};

export type RedeemVoucherResponse = {
  redemption: VoucherRedemptionRecord;
  balance: BalanceSummary;
};

export type DepositIntentRecord = {
  id?: string;
  ownerAddress?: string;
  txHash: string;
  amountUsdc?: number;
  creditedAmountUsdc?: number;
  status: string;
  failureReason?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  confirmedAt?: number;
};

export type DepositSyncStatus = {
  txHash: string;
  found: boolean;
  synced: boolean;
  status: string;
  confirmed: boolean;
  canRefreshBalance: boolean;
  depositIntentId?: string;
  ownerAddress?: string;
  amountUsdc?: number;
  creditedAmountUsdc?: number;
  confirmations?: number;
  eventKey?: string;
  confirmedAt?: number;
  updatedAt?: string | number;
  source?: string;
};

export type DepositAttemptStage =
  | "SIGN_REQUESTED"
  | "TX_BROADCASTED"
  | "RECEIPT_FAILED"
  | "RECEIPT_CONFIRMED"
  | "INTENT_REGISTERED";

export type DepositAttemptRecord = {
  id?: number;
  attemptId: string;
  ownerAddress?: string;
  clientRequestId?: string;
  txHash?: string;
  amountUsdc: number;
  stage: DepositAttemptStage;
  failureReason?: string;
  requestId?: string;
  clientIp?: string;
  userAgent?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
};

type TimestampLike = string | number | undefined;

export type OwnerRefundIntent = {
  refundId: string;
  signature: string;
  amountRefunded: number;
  status: "PENDING" | "PENDING_MANUAL_REVIEW" | "COMPLETED" | "REJECTED";
  gasPayer: "OWNER";
  gasModel: "OWNER_PAYS_ONCHAIN";
  riskLevel?: "green" | "yellow" | "red";
  riskReasonCode?: string;
  message?: string;
};

export type RefundIntentRecord = {
  id: string;
  ownerAddress?: string;
  amountUsdc?: number;
  reason?: string;
  status: "PENDING" | "PENDING_MANUAL_REVIEW" | "COMPLETED" | "REJECTED";
  riskLevel?: string;
  riskReasonCode?: string;
  message?: string;
  originRequestId?: string;
  originTxHash?: string;
  txHash?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type IndexerStatus = {
  running: boolean;
  listenerAddress: string;
  lastCounters: {
    credited: number;
    failed: number;
    pending: number;
  };
  lastProcessedAt: number | null;
  lastError: string | null;
  pollIntervalSec: number;
};

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as {
        detail?: { message?: string } | string;
        message?: string;
      };
      if (typeof parsed.detail === "string")
        return normalizeAuthApiError(parsed.detail, response.status);
      if (
        parsed.detail &&
        typeof parsed.detail === "object" &&
        parsed.detail.message
      ) {
        return normalizeAuthApiError(parsed.detail.message, response.status);
      }
      if (parsed.message)
        return normalizeAuthApiError(parsed.message, response.status);
      return normalizeAuthApiError(text, response.status);
    } catch {
      return normalizeAuthApiError(text, response.status);
    }
  } catch {
    return fallback;
  }
}

export async function getV2Balance(
  userAddress: string
): Promise<BalanceSummary> {
  const response = await fetch(`${API_BASE}/balance`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to fetch v2 balance")
    );
  }

  const payload = (await response.json()) as {
    balance?: Partial<BalanceSummary> & {
      ownerBalance?: number;
      consumerAvailableBalance?: number;
      providerReceivable?: number;
      providerReceivableBalance?: number;
      platform?: { feeAccrued?: number };
    };
  };
  const feeFromMap = Number(payload.balance?.platform?.feeAccrued ?? 0);
  return {
    ownerBalance: Number(
      payload.balance?.ownerBalance ??
        payload.balance?.consumerAvailableBalance ??
        0
    ),
    providerReceivable: Number(
      payload.balance?.providerReceivable ??
        payload.balance?.providerReceivableBalance ??
        0
    ),
    platformFeeAccrued: Number(
      payload.balance?.platformFeeAccrued ?? feeFromMap
    ),
  };
}

function normalizeOwnerSpendingLimit(
  payload?: Partial<OwnerSpendingLimit>
): OwnerSpendingLimit {
  return {
    ownerAddress: String(payload?.ownerAddress || "").toLowerCase(),
    spendingLimitUsdc:
      typeof payload?.spendingLimitUsdc === "number"
        ? payload.spendingLimitUsdc
        : null,
    allowUnlimited: Boolean(payload?.allowUnlimited),
    cycleInterval: "monthly",
    currentCycleSpendUsdc: Number(payload?.currentCycleSpendUsdc ?? 0),
    remainingSpendUsdc:
      typeof payload?.remainingSpendUsdc === "number"
        ? payload.remainingSpendUsdc
        : null,
    updatedAt: payload?.updatedAt ?? null,
  };
}

export async function getOwnerSpendingLimit(
  userAddress: string
): Promise<OwnerSpendingLimit> {
  const response = await fetch(`${API_BASE}/balance/spending-limit`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to fetch spending limit")
    );
  }

  const payload = (await response.json()) as {
    spendingLimit?: Partial<OwnerSpendingLimit>;
  };
  return normalizeOwnerSpendingLimit(payload.spendingLimit);
}

export async function updateOwnerSpendingLimit(
  userAddress: string,
  payload: { spendingLimitUsdc?: number | null; allowUnlimited: boolean }
): Promise<OwnerSpendingLimit> {
  const response = await fetch(`${API_BASE}/balance/spending-limit`, {
    method: "PUT",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({
      spendingLimitUsdc: payload.spendingLimitUsdc ?? null,
      allowUnlimited: payload.allowUnlimited,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to update spending limit")
    );
  }

  const result = (await response.json()) as {
    spendingLimit?: Partial<OwnerSpendingLimit>;
  };
  return normalizeOwnerSpendingLimit(result.spendingLimit);
}

export async function redeemCreditVoucher(
  userAddress: string,
  voucherCode: string
): Promise<RedeemVoucherResponse> {
  const response = await fetch(`${API_BASE}/balance/vouchers/redeem`, {
    method: "POST",
    headers: {
      ...buildAuthedHeaders(userAddress),
      "X-Idempotency-Key": buildVoucherRedeemIdempotencyKey(voucherCode),
    },
    body: JSON.stringify({ voucherCode }),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to redeem voucher")
    );
  }

  const payload = (await response.json()) as {
    redemption?: Partial<VoucherRedemptionRecord>;
    balance?: Partial<BalanceSummary> & {
      ownerBalance?: number;
      consumerAvailableBalance?: number;
      providerReceivable?: number;
      providerReceivableBalance?: number;
      platform?: { feeAccrued?: number };
    };
  };

  return {
    redemption: {
      redemptionId: String(payload.redemption?.redemptionId || ""),
      voucherCodeId: String(payload.redemption?.voucherCodeId || ""),
      campaignId: String(payload.redemption?.campaignId || ""),
      campaignCode: String(payload.redemption?.campaignCode || ""),
      campaignDisplayName: String(
        payload.redemption?.campaignDisplayName || ""
      ),
      voucherCodeLast4: String(payload.redemption?.voucherCodeLast4 || ""),
      grantedAmountUsdc: Number(payload.redemption?.grantedAmountUsdc ?? 0),
      ownerAddress: String(payload.redemption?.ownerAddress || userAddress),
      ledgerEntryId: String(payload.redemption?.ledgerEntryId || ""),
      targetAccountId: String(payload.redemption?.targetAccountId || ""),
      promoAccountId: String(payload.redemption?.promoAccountId || ""),
      status: String(payload.redemption?.status || "COMPLETED"),
      beforeBalanceUsdc: Number(payload.redemption?.beforeBalanceUsdc ?? 0),
      afterBalanceUsdc: Number(payload.redemption?.afterBalanceUsdc ?? 0),
      redeemedAt: String(payload.redemption?.redeemedAt || ""),
    },
    balance: {
      ownerBalance: Number(
        payload.balance?.ownerBalance ?? payload.balance?.consumerAvailableBalance ?? 0
      ),
      providerReceivable: Number(
        payload.balance?.providerReceivable ??
          payload.balance?.providerReceivableBalance ??
          0
      ),
      platformFeeAccrued: Number(
        payload.balance?.platformFeeAccrued ?? payload.balance?.platform?.feeAccrued ?? 0
      ),
    },
  };
}

export async function createDepositIntent(
  userAddress: string,
  payload: { txHash: string; amountUsdc: number }
): Promise<DepositIntentRecord> {
  const normalizedTx = String(payload.txHash || "")
    .trim()
    .toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedTx)) {
    throw new Error(
      "Invalid txHash format. Expected 66-char 0x-prefixed hash."
    );
  }
  if (!Number.isFinite(payload.amountUsdc) || payload.amountUsdc <= 0) {
    throw new Error("amountUsdc must be a positive number.");
  }

  const requestKey = `${userAddress.toLowerCase()}::${normalizedTx}`;
  const inflight = depositIntentInflight.get(requestKey);
  if (inflight) {
    return inflight;
  }

  const requestPromise = (async (): Promise<DepositIntentRecord> => {
    const headers = {
      ...buildAuthedHeaders(userAddress),
      "X-Idempotency-Key": buildDepositIntentIdempotencyKey(normalizedTx),
    };

    const response = await fetch(`${API_BASE}/balance/deposit/intent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        txHash: normalizedTx,
        ownerAddress: userAddress,
      }),
    });

    if (response.status === 409) {
      const errorPayload = await readErrorPayload(response);
      if (errorPayload.code === "DEPOSIT_REPLAY_DETECTED") {
        const existing = (await listDepositIntents(userAddress, 100)).find(
          (row) =>
            String(row.txHash || "")
              .trim()
              .toLowerCase() === normalizedTx
        );
        if (existing) {
          return existing;
        }
      }
      throw new Error(
        normalizeAuthApiError(
          errorPayload.message || "Failed to submit deposit intent",
          response.status
        )
      );
    }

    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, "Failed to submit deposit intent")
      );
    }

    const data = (await response.json()) as {
      deposit?: Partial<DepositIntentRecord>;
      intent?: Partial<DepositIntentRecord>;
      tx_hash?: string;
    };

    const deposit = data.deposit ?? data.intent ?? {};
    return {
      id: typeof deposit.id === "string" ? deposit.id : undefined,
      ownerAddress:
        typeof deposit.ownerAddress === "string"
          ? deposit.ownerAddress
          : userAddress,
      txHash: String(deposit.txHash || data.tx_hash || payload.txHash),
      amountUsdc: Number(deposit.amountUsdc ?? payload.amountUsdc),
      creditedAmountUsdc: Number(deposit.creditedAmountUsdc ?? 0),
      status: String(
        (deposit as { state?: string }).state || deposit.status || "pending"
      ),
      failureReason:
        typeof deposit.failureReason === "string"
          ? deposit.failureReason
          : undefined,
      createdAt:
        typeof deposit.createdAt === "string" ||
        typeof deposit.createdAt === "number"
          ? deposit.createdAt
          : undefined,
      updatedAt:
        typeof deposit.updatedAt === "string" ||
        typeof deposit.updatedAt === "number"
          ? deposit.updatedAt
          : undefined,
      confirmedAt:
        typeof deposit.confirmedAt === "number"
          ? deposit.confirmedAt
          : undefined,
    };
  })();

  depositIntentInflight.set(requestKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    depositIntentInflight.delete(requestKey);
  }
}

export async function recordDepositAttempt(
  userAddress: string,
  payload: {
    attemptId: string;
    amountUsdc: number;
    stage: DepositAttemptStage;
    clientRequestId?: string;
    txHash?: string;
    failureReason?: string;
  }
): Promise<DepositAttemptRecord> {
  if (!payload.attemptId.trim()) {
    throw new Error("attemptId is required.");
  }
  if (!Number.isFinite(payload.amountUsdc) || payload.amountUsdc <= 0) {
    throw new Error("amountUsdc must be a positive number.");
  }
  if (payload.txHash) {
    const normalizedTx = String(payload.txHash).trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalizedTx)) {
      throw new Error(
        "Invalid txHash format. Expected 66-char 0x-prefixed hash."
      );
    }
  }

  const response = await fetch(`${API_BASE}/balance/deposit/attempts`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({
      ...payload,
      txHash: payload.txHash ? payload.txHash.trim().toLowerCase() : undefined,
      failureReason: payload.failureReason?.trim() || undefined,
      clientRequestId: payload.clientRequestId?.trim() || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to record deposit attempt")
    );
  }

  const data = (await response.json()) as {
    attempt?: Partial<DepositAttemptRecord>;
  };
  const attempt = data.attempt ?? {};
  return {
    id: typeof attempt.id === "number" ? attempt.id : undefined,
    attemptId: String(attempt.attemptId || payload.attemptId),
    ownerAddress:
      typeof attempt.ownerAddress === "string"
        ? attempt.ownerAddress
        : undefined,
    clientRequestId:
      typeof attempt.clientRequestId === "string"
        ? attempt.clientRequestId
        : undefined,
    txHash:
      typeof attempt.txHash === "string" ? attempt.txHash : payload.txHash,
    amountUsdc: Number(attempt.amountUsdc ?? payload.amountUsdc),
    stage: String(attempt.stage || payload.stage) as DepositAttemptStage,
    failureReason:
      typeof attempt.failureReason === "string"
        ? attempt.failureReason
        : payload.failureReason,
    requestId:
      typeof attempt.requestId === "string" ? attempt.requestId : undefined,
    clientIp:
      typeof attempt.clientIp === "string" ? attempt.clientIp : undefined,
    userAgent:
      typeof attempt.userAgent === "string" ? attempt.userAgent : undefined,
    createdAt: (attempt.createdAt as TimestampLike) ?? undefined,
    updatedAt: (attempt.updatedAt as TimestampLike) ?? undefined,
  };
}

export async function listDepositIntents(
  userAddress: string,
  limit: number = 50
): Promise<DepositIntentRecord[]> {
  const response = await fetch(
    `${API_BASE}/balance/deposit/intents?limit=${encodeURIComponent(
      String(limit)
    )}`,
    {
      method: "GET",
      headers: buildAuthedHeaders(userAddress, false),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to fetch deposit intents")
    );
  }

  const payload = (await response.json()) as {
    intents?: Array<Record<string, unknown>>;
  };
  const rows = Array.isArray(payload.intents) ? payload.intents : [];

  return rows.map((row) => ({
    id: typeof row.id === "string" ? row.id : undefined,
    ownerAddress:
      typeof row.ownerAddress === "string" ? row.ownerAddress : undefined,
    txHash: typeof row.txHash === "string" ? row.txHash : "",
    amountUsdc: Number(row.amountUsdc ?? 0),
    creditedAmountUsdc: Number(row.creditedAmountUsdc ?? 0),
    status: typeof row.status === "string" ? row.status : "pending",
    failureReason:
      typeof row.failureReason === "string" ? row.failureReason : undefined,
    createdAt: (row.createdAt as string | number | undefined) ?? undefined,
    updatedAt: (row.updatedAt as string | number | undefined) ?? undefined,
    confirmedAt: Number(row.confirmedAt ?? 0) || undefined,
  }));
}

export async function getDepositSyncStatus(
  userAddress: string,
  txHash: string
): Promise<DepositSyncStatus> {
  const normalizedTx = String(txHash || "")
    .trim()
    .toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedTx)) {
    throw new Error(
      "Invalid txHash format. Expected 66-char 0x-prefixed hash."
    );
  }

  const response = await fetch(
    `${API_BASE}/balance/deposit/sync?txHash=${encodeURIComponent(
      normalizedTx
    )}`,
    {
      method: "GET",
      headers: buildAuthedHeaders(userAddress, false),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to fetch deposit sync status")
    );
  }

  const payload = (await response.json()) as {
    sync?: Partial<DepositSyncStatus>;
  };
  const sync = payload.sync ?? {};
  return {
    txHash: typeof sync.txHash === "string" ? sync.txHash : normalizedTx,
    found: Boolean(sync.found),
    synced: Boolean(sync.synced),
    status: typeof sync.status === "string" ? sync.status : "NOT_REGISTERED",
    confirmed: Boolean(sync.confirmed),
    canRefreshBalance: Boolean(sync.canRefreshBalance),
    depositIntentId:
      typeof sync.depositIntentId === "string"
        ? sync.depositIntentId
        : undefined,
    ownerAddress:
      typeof sync.ownerAddress === "string" ? sync.ownerAddress : undefined,
    amountUsdc: Number(sync.amountUsdc ?? 0) || undefined,
    creditedAmountUsdc: Number(sync.creditedAmountUsdc ?? 0) || undefined,
    confirmations: Number(sync.confirmations ?? 0) || undefined,
    eventKey: typeof sync.eventKey === "string" ? sync.eventKey : undefined,
    confirmedAt:
      typeof sync.confirmedAt === "number" ? sync.confirmedAt : undefined,
    updatedAt:
      typeof sync.updatedAt === "string" || typeof sync.updatedAt === "number"
        ? sync.updatedAt
        : undefined,
    source: typeof sync.source === "string" ? sync.source : undefined,
  };
}

export async function requestV2Refund(
  userAddress: string,
  params: {
    amountUsdc: number;
    originRequestId?: string;
    originTxHash?: string;
    reason?: string;
    refundType?: "SYSTEM_FAILURE" | "MANUAL_APPEAL";
  }
): Promise<OwnerRefundIntent> {
  const headers = {
    ...buildAuthedHeaders(userAddress, true),
    "X-Idempotency-Key": buildIdempotencyKey("refund"),
  };

  const body: Record<string, unknown> = {
    amountUsdc: params.amountUsdc,
    refundType: params.refundType ?? "MANUAL_APPEAL",
  };
  if (params.originRequestId) body.originRequestId = params.originRequestId;
  if (params.originTxHash) body.originTxHash = params.originTxHash;
  if (params.reason) body.reason = params.reason;

  const response = await fetch(`${API_BASE}/refund`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to process refund")
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const refundId = typeof payload.refundId === "string" ? payload.refundId : "";
  const signature =
    typeof payload.signature === "string" ? payload.signature : "";
  return {
    refundId,
    signature,
    amountRefunded: Number(payload.amountRefunded || 0),
    status: (payload.status as OwnerRefundIntent["status"]) ?? "PENDING",
    gasPayer: "OWNER",
    gasModel: "OWNER_PAYS_ONCHAIN",
    riskLevel: payload.riskLevel as OwnerRefundIntent["riskLevel"],
    riskReasonCode: typeof payload.riskReasonCode === "string" ? payload.riskReasonCode : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
}

export async function listV2Refunds(
  userAddress: string
): Promise<RefundIntentRecord[]> {
  const response = await fetch(`${API_BASE}/refunds`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { refunds?: unknown[] };
  const raw = Array.isArray(payload.refunds) ? payload.refunds : [];
  return raw.map((r): RefundIntentRecord => {
    const row = r as Record<string, unknown>;
    return {
      id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
      ownerAddress: typeof row.ownerAddress === "string" ? row.ownerAddress : undefined,
      amountUsdc: typeof row.amountUsdc === "number" ? row.amountUsdc : Number(row.amountUsdc || 0),
      reason: typeof row.reason === "string" ? row.reason : undefined,
      status: (row.status as RefundIntentRecord["status"]) ?? "PENDING",
      riskLevel: typeof row.riskLevel === "string" ? row.riskLevel : undefined,
      riskReasonCode: typeof row.riskReasonCode === "string" ? row.riskReasonCode : undefined,
      message: typeof row.message === "string" ? row.message : undefined,
      originRequestId: typeof row.originRequestId === "string" ? row.originRequestId : undefined,
      originTxHash: typeof row.originTxHash === "string" ? row.originTxHash : undefined,
      txHash: typeof row.txHash === "string" ? row.txHash : undefined,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    };
  });
}

export type ConsumerWithdrawIntent = {
  withdrawId: string;
  amountUsdc: number;
  status: "PENDING" | "PENDING_MANUAL_REVIEW" | "COMPLETED" | "REJECTED";
  riskLevel?: "green" | "yellow" | "red";
  riskReasonCode?: string;
  message?: string;
  destination?: string;
};

export async function requestConsumerWithdraw(
  userAddress: string,
  params: { amountUsdc: number; reason?: string }
): Promise<ConsumerWithdrawIntent> {
  const headers = {
    ...buildAuthedHeaders(userAddress, true),
    "X-Idempotency-Key": buildIdempotencyKey("consumer-withdraw"),
  };
  const response = await fetch(`${API_BASE}/balance/consumer/withdraw`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amountUsdc: params.amountUsdc, reason: params.reason }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Withdraw request failed"));
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    withdrawId: typeof payload.withdrawId === "string" ? payload.withdrawId : "",
    amountUsdc: Number(payload.amountUsdc || 0),
    status: (payload.status as ConsumerWithdrawIntent["status"]) ?? "PENDING",
    riskLevel: payload.riskLevel as ConsumerWithdrawIntent["riskLevel"],
    riskReasonCode: typeof payload.riskReasonCode === "string" ? payload.riskReasonCode : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    destination: typeof payload.destination === "string" ? payload.destination : undefined,
  };
}

export async function listConsumerWithdrawals(
  userAddress: string
): Promise<RefundIntentRecord[]> {
  const response = await fetch(`${API_BASE}/balance/consumer/withdrawals`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { withdrawals?: unknown[] };
  const raw = Array.isArray(payload.withdrawals) ? payload.withdrawals : [];
  return raw.map((r): RefundIntentRecord => {
    const row = r as Record<string, unknown>;
    return {
      id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
      amountUsdc: Number(row.amountUsdc || 0),
      status: (row.status as RefundIntentRecord["status"]) ?? "PENDING",
      riskLevel: typeof row.riskLevel === "string" ? row.riskLevel : undefined,
      riskReasonCode: typeof row.riskReasonCode === "string" ? row.riskReasonCode : undefined,
      message: typeof row.message === "string" ? row.message : undefined,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
    };
  });
}

export async function completeV2Refund(
  userAddress: string,
  refundId: string,
  txHash: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/refunds/${encodeURIComponent(refundId)}/complete`,
    {
      method: "POST",
      headers: buildAuthedHeaders(userAddress),
      body: JSON.stringify({ txHash }),
    }
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to complete refund")
    );
  }
}

export async function getV2IndexerStatus(
  userAddress: string
): Promise<IndexerStatus> {
  const response = await fetch(`${API_BASE}/indexer/status`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Failed to fetch indexer status")
    );
  }

  const payload = (await response.json()) as {
    indexer?: Partial<IndexerStatus>;
  };
  const indexer = payload.indexer ?? {};
  return {
    running: Boolean(indexer.running),
    listenerAddress: String(indexer.listenerAddress || ""),
    lastCounters: {
      credited: Number(indexer.lastCounters?.credited ?? 0),
      failed: Number(indexer.lastCounters?.failed ?? 0),
      pending: Number(indexer.lastCounters?.pending ?? 0),
    },
    lastProcessedAt:
      typeof indexer.lastProcessedAt === "number"
        ? indexer.lastProcessedAt
        : null,
    lastError: typeof indexer.lastError === "string" ? indexer.lastError : null,
    pollIntervalSec: Number(indexer.pollIntervalSec ?? 2),
  };
}
