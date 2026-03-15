import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

export type ServiceRegistryPayload = {
  id?: string;
  serviceId?: string;
  createdAt?: string;
  updatedAt?: string;
  serviceName: string;
  role?: string;
  address?: string;
  pricing: string | { currency: string; amount: string };
  isActive: boolean;
  summary?: string;
  tags?: string[];
  status?: "active" | "inactive" | "archived";
  auth?: {
    type?: string;
    headerName?: string;
  };
  healthCheck?: {
    path?: string;
    url?: string;
    method?: "GET" | "HEAD" | "POST";
    intervalSec?: number;
    timeoutMs?: number;
    successCodes?: number[];
    healthyThreshold?: number;
    unhealthyThreshold?: number;
  };
  constraints?: {
    timeoutMs?: number;
    maxResponseBytes?: number;
    maxRequestBytes?: number;
    maxQps?: number;
  };
  forwarding?: {
    requestIdHeader?: string;
    passThroughHeaders?: string[];
    injectHeaders?: Record<string, string>;
    retryPolicy?: {
      maxAttempts?: number;
      backoffMs?: number;
      retryOnStatus?: number[];
    };
  };
  metering?: {
    billingUnit?: "per_call" | "per_success_call";
    billOnError?: boolean;
    billableStatusClasses?: Array<2 | 4 | 5>;
    requestIdRequired?: boolean;
    responseSizeMetering?: boolean;
  };
  invoke: {
    method: string;
    url?: string;
    targets?: Array<{
      url: string;
      weight?: number;
      region?: string;
    }>;
    timeoutMs: number;
    request: {
      contentType: string;
      schema: Record<string, unknown>;
    };
    response: {
      schema: Record<string, unknown>;
    };
    headersTemplate?: Record<string, string>;
    examples?: Array<Record<string, unknown>>;
  };
};

export type ServiceRegistryRecord = {
  id: string;
  name: string;
  serviceName?: string;
  schemaVersion?: number;
  role: string;
  ownerAddress: string;
  address: string;
  serviceId: string;
  pricing: string | { currency?: string; amount?: string | number };
  endpoint: string;
  isActive: boolean;
  status?: "active" | "inactive" | "archived" | "healthy" | "degraded" | "unhealthy" | "unknown";
  health?: {
    overallStatus?: "healthy" | "degraded" | "unhealthy" | "unknown";
    healthyTargets?: number;
    totalTargets?: number;
    lastCheckedAt?: number | null;
  };
  summary?: string | null;
  tags?: string[];
  auth?: {
    type?: string;
    headerName?: string;
  } | null;
  healthCheck?: {
    path?: string;
    url?: string;
    method?: "GET" | "HEAD" | "POST";
    intervalSec?: number;
    timeoutMs?: number;
    successCodes?: number[];
    healthyThreshold?: number;
    unhealthyThreshold?: number;
  } | null;
  constraints?: {
    timeoutMs?: number;
    maxResponseBytes?: number;
    maxRequestBytes?: number;
    maxQps?: number;
  } | null;
  forwarding?: {
    requestIdHeader?: string;
    passThroughHeaders?: string[];
    injectHeaders?: Record<string, string>;
    retryPolicy?: {
      maxAttempts?: number;
      backoffMs?: number;
      retryOnStatus?: number[];
    };
  } | null;
  metering?: {
    billingUnit?: "per_call" | "per_success_call";
    billOnError?: boolean;
    billableStatusClasses?: Array<2 | 4 | 5>;
    requestIdRequired?: boolean;
    responseSizeMetering?: boolean;
  } | null;
  invoke?: {
    method: string;
    url: string;
    targets?: Array<{
      url: string;
      weight?: number;
      region?: string;
    }>;
    timeoutMs: number;
    request: {
      contentType: string;
      schema: Record<string, unknown>;
    };
    response: {
      schema: Record<string, unknown>;
    };
    headersTemplate?: Record<string, string>;
    examples?: Array<Record<string, unknown>>;
  };
  createdAt?: string | number;
  updatedAt?: string | number;
};

type ServiceRegistryApiRecord = Partial<ServiceRegistryRecord> & {
  pricingAmount?: string | number;
  pricingCurrency?: string;
  serviceHealth?: {
    overallStatus?: "healthy" | "degraded" | "unhealthy" | "unknown";
    healthyTargets?: number;
    totalTargets?: number;
    lastCheckedAt?: number | null;
  };
};

function normalizeServiceRecord(raw: ServiceRegistryApiRecord): ServiceRegistryRecord {
  let serviceId = "";
  if (typeof raw.serviceId === "string" && raw.serviceId.trim()) {
    serviceId = raw.serviceId;
  } else if (typeof raw.id === "string" && raw.id.trim()) {
    serviceId = raw.id;
  }

  const invokeTargets = Array.isArray(raw.invoke?.targets) ? raw.invoke?.targets : [];
  const firstTargetUrl = invokeTargets[0]?.url;
  const endpoint = raw.endpoint || raw.invoke?.url || firstTargetUrl || "";

  const pricing = raw.pricing || {
    amount: String(raw.pricingAmount ?? "0"),
    currency: raw.pricingCurrency || "USDC",
  };

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : serviceId,
    name: raw.name || raw.serviceName || serviceId || "Unnamed Service",
    serviceName: raw.serviceName || raw.name || serviceId || "",
    schemaVersion: raw.schemaVersion,
    role: raw.role || "provider",
    ownerAddress: raw.ownerAddress || raw.address || "",
    address: raw.address || raw.ownerAddress || "",
    serviceId,
    pricing,
    endpoint,
    isActive: typeof raw.isActive === "boolean" ? raw.isActive : raw.status === "active",
    status: raw.status,
    health: raw.health || raw.serviceHealth,
    summary: raw.summary,
    tags: raw.tags || [],
    auth: raw.auth || null,
    healthCheck: raw.healthCheck || null,
    constraints: raw.constraints || null,
    forwarding: raw.forwarding || null,
    metering: raw.metering || null,
    invoke: raw.invoke
      ? {
          ...raw.invoke,
          url: raw.invoke.url || endpoint,
        }
      : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const API_BASE_URL = `${getGatewayBaseUrl()}/api/v1/services`;

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

export async function createServiceRegistry(payload: ServiceRegistryPayload, userAddress: string): Promise<ServiceRegistryRecord> {
  const response = await fetch(API_BASE_URL, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend service registration failed"));
  }

  const data = (await response.json()) as { service?: ServiceRegistryApiRecord };
  if (data.service) {
    return normalizeServiceRecord(data.service);
  }

  throw new Error("Backend service response missing service payload");
}

export async function updateServiceRegistry(payload: ServiceRegistryPayload, userAddress: string): Promise<void> {
  const identifier = payload.serviceId || payload.id;
  if (!identifier) {
    throw new Error("Missing service identifier");
  }

  const response = await fetch(`${API_BASE_URL}/${identifier}`, {
    method: "PUT",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend service update failed"));
  }
}

export async function deleteServiceRegistry(serviceId: string, userAddress: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/${serviceId}`, {
    method: "DELETE",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend service delete failed"));
  }
}

export async function listServiceRegistry(userAddress: string, ownerAddress?: string): Promise<ServiceRegistryRecord[]> {
  const query = ownerAddress ? `?ownerAddress=${encodeURIComponent(ownerAddress)}` : "";
  const response = await fetch(`${API_BASE_URL}${query}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend service list failed"));
  }

  const payload = (await response.json()) as { services?: ServiceRegistryApiRecord[] };
  if (!Array.isArray(payload.services)) {
    return [];
  }
  return payload.services.map(normalizeServiceRecord);
}

export async function discoverServices(intent?: string): Promise<ServiceRegistryRecord[]> {
  const query = intent ? `?intent=${encodeURIComponent(intent)}` : "";
  const response = await fetch(`${API_BASE_URL}/discover${query}`, {
    method: "GET",
    // Public endpoint, no auth headers needed
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend service discovery failed"));
  }

  const payload = (await response.json()) as { services?: ServiceRegistryApiRecord[] };
  if (!Array.isArray(payload.services)) {
    return [];
  }
  return payload.services.map(normalizeServiceRecord);
}


export async function getWalletRole(userAddress: string): Promise<string | null> {
  try {
    const res = await fetch(`${getGatewayBaseUrl()}/api/v1/wallet/role/${userAddress}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      console.warn("Failed to get wallet role");
      return null;
    }
    const data = await res.json();
    return data.role;
  } catch (err) {
    console.error("Error fetching wallet role", err);
    return null;
  }
}
export async function bindWalletRole(userAddress: string, role: string): Promise<boolean> {
  try {
    const res = await fetch(`${getGatewayBaseUrl()}/api/v1/wallet/role/${userAddress}/bind`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      console.warn("Failed to bind wallet role");
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error binding wallet role", err);
    return false;
  }
}

export async function testServicePing(serviceId: string, userAddress: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/${serviceId}/ping`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Service ping failed"));
  }
}

export type ServiceTargetHealthHistoryPoint = {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  checkedAt: number;
  latencyMs?: number | null;
  httpStatus?: number | null;
};

export type ServiceTargetHealthHistory = {
  targetUrl: string;
  latestStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  history: ServiceTargetHealthHistoryPoint[];
};

export type ServiceHealthHistoryResponse = {
  status: "success";
  serviceId: string;
  serviceName?: string;
  windowHours: number;
  retentionHours: number;
  limitPerTarget: number;
  targets: ServiceTargetHealthHistory[];
};

export async function getServiceHealthHistory(
  serviceId: string,
  userAddress: string,
  options?: { limitPerTarget?: number; hours?: number },
): Promise<ServiceHealthHistoryResponse> {
  const limitPerTarget = options?.limitPerTarget ?? 720;
  const hours = options?.hours ?? 24;
  const query = new URLSearchParams({
    limitPerTarget: String(limitPerTarget),
    hours: String(hours),
  });
  const response = await fetch(`${API_BASE_URL}/${serviceId}/health/history?${query.toString()}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Service health history fetch failed"));
  }

  return (await response.json()) as ServiceHealthHistoryResponse;
}

// --- Secrets Management ---

export type ProviderSecret = {
  id: string;
  name: string;
  ownerAddress: string;
  secretKey?: string;
  maskedKey: string;
  creditLimit?: number | null;
  resetInterval?: string | null;
  expiration?: number | null;
  createdAt: number;
};

export async function listApiSecrets(userAddress: string): Promise<ProviderSecret[]> {
  const response = await fetch(`${getGatewayBaseUrl()}/api/v1/secrets/seller/list`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend secrets list failed"));
  }

  const payload = (await response.json()) as { secrets?: ProviderSecret[] };
  return Array.isArray(payload.secrets) ? payload.secrets : [];
}

export async function createApiSecret(
  name: string,
  userAddress: string,
  creditLimit: number | null = null,
  resetInterval: string | null = null,
  expiration: number | null = null,
  rpm: number | null = null,
): Promise<ProviderSecret> {
  const response = await fetch(`${getGatewayBaseUrl()}/api/v1/secrets/seller/issue`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({ name, creditLimit, resetInterval, expiration, rpm }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend secret creation failed"));
  }

  const data = (await response.json()) as { secret?: ProviderSecret };
  if (data.secret) {
    return data.secret;
  }
  throw new Error("Backend response missing secret payload");
}

export async function deleteApiSecret(secretId: string, userAddress: string): Promise<void> {
  const response = await fetch(`${getGatewayBaseUrl()}/api/v1/secrets/seller/${secretId}`, {
    method: "DELETE",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend secret delete failed"));
  }
}
