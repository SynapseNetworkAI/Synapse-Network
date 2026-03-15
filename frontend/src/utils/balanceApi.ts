import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";

const API_BASE = "http://127.0.0.1:8000/api/v1";

function buildIdempotencyKey(prefix: string): string {
  const now = Date.now().toString(36);
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${prefix}_${now}_${random}`.slice(0, 120);
}

export type BalanceSummary = {
  buyerBalance: number;
  sellerReceivable: number;
  platformFeeAccrued: number;
};

export type DepositIntentRecord = {
  id?: string;
  ownerAddress?: string;
  txHash: string;
  amountUsdc?: number;
  creditedAmountUsdc?: number;
  status: string;
  failureReason?: string;
  createdAt?: number;
  updatedAt?: number;
  confirmedAt?: number;
};

export type BuyerRefundIntent = {
  refundId: string;
  signature: string;
  amountRefunded: number;
  status: "PENDING" | "COMPLETED";
  gasPayer: "BUYER";
  gasModel: "BUYER_PAYS_ONCHAIN";
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

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { detail?: { message?: string } | string; message?: string };
      if (typeof parsed.detail === "string") return normalizeAuthApiError(parsed.detail, response.status);
      if (parsed.detail && typeof parsed.detail === "object" && parsed.detail.message) {
        return normalizeAuthApiError(parsed.detail.message, response.status);
      }
      if (parsed.message) return normalizeAuthApiError(parsed.message, response.status);
      return normalizeAuthApiError(text, response.status);
    } catch {
      return normalizeAuthApiError(text, response.status);
    }
  } catch {
    return fallback;
  }
}

export async function getV2Balance(userAddress: string): Promise<BalanceSummary> {
  const response = await fetch(`${API_BASE}/balance`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch v2 balance"));
  }

  const payload = (await response.json()) as {
    balance?: Partial<BalanceSummary> & {
      buyers?: Record<string, number>;
      sellers?: Record<string, number>;
      platform?: { feeAccrued?: number };
    };
  };
  const normalized = userAddress.trim().toLowerCase();
  const buyerFromMap = Number(payload.balance?.buyers?.[normalized] ?? 0);
  const sellerFromMap = Number(payload.balance?.sellers?.[normalized] ?? 0);
  const feeFromMap = Number(payload.balance?.platform?.feeAccrued ?? 0);
  return {
    // Compatible with both legacy summary shape and current ledger shape.
    buyerBalance: Number(payload.balance?.buyerBalance ?? buyerFromMap),
    sellerReceivable: Number(payload.balance?.sellerReceivable ?? sellerFromMap),
    platformFeeAccrued: Number(payload.balance?.platformFeeAccrued ?? feeFromMap),
  };
}

export async function createDepositIntent(
  userAddress: string,
  payload: { txHash: string; amountUsdc: number }
): Promise<DepositIntentRecord> {
  const headers = {
    ...buildAuthedHeaders(userAddress),
    "X-Idempotency-Key": buildIdempotencyKey("deposit"),
  };

  const response = await fetch(`${API_BASE}/balance/deposit/intent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...payload,
      ownerAddress: userAddress,
      buyerAddress: userAddress,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to submit deposit intent"));
  }

  const data = (await response.json()) as {
    deposit?: Partial<DepositIntentRecord>;
    intent?: Partial<DepositIntentRecord>;
    tx_hash?: string;
  };

  const deposit = data.deposit ?? data.intent ?? {};
  return {
    txHash: String(deposit.txHash || data.tx_hash || payload.txHash),
    amountUsdc: Number(deposit.amountUsdc ?? payload.amountUsdc),
    creditedAmountUsdc: Number(deposit.creditedAmountUsdc ?? 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: String((deposit as any).state || deposit.status || "pending"),
  };
}

export async function listDepositIntents(userAddress: string, limit: number = 50): Promise<DepositIntentRecord[]> {
  const response = await fetch(`${API_BASE}/balance/deposit/intents?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch deposit intents"));
  }

  const payload = (await response.json()) as { intents?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.intents) ? payload.intents : [];

  return rows.map((row) => ({
    id: typeof row.id === "string" ? row.id : undefined,
    ownerAddress: typeof row.ownerAddress === "string" ? row.ownerAddress : undefined,
    txHash: typeof row.txHash === "string" ? row.txHash : "",
    amountUsdc: Number(row.amountUsdc ?? 0),
    creditedAmountUsdc: Number(row.creditedAmountUsdc ?? 0),
    status: typeof row.status === "string" ? row.status : "pending",
    failureReason: typeof row.failureReason === "string" ? row.failureReason : undefined,
    createdAt: Number(row.createdAt ?? 0) || undefined,
    updatedAt: Number(row.updatedAt ?? 0) || undefined,
    confirmedAt: Number(row.confirmedAt ?? 0) || undefined,
  }));
}

export async function requestV2Refund(userAddress: string, amountUsdc: number): Promise<BuyerRefundIntent> {
  const headers = {
    ...buildAuthedHeaders(userAddress, true),
    "X-Idempotency-Key": buildIdempotencyKey("refund"),
  };

  const response = await fetch(`${API_BASE}/refund`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amountUsdc }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to process refund"));
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const refundId = typeof payload.refundId === "string" ? payload.refundId : "";
  const signature = typeof payload.signature === "string" ? payload.signature : "";
  return {
    refundId,
    signature,
    amountRefunded: Number(payload.amountRefunded || 0),
    status: payload.status === "COMPLETED" ? "COMPLETED" : "PENDING",
    gasPayer: "BUYER",
    gasModel: "BUYER_PAYS_ONCHAIN",
  };
}

export async function completeV2Refund(userAddress: string, refundId: string, txHash: string): Promise<void> {
  const response = await fetch(`${API_BASE}/refunds/${encodeURIComponent(refundId)}/complete`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({ txHash }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to complete refund"));
  }
}

export async function getV2IndexerStatus(userAddress: string): Promise<IndexerStatus> {
  const response = await fetch(`${API_BASE}/indexer/status`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch indexer status"));
  }

  const payload = (await response.json()) as { indexer?: Partial<IndexerStatus> };
  const indexer = payload.indexer ?? {};
  return {
    running: Boolean(indexer.running),
    listenerAddress: String(indexer.listenerAddress || ""),
    lastCounters: {
      credited: Number(indexer.lastCounters?.credited ?? 0),
      failed: Number(indexer.lastCounters?.failed ?? 0),
      pending: Number(indexer.lastCounters?.pending ?? 0),
    },
    lastProcessedAt: typeof indexer.lastProcessedAt === "number" ? indexer.lastProcessedAt : null,
    lastError: typeof indexer.lastError === "string" ? indexer.lastError : null,
    pollIntervalSec: Number(indexer.pollIntervalSec ?? 2),
  };
}
