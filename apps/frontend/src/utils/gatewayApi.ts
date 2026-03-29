const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getGatewayBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_GATEWAY_BASE_URL?.trim();
  if (envUrl) {
    return normalizeBaseUrl(envUrl);
  }

  if (globalThis.window?.location?.hostname) {
    const { hostname, origin } = globalThis.window.location;
    if (LOCALHOST_HOSTNAMES.has(hostname)) {
      return `http://${hostname}:8000`;
    }
    return normalizeBaseUrl(origin);
  }

  return "http://127.0.0.1:8000";
}
