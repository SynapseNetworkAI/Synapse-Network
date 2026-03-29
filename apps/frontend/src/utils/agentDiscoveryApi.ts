import { getGatewayBaseUrl } from "@/utils/gatewayApi";

export type AgentDiscoverySort = "best_match" | "lowest_price" | "fastest" | "highest_reliability";

export type AgentDiscoverySearchRequest = {
  query?: string;
  tags?: string[];
  maxPriceUsdc?: number;
  requiresStructuredOutput?: boolean;
  region?: string;
  limit?: number;
  sort?: AgentDiscoverySort;
};

export type AgentDiscoverySearchResult = {
  serviceId: string;
  serviceName: string;
  summary?: string;
  pricing?: {
    amount?: string;
    currency?: string;
  };
  tags?: string[];
  status?: string;
  invoke?: {
    method?: string;
    timeoutMs?: number;
    request?: {
      schema?: Record<string, unknown>;
    };
    response?: {
      schema?: Record<string, unknown>;
    };
  };
  health?: {
    overallStatus?: string;
    healthyTargets?: number;
    totalTargets?: number;
  };
};

export type AgentDiscoverySearchResponse = {
  requestId: string;
  results: AgentDiscoverySearchResult[];
  count: number;
};

const API_BASE_URL = `${getGatewayBaseUrl()}/api/v1/agent/discovery/search`;

export async function searchAgentDiscovery(
  payload: AgentDiscoverySearchRequest,
): Promise<AgentDiscoverySearchResponse> {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Agent discovery search failed");
  }

  return (await response.json()) as AgentDiscoverySearchResponse;
}