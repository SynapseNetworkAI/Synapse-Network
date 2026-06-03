import { buildAuthedHeaders } from "@/utils/authSession";
import {
  issueAgentCredential,
  listAgentCredentials,
  type AgentCredentialRecord,
} from "@/utils/agentCredentialApi";
import { getGatewayBaseUrlCandidates } from "@/utils/gatewayApi";

type OAuthApprovalPayload = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  resource?: string;
  credentialId: string;
};

export async function listOAuthAgentCredentials(
  userAddress: string
): Promise<AgentCredentialRecord[]> {
  return listAgentCredentials(userAddress, { activeOnly: true });
}

export async function issueChatGptMcpCredential(
  userAddress: string
): Promise<AgentCredentialRecord> {
  const issued = await issueAgentCredential(userAddress, {
    name: "ChatGPT Remote MCP",
    maxCalls: 200,
    rpm: 60,
    creditLimit: 5,
    resetInterval: "daily",
    expiresInSec: 30 * 24 * 60 * 60,
  });
  return {
    id: issued.id,
    ownerAddress: issued.ownerAddress,
    name: issued.name,
    tokenPrefix: issued.token.slice(0, 10),
    status: issued.status,
    maxCalls: issued.maxCalls,
    callsUsed: issued.callsUsed,
    rpm: issued.rpm,
    creditLimit: issued.creditLimit,
    resetInterval: issued.resetInterval,
    expiration: issued.expiration,
    expiresAt: issued.expiresAt,
  };
}

export async function approveOAuthAuthorization(
  userAddress: string,
  payload: OAuthApprovalPayload
): Promise<string> {
  let lastError: unknown = null;
  for (const baseUrl of getGatewayBaseUrlCandidates()) {
    try {
      const response = await fetch(`${baseUrl}/oauth/authorize/approve`, {
        method: "POST",
        headers: buildAuthedHeaders(userAddress),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await parseOAuthError(response));
      }
      const data = (await response.json()) as { redirectUrl?: string };
      if (!data.redirectUrl) {
        throw new Error("OAuth approval did not return a redirect URL.");
      }
      return data.redirectUrl;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to approve OAuth authorization.");
}

async function parseOAuthError(response: Response): Promise<string> {
  const parsed = await readErrorPayload(response);
  return messageFromOAuthPayload(parsed) || "OAuth authorization failed.";
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFromOAuthPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    detail?: unknown;
    message?: unknown;
    error_description?: unknown;
  };
  if (typeof record.detail === "string") return record.detail;
  if (record.detail && typeof record.detail === "object") {
    return messageFromOAuthDetail(record.detail);
  }
  if (typeof record.message === "string") return record.message;
  if (typeof record.error_description === "string")
    return record.error_description;
  return null;
}

function messageFromOAuthDetail(detail: object): string | null {
  const record = detail as { message?: unknown; error_description?: unknown };
  if (typeof record.message === "string") return record.message;
  if (typeof record.error_description === "string")
    return record.error_description;
  return null;
}
