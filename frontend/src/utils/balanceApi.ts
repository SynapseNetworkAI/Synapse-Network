import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";

const API_BASE = "http://127.0.0.1:8000/api/v2";

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
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch v2 balance"));
  }

  const payload = (await response.json()) as { balance?: Partial<BalanceSummary> };
  return {
    buyerBalance: Number(payload.balance?.buyerBalance ?? 0),
    sellerReceivable: Number(payload.balance?.sellerReceivable ?? 0),
    platformFeeAccrued: Number(payload.balance?.platformFeeAccrued ?? 0),
  };
}

export async function createDepositIntent(
  userAddress: string,
  payload: { txHash: string; amountUsdc: number }
): Promise<DepositIntentRecord> {
  const response = await fetch(`${API_BASE}/balance/deposit/intent`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to submit deposit intent"));
  }

  const data = (await response.json()) as {
    deposit?: Partial<DepositIntentRecord>;
  };

  const deposit = data.deposit ?? {};
  return {
    txHash: String(deposit.txHash || payload.txHash),
    amountUsdc: Number(deposit.amountUsdc ?? payload.amountUsdc),
    creditedAmountUsdc: Number(deposit.creditedAmountUsdc ?? 0),
    status: String(deposit.state || deposit.status || "pending"),
  };
}

export async function listDepositIntents(userAddress: string, limit: number = 50): Promise<DepositIntentRecord[]> {
  const response = await fetch(`${API_BASE}/balance/deposit/intents?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch deposit intents"));
  }

  const payload = (await response.json()) as { intents?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.intents) ? payload.intents : [];

  return rows.map((row) => ({
    id: typeof row.id === "string" ? row.id : undefined,
    ownerAddress: typeof row.ownerAddress === "string" ? row.ownerAddress : undefined,
    txHash: String(row.txHash || ""),
    amountUsdc: Number(row.amountUsdc ?? 0),
    creditedAmountUsdc: Number(row.creditedAmountUsdc ?? 0),
    status: String(row.status || "pending"),
    failureReason: typeof row.failureReason === "string" ? row.failureReason : undefined,
    createdAt: Number(row.createdAt ?? 0) || undefined,
    updatedAt: Number(row.updatedAt ?? 0) || undefined,
    confirmedAt: Number(row.confirmedAt ?? 0) || undefined,
  }));
}
