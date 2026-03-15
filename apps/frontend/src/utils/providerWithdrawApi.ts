import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

const API_BASE = `${getGatewayBaseUrl()}/api/v1/providers/withdrawals`;

function buildIdempotencyKey(prefix: string): string {
  const now = Date.now().toString(36);
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${prefix}_${now}_${random}`.slice(0, 120);
}

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

export type ProviderWithdrawTicket = {
  amount: string;
  fee: string;
  nonce: number;
  deadline: number;
  signature: string;
  chainId: number;
  contractAddress: string;
};

export type ProviderWithdrawRecord = {
  id: string;
  amountUsdc: number;
  status:
    | "REQUESTED"
    | "APPROVED_AUTO"
    | "PENDING_MANUAL_REVIEW"
    | "REJECTED"
    | "COMPLETED"
    | "CANCELLED";
  nonce: number;
  deadline: number;
  signature?: string;
  txHash?: string;
  createdAt?: string | number;
  completedAt?: string | number;
  ticket?: ProviderWithdrawTicket;
};

export async function createProviderWithdrawIntent(userAddress: string, amountUsdc?: number): Promise<{
  withdrawalId: string;
  status: "REQUESTED" | "APPROVED_AUTO" | "PENDING_MANUAL_REVIEW";
  amountUsdc: number;
  ticket?: ProviderWithdrawTicket;
  message?: string;
}> {
  const headers = {
    ...buildAuthedHeaders(userAddress),
    "X-Idempotency-Key": buildIdempotencyKey("provider_withdraw"),
  };

  const response = await fetch(`${API_BASE}/intent`, {
    method: "POST",
    headers,
    body: JSON.stringify(typeof amountUsdc === "number" ? { amountUsdc } : {}),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create provider withdrawal intent"));
  }

  const payload = (await response.json()) as {
    withdrawalId: string;
    status: "REQUESTED" | "APPROVED_AUTO" | "PENDING_MANUAL_REVIEW";
    amountUsdc: number;
    ticket?: ProviderWithdrawTicket;
    message?: string;
  };
  return payload;
}

export async function listProviderWithdrawals(userAddress: string): Promise<ProviderWithdrawRecord[]> {
  const response = await fetch(API_BASE, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to fetch provider withdrawals"));
  }

  const payload = (await response.json()) as { withdrawals?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.withdrawals) ? payload.withdrawals : [];
  const validStatuses = new Set([
    "REQUESTED",
    "APPROVED_AUTO",
    "PENDING_MANUAL_REVIEW",
    "REJECTED",
    "COMPLETED",
    "CANCELLED",
    "PENDING",
  ]);
  return rows.map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    amountUsdc: Number(row.amountUsdc || 0),
    status: (() => {
      const normalized = (typeof row.status === "string" ? row.status : "").toUpperCase();
      if (!validStatuses.has(normalized)) return "REQUESTED";
      return normalized === "PENDING" ? "REQUESTED" : (normalized as ProviderWithdrawRecord["status"]);
    })(),
    nonce: Number(row.nonce || 0),
    deadline: Number(row.deadline || 0),
    signature: typeof row.signature === "string" ? row.signature : undefined,
    txHash: typeof row.txHash === "string" ? row.txHash : undefined,
    createdAt: (row.createdAt as string | number | undefined) ?? undefined,
    completedAt: (row.completedAt as string | number | undefined) ?? undefined,
    ticket: row.ticket && typeof row.ticket === "object" ? (row.ticket as ProviderWithdrawTicket) : undefined,
  }));
}

export async function completeProviderWithdrawal(userAddress: string, withdrawalId: string, txHash: string): Promise<void> {
  const normalizedTx = String(txHash || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedTx)) {
    throw new Error("Invalid txHash format. Expected 66-char 0x-prefixed hash.");
  }

  const response = await fetch(`${API_BASE}/${encodeURIComponent(withdrawalId)}/complete`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({ txHash: normalizedTx }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to complete provider withdrawal"));
  }
}
