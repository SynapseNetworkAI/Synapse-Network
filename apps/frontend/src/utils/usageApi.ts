import { buildAuthedHeaders } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";

const API_BASE_URL = `${getGatewayBaseUrl()}/api/v1/usage`;

export type UsageLogRecord = {
  request_id: string;
  ownerAddress?: string;
  providerAddress?: string;
  service_id?: string;
  status: DeductionStatus;
  unit_price?: number;
  platform_fee?: number;
  provider_net?: number;
  tx_hash?: string;
  block_number?: number;
  created_at?: number;
};

function parseStatus(value: unknown): DeductionStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
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
      let requestId = "";
      if (typeof row.request_id === "string") {
        requestId = row.request_id.trim();
      } else if (typeof row.requestId === "string") {
        requestId = row.requestId.trim();
      }
      if (!requestId) return null;

      const unitPrice = toNumber(row.unit_price ?? row.unitPrice);
      const platformFee = toNumber(row.platform_fee ?? row.platformFee);
      const providerNet = toNumber(row.provider_net ?? row.providerNet);
      let serviceId: string | undefined;
      if (typeof row.service_id === "string") {
        serviceId = row.service_id;
      } else if (typeof row.serviceId === "string") {
        serviceId = row.serviceId;
      }

      let txHash: string | undefined;
      if (typeof row.tx_hash === "string") {
        txHash = row.tx_hash;
      } else if (typeof row.txHash === "string") {
        txHash = row.txHash;
      }

      return {
        request_id: requestId,
        ownerAddress: typeof row.ownerAddress === "string" ? row.ownerAddress : undefined,
        providerAddress: typeof row.providerAddress === "string" ? row.providerAddress : undefined,
        service_id: serviceId,
        status: parseStatus(row.status),
        unit_price: unitPrice,
        platform_fee: platformFee,
        provider_net: providerNet,
        tx_hash: txHash,
        block_number: toNumber(row.block_number ?? row.blockNumber),
        created_at: toNumber(row.created_at ?? row.createdAt),
      } satisfies UsageLogRecord;
    })
    .filter(Boolean) as unknown as UsageLogRecord[];
}
