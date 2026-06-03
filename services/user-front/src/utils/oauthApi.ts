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
  try {
    const parsed = (await response.json()) as {
      detail?: { message?: string; error_description?: string } | string;
      message?: string;
      error_description?: string;
    };
    if (typeof parsed.detail === "string") return parsed.detail;
    return (
      parsed.detail?.message ||
      parsed.detail?.error_description ||
      parsed.message ||
      parsed.error_description ||
      "OAuth authorization failed."
    );
  } catch {
    return "OAuth authorization failed.";
  }
}
