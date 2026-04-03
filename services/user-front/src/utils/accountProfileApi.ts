import {
  buildAuthedHeaders,
  normalizeAuthApiError,
} from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

export type OwnerProfile = {
  ownerAddress: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  notifyMarketing: boolean;
  notifyAlerts: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OwnerProfilePayload = {
  displayName: string | null;
  email: string | null;
  notifyMarketing: boolean;
  notifyAlerts: boolean;
};

type OwnerProfileEnvelope = {
  success: boolean;
  profile: OwnerProfile;
};

type OwnerProfileChallengeEnvelope = {
  success: boolean;
  challenge: string;
  expiresInSec: number;
};

const AUTH_API_BASE = `${getGatewayBaseUrl()}/api/v1/auth`;

async function parseResponseError(response: Response): Promise<Error> {
  let message = "Request failed";
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail?.message) {
      message = String(detail.message);
    }
  } catch {
    const text = await response.text();
    if (text) {
      message = text;
    }
  }
  return new Error(normalizeAuthApiError(message, response.status));
}

export async function getOwnerProfile(
  ownerAddress: string
): Promise<OwnerProfile> {
  const response = await fetch(`${AUTH_API_BASE}/me`, {
    method: "GET",
    headers: buildAuthedHeaders(ownerAddress, false),
  });

  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const payload = (await response.json()) as OwnerProfileEnvelope;
  return payload.profile;
}

export async function requestOwnerProfileChallenge(
  ownerAddress: string,
  profile: OwnerProfilePayload
): Promise<string> {
  const response = await fetch(`${AUTH_API_BASE}/me/profile/challenge`, {
    method: "POST",
    headers: buildAuthedHeaders(ownerAddress),
    body: JSON.stringify(profile),
  });

  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const payload = (await response.json()) as OwnerProfileChallengeEnvelope;
  return payload.challenge;
}

export async function updateOwnerProfile(
  ownerAddress: string,
  profile: OwnerProfilePayload & { message: string; signature: string }
): Promise<OwnerProfile> {
  const response = await fetch(`${AUTH_API_BASE}/me/profile`, {
    method: "PUT",
    headers: buildAuthedHeaders(ownerAddress),
    body: JSON.stringify(profile),
  });

  if (!response.ok) {
    throw await parseResponseError(response);
  }

  const payload = (await response.json()) as OwnerProfileEnvelope;
  return payload.profile;
}
