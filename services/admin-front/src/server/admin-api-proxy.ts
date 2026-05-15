import { GoogleAuth } from "google-auth-library";

type AuthHeadersProvider = (
  audience: string
) => Promise<Record<string, string>>;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export function normalizeAdminApiProxyTarget(target: string): string {
  const normalized = String(target || "")
    .trim()
    .replace(/\/$/, "");
  if (!normalized) {
    throw new Error("ADMIN_API_PROXY_TARGET is required");
  }
  return normalized;
}

export function resolveAdminApiProxyAudience(target: string): string {
  return String(process.env.ADMIN_API_PROXY_AUDIENCE || target)
    .trim()
    .replace(/\/$/, "");
}

export function shouldAttachGoogleIdentityToken(target: string): boolean {
  try {
    const url = new URL(normalizeAdminApiProxyTarget(target));
    return url.protocol === "https:" && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

const defaultAuthHeadersProvider: AuthHeadersProvider = async (audience) => {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(audience);
  const headers = await client.getRequestHeaders();
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" && value) {
      normalized[key] = value;
    }
  }
  return normalized;
};

export async function buildAdminApiProxyHeaders(
  incoming: Headers,
  target: string,
  authHeadersProvider: AuthHeadersProvider = defaultAuthHeadersProvider
): Promise<Headers> {
  const headers = new Headers();

  incoming.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      return;
    }
    if (
      normalizedKey === "authorization" &&
      shouldAttachGoogleIdentityToken(target)
    ) {
      return;
    }
    headers.set(key, value);
  });

  if (shouldAttachGoogleIdentityToken(target)) {
    const audience = resolveAdminApiProxyAudience(target);
    const authHeaders = await authHeadersProvider(audience);
    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }
  }

  return headers;
}

export function buildAdminApiProxyUrl(
  target: string,
  pathname: string,
  search: string
): string {
  const normalizedTarget = normalizeAdminApiProxyTarget(target);
  return `${normalizedTarget}${pathname}${search}`;
}
