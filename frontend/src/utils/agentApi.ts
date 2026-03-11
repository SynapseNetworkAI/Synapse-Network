import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";

export type AgentRegistryPayload = {
  id?: string;
  name: string;
  role: string;
  address: string;
  ownerAddress: string;
  createdAt: number;
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

export async function createAgentRegistry(payload: AgentRegistryPayload): Promise<Record<string, unknown>> {
  const headers = buildAuthedHeaders(payload.ownerAddress);
  
  const res = await fetch("http://127.0.0.1:8000/api/v2/agents", {
    method: "POST",
    headers: {
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to create agent on server"));
  }

  return res.json();
}

export async function listAgents(ownerAddress: string): Promise<Record<string, unknown>[]> {
  const headers = buildAuthedHeaders(ownerAddress);
  let url = "http://127.0.0.1:8000/api/v2/agents";
  if (ownerAddress) {
    url += `?ownerAddress=${encodeURIComponent(ownerAddress)}`;
  }
  
  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Failed to list agents"));
  }

  const data = await res.json();
  return data.data || [];
}