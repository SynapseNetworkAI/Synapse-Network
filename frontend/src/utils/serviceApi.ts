import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";

export type ServiceRegistryPayload = {
  id?: string;
  serviceName: string;
  role: string;
  address: string;
  pricing: string;
  isActive: boolean;
  summary?: string;
  tags?: string[];
  auth?: {
    type?: string;
    headerName?: string;
  };
  invoke: {
    method: string;
    url: string;
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
  role: string;
  ownerAddress: string;
  address: string;
  serviceId: string;
  pricing: string;
  endpoint: string;
  isActive: boolean;
  summary?: string | null;
  tags?: string[];
  auth?: {
    type?: string;
    headerName?: string;
  } | null;
  invoke?: {
    method: string;
    url: string;
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
  createdAt?: number;
  updatedAt?: number;
};

const API_BASE_URL = "http://127.0.0.1:8000/api/v2/services";

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

  const data = (await response.json()) as { service?: ServiceRegistryRecord };
  if (data.service) {
    return data.service;
  }

  throw new Error("Backend service response missing service payload");
}

export async function updateServiceRegistry(payload: ServiceRegistryPayload, userAddress: string): Promise<void> {
  if (!payload.id) {
    throw new Error("Missing service record id");
  }

  const response = await fetch(`${API_BASE_URL}/${payload.id}`, {
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

  const payload = (await response.json()) as { services?: ServiceRegistryRecord[] };
  return Array.isArray(payload.services) ? payload.services : [];
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

  const payload = (await response.json()) as { services?: ServiceRegistryRecord[] };
  return Array.isArray(payload.services) ? payload.services : [];
}
