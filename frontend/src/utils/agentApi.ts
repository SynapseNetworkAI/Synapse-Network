import { buildAuthedHeaders } from "@/utils/authSession";

export type AgentRegistryPayload = {
  id?: string;
  name: string;
  role: string;
  address: string;
  ownerAddress: string;
  createdAt: number;
};

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
    const errorData = await res.json();
    throw new Error(errorData.detail?.message || errorData.detail || "Failed to create agent on server");
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
    const errorData = await res.json();
    throw new Error(errorData.detail?.message || errorData.detail || "Failed to list agents");
  }

  const data = await res.json();
  return data.data || [];
}