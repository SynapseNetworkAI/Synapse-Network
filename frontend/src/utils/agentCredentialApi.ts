import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

export type AgentCredentialRecord = {
  id: string;
  ownerAddress: string;
  name?: string;
  serviceId?: string | null;
  tokenPrefix?: string;
  status: "active" | "revoked";
  maxCalls: number;
  callsUsed: number;
  rpm: number;
  creditLimit?: number | null;
  resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
  expiration?: number | null;
  expiresAt: number;
  createdAt?: number;
  updatedAt?: number;
  revokedAt?: number | null;
};

export type AgentCredentialIssueResponse = {
  id: string;
  token: string;
  ownerAddress: string;
  name?: string;
  serviceId?: string | null;
  maxCalls: number;
  callsUsed: number;
  rpm: number;
  creditLimit?: number | null;
  resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
  expiration?: number | null;
  expiresAt: number;
  status: "active" | "revoked";
};

export type AuditLogRecord = {
  id: string;
  timestamp: number;
  action: string;
  ownerAddress: string;
  details: Record<string, unknown>;
};

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;
    const parsed = JSON.parse(text) as { detail?: { message?: string } | string; message?: string };
    if (typeof parsed.detail === "string") return normalizeAuthApiError(parsed.detail, response.status);
    if (parsed.detail && typeof parsed.detail === "object" && parsed.detail.message) {
      return normalizeAuthApiError(parsed.detail.message, response.status);
    }
    if (parsed.message) return normalizeAuthApiError(parsed.message, response.status);
    return normalizeAuthApiError(text, response.status);
  } catch {
    return fallback;
  }
}

export async function issueAgentCredential(
  userAddress: string,
  payload: {
    serviceId?: string;
    name?: string;
    expiresInSec?: number;
    maxCalls?: number;
    rpm?: number;
    creditLimit?: number;
    resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
    expiration?: number;
  }
): Promise<AgentCredentialIssueResponse> {
  const response = await fetch(`${API_BASE_URL}/credentials/issue`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to issue credential"));
  }

  const data = (await response.json()) as { credential: AgentCredentialIssueResponse };
  return data.credential;
}

export async function listAgentCredentials(userAddress: string): Promise<AgentCredentialRecord[]> {
  const response = await fetch(`${API_BASE_URL}/credentials`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to list credentials"));
  }

  const data = (await response.json()) as { credentials?: AgentCredentialRecord[] };
  return Array.isArray(data.credentials) ? data.credentials : [];
}

export async function revokeAgentCredential(userAddress: string, credentialId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/credentials/${encodeURIComponent(credentialId)}/revoke`, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to revoke credential"));
  }
}

export async function updateAgentCredentialQuota(
  userAddress: string,
  credentialId: string,
  payload: { maxCalls?: number; rpm?: number; expiresAt?: number }
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/credentials/${encodeURIComponent(credentialId)}/quota`, {
    method: "PATCH",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to update credential quota"));
  }
}

export async function listAuditLogs(userAddress: string, limit: number = 100): Promise<AuditLogRecord[]> {
  const response = await fetch(`${API_BASE_URL}/audit-logs?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to list audit logs"));
  }

  const data = (await response.json()) as { logs?: AuditLogRecord[] };
  return Array.isArray(data.logs) ? data.logs : [];
}
