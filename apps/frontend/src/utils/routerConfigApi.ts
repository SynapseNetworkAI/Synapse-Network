import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";

const API_BASE = "http://127.0.0.1:8000/api/v1/router/config";

export type RouterConfig = {
  dailyLimitUsdc: number;
  updatedAt?: number | null;
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

export async function getRouterConfig(userAddress: string): Promise<RouterConfig> {
  const response = await fetch(API_BASE, {
    method: "GET",
    headers: buildAuthedHeaders(userAddress, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load router config"));
  }

  const payload = (await response.json()) as { config?: Partial<RouterConfig> };
  return {
    dailyLimitUsdc: Number(payload.config?.dailyLimitUsdc ?? 0),
    updatedAt: payload.config?.updatedAt ?? null,
  };
}

export async function saveRouterConfig(userAddress: string, dailyLimitUsdc: number): Promise<RouterConfig> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: buildAuthedHeaders(userAddress),
    body: JSON.stringify({ dailyLimitUsdc }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to save router config"));
  }

  const payload = (await response.json()) as { config?: Partial<RouterConfig> };
  return {
    dailyLimitUsdc: Number(payload.config?.dailyLimitUsdc ?? 0),
    updatedAt: payload.config?.updatedAt ?? null,
  };
}
