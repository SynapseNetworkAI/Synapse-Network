import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import type { DeductionStatus } from "@/components/dashboard/shared/deductionStatus";

const API_BASE_URL = `${getGatewayBaseUrl()}/api/v1/usage`;

export type UsageLogRecord = {
  id?: string;
  agent_id?: string;
  request_id: string;
  origin_request_id?: string;
  ownerAddress?: string;
  providerAddress?: string;
  service_id?: string;
  status: DeductionStatus;
  unit_price?: number;
  routing_tax?: number;
  total_charge?: number;
  platform_fee?: number;
  provider_net?: number;
  latency_ms?: number;
  tx_hash?: string;
  block_number?: number;
  created_at?: number;
};

export type PaginatedUsageLogResponse = {
  rows: UsageLogRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
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

async function readUsageApiError(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(text) as { detail?: { message?: string } | string; message?: string };
      if (typeof parsed.detail === "string") {
        return normalizeAuthApiError(parsed.detail, response.status);
      }
      if (parsed.detail && typeof parsed.detail === "object" && parsed.detail.message) {
        return normalizeAuthApiError(parsed.detail.message, response.status);
      }
      if (typeof parsed.message === "string") {
        return normalizeAuthApiError(parsed.message, response.status);
      }
    } catch {
      return normalizeAuthApiError(text, response.status);
    }

    return normalizeAuthApiError(text, response.status);
  } catch {
    return fallback;
  }
}

function readStringField(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function readTrimmedRequestId(row: Record<string, unknown>): string {
  return (readStringField(row, "request_id", "requestId") || "").trim();
}

function deriveProviderNet(totalCharge?: number, platformFee?: number, routingTax?: number, fallback?: number): number | undefined {
  if (totalCharge !== undefined || platformFee !== undefined || routingTax !== undefined) {
    return Math.max(0, (totalCharge || 0) - (platformFee || 0) - (routingTax || 0));
  }
  return fallback;
}

function normalizeUsageLogRecord(row: Record<string, unknown>): UsageLogRecord | null {
  const requestId = readTrimmedRequestId(row);
  if (!requestId) return null;

  const unitPrice = toNumber(row.unit_price ?? row.unitPrice);
  const platformFee = toNumber(row.protocol_fee ?? row.protocolFee ?? row.platform_fee ?? row.platformFee);
  const routingTax = toNumber(row.routing_tax ?? row.routingTax);
  const totalCharge = toNumber(row.total_charge ?? row.totalCharge);
  const providerNet = deriveProviderNet(
    totalCharge,
    platformFee,
    routingTax,
    toNumber(row.provider_net ?? row.providerNet),
  );

  const serviceId = readStringField(row, "service_id", "serviceId");
  const txHash = readStringField(row, "tx_hash", "txHash");
  const originRequestId = readStringField(row, "origin_request_id", "originRequestId");
  const ownerAddress = readStringField(row, "ownerAddress", "consumerAddress");
  const providerAddress = readStringField(row, "providerAddress", "provider_address");
  const agentId = readStringField(row, "agent_id", "agentId");

  return {
    id: typeof row.id === "string" ? row.id : undefined,
    agent_id: agentId,
    request_id: requestId,
    origin_request_id: originRequestId,
    ownerAddress,
    providerAddress,
    service_id: serviceId,
    status: parseStatus(row.status),
    unit_price: unitPrice,
    routing_tax: routingTax,
    total_charge: totalCharge,
    platform_fee: platformFee,
    provider_net: providerNet,
    latency_ms: toNumber(row.latency_ms ?? row.latencyMs),
    tx_hash: txHash,
    block_number: toNumber(row.block_number ?? row.blockNumber),
    created_at: toNumber(row.created_at ?? row.createdAt ?? row.ts),
  } satisfies UsageLogRecord;
}

export async function listUsageLogs(userAddress: string, limit: number = 200): Promise<UsageLogRecord[]> {
  const response = await fetch(`${API_BASE_URL}/logs?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readUsageApiError(response, "Usage logs endpoint unavailable"));
  }

  const payload = (await response.json()) as { logs?: Array<Record<string, unknown>> };
  const rows = Array.isArray(payload.logs) ? payload.logs : [];

  return rows.map(normalizeUsageLogRecord).filter(Boolean) as UsageLogRecord[];
}

export async function listPaginatedUsageLogs(
  userAddress: string,
  options?: {
    page?: number;
    pageSize?: number;
    status?: "all" | DeductionStatus;
    query?: string;
  },
): Promise<PaginatedUsageLogResponse> {
  const search = new URLSearchParams();
  search.set("page", String(Math.max(1, options?.page ?? 1)));
  search.set("pageSize", String(Math.max(1, options?.pageSize ?? 10)));
  if (options?.status && options.status !== "all") {
    search.set("status", options.status);
  }
  if (options?.query?.trim()) {
    search.set("query", options.query.trim());
  }

  const response = await fetch(`${API_BASE_URL}/logs?${search.toString()}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readUsageApiError(response, "Usage logs endpoint unavailable"));
  }

  const payload = (await response.json()) as {
    logs?: Array<Record<string, unknown>>;
    total?: number;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
  };

  const rows = Array.isArray(payload.logs)
    ? payload.logs.map(normalizeUsageLogRecord).filter(Boolean) as UsageLogRecord[]
    : [];

  return {
    rows,
    total: Number.isFinite(payload.total) ? Number(payload.total) : rows.length,
    page: Number.isFinite(payload.page) ? Math.max(1, Number(payload.page)) : Math.max(1, options?.page ?? 1),
    pageSize: Number.isFinite(payload.pageSize)
      ? Math.max(1, Number(payload.pageSize))
      : Math.max(1, options?.pageSize ?? 10),
    hasMore: Boolean(payload.hasMore),
  };
}
