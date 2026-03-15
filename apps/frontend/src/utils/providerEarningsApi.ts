import { buildAuthedHeaders } from "@/utils/authSession";

const API_BASE_URL = "http://127.0.0.1:8000/api/v1/providers/earnings";

export type ProviderRecentCall = {
  requestId: string;
  serviceId: string;
  status: string;
  unitPrice: number;
  protocolFee: number;
  routingTax: number;
  sellerNet: number;
  createdAt: number;
};

export type ProviderEarningsSummary = {
  ownerAddress: string;
  totalApiCalls: number;
  totalEarned: number;
  totalProtocolFee: number;
  totalRoutingTax: number;
  sellerNetEarned: number;
  sellerReceivable: number;
  duplicateRowsDropped: number;
  idempotencyKey: string;
  recentCalls: ProviderRecentCall[];
};

export async function getProviderEarningsSummary(userAddress: string, limit: number = 200): Promise<ProviderEarningsSummary> {
  const response = await fetch(`${API_BASE_URL}/summary?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to load provider earnings summary");
  }

  const payload = (await response.json()) as { summary?: ProviderEarningsSummary };
  if (!payload.summary) {
    throw new Error("Provider earnings summary payload missing");
  }
  return payload.summary;
}
