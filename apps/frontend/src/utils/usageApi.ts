import { buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";

const API_BASE_URL = `${getGatewayBaseUrl()}/api/v1/usage`;

export type UsageLogRecord = {
  request_id: string;
  buyer?: string;
  seller?: string;
  service_id?: string;
  status: DeductionStatus;
  unit_price?: number;
  platform_fee?: number;
  seller_net?: number;
  tx_hash?: string;
  block_number?: number;
  created_at?: number;
};

function parseStatus(value: unknown): DeductionStatus {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "accepted" || normalized === "succeeded" || normalized === "refunded" || normalized === "failed") {
    return normalized;
  }
  return "succeeded";
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function listUsageLogs(userAddress: string, limit: number = 200): Promise<UsageLogRecord[]> {
  const response = await fetch(`${API_BASE_URL}/logs?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Usage logs endpoint unavailable");
  }

  const payload = (await response.json()) as { logs?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.logs) ? payload.logs : [];

  return rows
    .map((row) => {
      const requestId = String(row.request_id || row.requestId || "").trim();
      if (!requestId) return null;

      const unitPrice = toNumber(row.unit_price ?? row.unitPrice);
      const platformFee = toNumber(row.platform_fee ?? row.platformFee);
      const sellerNet = toNumber(row.seller_net ?? row.sellerNet);

      return {
        request_id: requestId,
        buyer: typeof row.buyer === "string" ? row.buyer : undefined,
        seller: typeof row.seller === "string" ? row.seller : undefined,
        service_id: typeof row.service_id === "string" ? row.service_id : typeof row.serviceId === "string" ? row.serviceId : undefined,
        status: parseStatus(row.status),
        unit_price: unitPrice,
        platform_fee: platformFee,
        seller_net: sellerNet,
        tx_hash: typeof row.tx_hash === "string" ? row.tx_hash : typeof row.txHash === "string" ? row.txHash : undefined,
        block_number: toNumber(row.block_number ?? row.blockNumber),
        created_at: toNumber(row.created_at ?? row.createdAt),
      } satisfies UsageLogRecord;
    })
    .filter(Boolean) as unknown as UsageLogRecord[];
}
