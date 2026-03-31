import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl, getGatewayBaseUrlCandidates } from "@/utils/gatewayApi";

function buildGatewayNetworkErrorMessage(fallback: string): string {
  return `${fallback}. Gateway unreachable at ${getGatewayBaseUrl()}. Start the gateway or set NEXT_PUBLIC_GATEWAY_BASE_URL in apps/frontend/.env.local.`;
}

async function fetchAgentCredentialApi(
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<Response> {
  const baseCandidates = getGatewayBaseUrlCandidates();
  let lastError: unknown = null;

  for (const baseUrl of baseCandidates) {
    try {
      return await fetch(`${baseUrl}/api/v1${path}`, init);
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof Error && lastError.message ? ` ${lastError.message}` : "";
  throw new Error(`${buildGatewayNetworkErrorMessage(fallback)}${reason}`.trim());
}

export type AgentCredentialRecord = {
  id: string;
  ownerAddress: string;
  name?: string;
  tokenPrefix?: string;
  status: "active" | "revoked";
  maxCalls: number;
  callsUsed: number;
  rpm: number;
  creditLimit?: number | null;
  resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
  expiration?: number | null;
  expiresAt: number;
  createdAt?: string | number;
  updatedAt?: string | number;
  revokedAt?: number | null;
};

export type AgentCredentialIssueResponse = {
  id: string;
  token: string;
  ownerAddress: string;
  name?: string;
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
    ownerAddress?: string;
    name?: string;
    expiresInSec?: number;
    maxCalls?: number;
    rpm?: number;
    creditLimit?: number;
    resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
    expiration?: number;
  }
): Promise<AgentCredentialIssueResponse> {
  const response = await fetchAgentCredentialApi(
    "/credentials/agent/issue",
    {
      method: "POST",
      headers: buildAuthedHeaders(userAddress),
      body: JSON.stringify(payload),
    },
    "Failed to issue credential",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to issue credential"));
  }

  const data = (await response.json()) as { credential: AgentCredentialIssueResponse };
  return data.credential;
}

export async function listAgentCredentials(userAddress: string): Promise<AgentCredentialRecord[]> {
  const response = await fetchAgentCredentialApi(
    "/credentials/agent/list",
    {
      method: "GET",
      headers: buildAuthedHeaders(userAddress, false),
    },
    "Failed to list credentials",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to list credentials"));
  }

  const data = (await response.json()) as { credentials?: AgentCredentialRecord[] };
  return Array.isArray(data.credentials) ? data.credentials : [];
}

export async function revokeAgentCredential(userAddress: string, credentialId: string): Promise<void> {
  const response = await fetchAgentCredentialApi(
    `/credentials/agent/${encodeURIComponent(credentialId)}/revoke`,
    {
      method: "POST",
      headers: buildAuthedHeaders(userAddress, false),
    },
    "Failed to revoke credential",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to revoke credential"));
  }
}

export async function rotateAgentCredential(
  userAddress: string,
  credentialId: string,
): Promise<AgentCredentialIssueResponse> {
  const response = await fetchAgentCredentialApi(
    `/credentials/agent/${encodeURIComponent(credentialId)}/rotate`,
    {
      method: "POST",
      headers: buildAuthedHeaders(userAddress, false),
    },
    "Failed to rotate credential",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to rotate credential"));
  }

  const data = (await response.json()) as { credential: AgentCredentialIssueResponse };
  return data.credential;
}

export async function deleteAgentCredential(
  userAddress: string,
  credentialId: string,
): Promise<void> {
  const response = await fetchAgentCredentialApi(
    `/credentials/agent/${encodeURIComponent(credentialId)}`,
    {
      method: "DELETE",
      headers: buildAuthedHeaders(userAddress, false),
    },
    "Failed to delete agent",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to delete agent"));
  }
}

export async function updateAgentCredentialQuota(
  userAddress: string,
  credentialId: string,
  payload: {
    maxCalls?: number;
    rpm?: number;
    expiresAt?: number;
    creditLimit?: number;
    resetInterval?: "hourly" | "daily" | "weekly" | "monthly" | "never";
    expiration?: number;
  }
): Promise<void> {
  const response = await fetchAgentCredentialApi(
    `/credentials/agent/${encodeURIComponent(credentialId)}/quota`,
    {
      method: "PATCH",
      headers: buildAuthedHeaders(userAddress),
      body: JSON.stringify(payload),
    },
    "Failed to update credential quota",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to update credential quota"));
  }
}

export async function listAuditLogs(userAddress: string, limit: number = 100): Promise<AuditLogRecord[]> {
  const response = await fetchAgentCredentialApi(
    `/credentials/agent/audit-logs?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      headers: buildAuthedHeaders(userAddress, false),
    },
    "Failed to list audit logs",
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to list audit logs"));
  }

  const data = (await response.json()) as { logs?: AuditLogRecord[] };
  return Array.isArray(data.logs) ? data.logs : [];
}
