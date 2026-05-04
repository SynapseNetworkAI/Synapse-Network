import { getGatewayBaseUrl } from "@/utils/gatewayApi";

export type AuthSession = {
  token: string;
  wallet: string;
  expiresAt: number;
};

type AuthChallengeResponse = {
  success: boolean;
  challenge: string;
  domain: string;
};

type AuthVerifyResponse = {
  success: boolean;
  access_token: string;
  token_type: string;
  expires_in: number;
};

type AuthVerifyNormalizedResponse = {
  token: string;
  wallet: string;
  expiresInSec: number;
};

const AUTH_SESSION_STORAGE_KEY = "a2a_auth_session";
const AUTH_API_BASE = `${getGatewayBaseUrl()}/api/v1/auth`;
const AUTH_SESSION_TTL_SEC = 24 * 60 * 60;
export const WALLET_SESSION_MISSING_MESSAGE =
  "Wallet auth session missing. Please sign in with wallet.";
export const AUTH_SESSION_EXPIRED_EVENT = "a2a:auth-session-expired";

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function isBrowser(): boolean {
  return globalThis.window !== undefined;
}

export function clearAuthSession(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  localStorage.removeItem("developer_session");
}

export function notifyAuthSessionExpired(reason?: string): void {
  if (!isBrowser()) return;
  clearAuthSession();
  globalThis.window.dispatchEvent(
    new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: { reason } })
  );
}

export function getStoredAuthSession(): AuthSession | null {
  if (!isBrowser()) return null;

  const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.token || !parsed.wallet || !parsed.expiresAt) {
      clearAuthSession();
      return null;
    }

    if (Date.now() >= Number(parsed.expiresAt)) {
      clearAuthSession();
      return null;
    }

    return {
      token: parsed.token,
      wallet: normalizeAddress(parsed.wallet),
      expiresAt: Number(parsed.expiresAt),
    };
  } catch {
    clearAuthSession();
    return null;
  }
}

export function storeAuthSession(
  token: string,
  wallet: string,
  expiresInSec: number = AUTH_SESSION_TTL_SEC
): void {
  if (!isBrowser()) return;

  const normalizedTtl = Number.isFinite(expiresInSec)
    ? Math.max(60, Math.floor(expiresInSec))
    : AUTH_SESSION_TTL_SEC;
  const expiresAt = Date.now() + normalizedTtl * 1000;
  const nextSession: AuthSession = {
    token,
    wallet: normalizeAddress(wallet),
    expiresAt,
  };

  localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
}

export function getAccessToken(expectedWallet?: string): string {
  const session = getStoredAuthSession();
  if (!session) {
    notifyAuthSessionExpired("missing");
    throw new Error(WALLET_SESSION_MISSING_MESSAGE);
  }

  if (expectedWallet && session.wallet !== normalizeAddress(expectedWallet)) {
    notifyAuthSessionExpired("wallet_mismatch");
    throw new Error(
      "Wallet auth session wallet mismatch. Please sign in again."
    );
  }

  return session.token;
}

export function normalizeAuthApiError(
  message: string,
  status?: number
): string {
  const normalized = String(message || "")
    .trim()
    .toLowerCase();
  const isExpiredOrInvalid =
    normalized.includes("token expired") ||
    normalized.includes("expired token") ||
    normalized.includes("token invalid") ||
    normalized.includes("invalid token") ||
    normalized.includes("unauthorized") ||
    normalized.includes("signature expired");

  if (
    (status === 401 && isExpiredOrInvalid) ||
    normalized === "token expired"
  ) {
    notifyAuthSessionExpired("token_expired_or_invalid");
    return WALLET_SESSION_MISSING_MESSAGE;
  }

  return message;
}

export function buildAuthedHeaders(
  userAddress: string,
  withJson: boolean = true
): HeadersInit {
  return {
    ...(withJson ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${getAccessToken(userAddress)}`,
    "X-User-Address": userAddress,
  };
}

export async function requestAuthChallenge(
  address: string,
  chainId?: number
): Promise<AuthChallengeResponse> {
  const params = new URLSearchParams({ address });
  if (Number.isFinite(chainId)) {
    params.set("chainId", String(chainId));
  }
  const response = await fetch(
    `${AUTH_API_BASE}/challenge?${params.toString()}`,
    {
      method: "GET",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to get auth challenge");
  }

  return (await response.json()) as AuthChallengeResponse;
}

export async function verifyAuthSignature(
  address: string,
  message: string,
  signature: string
): Promise<AuthVerifyNormalizedResponse> {
  const response = await fetch(`${AUTH_API_BASE}/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      wallet_address: address,
      message,
      signature,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const normalized = String(text || "").toLowerCase();
    if (
      normalized.includes("invalid signature") ||
      normalized.includes("expired challenge")
    ) {
      throw new Error(
        "Wallet signature invalid or challenge expired. Please request a new challenge and sign again."
      );
    }
    throw new Error(text || "Failed to verify wallet signature");
  }

  const payload = (await response.json()) as AuthVerifyResponse;
  return {
    token: payload.access_token,
    wallet: address,
    expiresInSec:
      Number(payload.expires_in) > 0
        ? Number(payload.expires_in)
        : AUTH_SESSION_TTL_SEC,
  };
}
