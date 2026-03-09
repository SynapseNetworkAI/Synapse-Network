import { buildAuthedHeaders } from "@/utils/authSession";

export type ServiceRegistryPayload = {
  id: string;
  agentId: string;
  name: string;
  role: string;
  ownerAddress: string;
  address: string;
  serviceId: string;
  pricing: string;
  endpoint: string;
  isActive: boolean;
};

export type ServiceRegistryRecord = {
  id: string;
  agentId?: string;
  name: string;
  role: string;
  ownerAddress: string;
  address: string;
  serviceId: string;
  pricing: string;
  endpoint: string;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
};

const API_BASE_URL = "http://127.0.0.1:8000/api/v1/services";

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as { detail?: { message?: string } | string; message?: string };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (parsed.detail && typeof parsed.detail === "object" && parsed.detail.message) return parsed.detail.message;
      if (parsed.message) return parsed.message;
      return text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

export async function createServiceRegistry(payload: ServiceRegistryPayload, userAddress: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/create`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Backend service registration failed"));
  }
}

export async function updateServiceRegistry(payload: ServiceRegistryPayload, userAddress: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/update`, {
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
